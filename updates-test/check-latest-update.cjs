#!/usr/bin/env node

/**
 * This script uses the EAS CLI to find the latest update that the server should send to clients
 * with a given channel and runtime version. It reads the branch mapping of the channel, then
 * gets the latest update on each mapped branch for Android and iOS. The results are written to a CSV file.
 *
 * It uses only Node.js (20 or newer). It runs the EAS CLI with npx, so the EAS CLI does not need to be installed.
 * You must be logged in to the EAS CLI. The EAS CLI uses the project in --project-dir
 * (default: the parent of this folder), so that project's EAS project ID must match --project-id.
 *
 * Usage:
 *   node updates-test/check-latest-update.cjs --project-id <id> --channel <name> --runtime-version <version>
 *
 * Options:
 *   --project-dir <dir>      Directory of the Expo project linked to --project-id (default: the parent of this folder)
 *   --eas-cli-version <ver>  EAS CLI version to use with npx (default: latest)
 *   --out <file>             CSV output path (default: updates-test/output/server-update-<timestamp>.csv)
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const { values: args } = parseArgs({
  options: {
    "project-id": { type: "string" },
    channel: { type: "string" },
    "runtime-version": { type: "string" },
    "project-dir": { type: "string", default: path.resolve(__dirname, "..") },
    "eas-cli-version": { type: "string", default: "latest" },
    out: { type: "string" },
  },
});

const projectId = args["project-id"];
const channel = args.channel;
const runtimeVersion = args["runtime-version"];
const projectDir = path.resolve(args["project-dir"]);

if (!projectId || !channel || !runtimeVersion) {
  console.error(
    "Usage: node updates-test/check-latest-update.cjs --project-id <id> --channel <name> --runtime-version <version>"
  );
  process.exit(1);
}

const outFile =
  args.out ??
  path.join(__dirname, "output", `server-update-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

function runEasCli(commandArgs) {
  const easCli = `eas-cli@${args["eas-cli-version"]}`;
  try {
    return execFileSync("npx", ["--yes", easCli, ...commandArgs], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`npx ${easCli} ${commandArgs.join(" ")} failed:\n${stderr}`);
  }
}

// update:view does not accept --non-interactive, but --json makes every command non-interactive
function eas(commandArgs) {
  return JSON.parse(runEasCli([...commandArgs, "--json"]));
}

// Evaluates one node of the branch mapping for a client with this runtime version.
// Returns true, false, or "unknown" (for example, a branch rollout, where the result depends on the client).
function evaluateNode(node) {
  if (node === "true") {
    return true;
  }
  if (Array.isArray(node)) {
    const [operator, ...children] = node;
    const results = children.map(evaluateNode);
    if (operator === "not") {
      return results[0] === "unknown" ? "unknown" : !results[0];
    }
    if (operator === "and") {
      if (results.includes(false)) return false;
      return results.includes("unknown") ? "unknown" : true;
    }
    if (operator === "or") {
      if (results.includes(true)) return true;
      return results.includes("unknown") ? "unknown" : false;
    }
    return "unknown";
  }
  if (node.clientKey !== "runtimeVersion") {
    return "unknown";
  }
  switch (node.branchMappingOperator) {
    case "==":
      return runtimeVersion === node.operand;
    case "!=":
      return runtimeVersion !== node.operand;
    case "in":
      return node.operand.includes(runtimeVersion);
    case "regex":
      return new RegExp(node.operand).test(runtimeVersion);
    default:
      return "unknown";
  }
}

// Returns the branches that a client can get, in the order of the branch mapping
function resolveBranches(branchMapping, branchNamesById) {
  const candidates = [];
  for (const { branchId, branchMappingLogic } of branchMapping.data) {
    const result = evaluateNode(branchMappingLogic);
    if (result === false) {
      continue;
    }
    candidates.push({
      branchId,
      branchName: branchNamesById[branchId] ?? branchId,
      condition: result === true ? "always" : JSON.stringify(branchMappingLogic),
    });
    if (result === true) {
      break;
    }
  }
  return candidates;
}

function toCsvValue(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  // project:info has no JSON output, so read the ID from its text output
  let projectInfo;
  try {
    projectInfo = runEasCli(["project:info"]);
  } catch (error) {
    throw new Error(
      `${error.message}\n\nMake sure that ${projectDir} is an Expo project linked to EAS, and that you are logged in to the EAS CLI.` +
        "\nUse --project-dir to point to a different project."
    );
  }
  const configProjectId = /^ID\s+(\S+)/m.exec(projectInfo)?.[1];
  if (configProjectId !== projectId) {
    console.error(
      `The project in ${projectDir} has EAS project ID ${configProjectId ?? "(none)"}, not ${projectId}.\n` +
        "Use --project-dir to point to the project that is linked to --project-id."
    );
    process.exit(1);
  }

  console.log(`Getting channel "${channel}"`);
  const { currentPage: channelInfo } = eas(["channel:view", channel, "--limit", "100"]);
  const branchMapping = JSON.parse(channelInfo.branchMapping);
  const branchNamesById = Object.fromEntries(
    channelInfo.updateBranches.map((branch) => [branch.id, branch.name])
  );
  const branches = resolveBranches(branchMapping, branchNamesById);

  if (branches.length === 0) {
    console.log(`No branch on channel "${channel}" matches runtime version ${runtimeVersion}.`);
  } else if (branches.length > 1 || branches[0].condition !== "always") {
    console.log("The branch depends on the client (for example, a branch rollout). All possible branches are listed.");
  }

  const rows = [];
  for (const branch of branches) {
    for (const platform of ["android", "ios"]) {
      console.log(`Getting the latest ${platform} update on branch "${branch.branchName}"`);
      const { currentPage: groups } = eas([
        "update:list",
        "--branch",
        branch.branchName,
        "--platform",
        platform,
        "--runtime-version",
        runtimeVersion,
        "--limit",
        "1",
      ]);
      const row = {
        platform,
        runtime_version: runtimeVersion,
        channel,
        branch: branch.branchName,
        branch_condition: branch.condition,
      };
      const latestGroup = groups[0];
      if (latestGroup) {
        const updates = eas(["update:view", latestGroup.group]);
        const update = updates.find((u) => u.platform === platform);
        Object.assign(row, {
          update_group_id: latestGroup.group,
          update_id: update?.id,
          created_at: update?.createdAt,
          message: update?.message,
          rollout_percentage: latestGroup.rolloutPercentage,
          is_rollback_to_embedded: latestGroup.isRollBackToEmbedded,
        });
      }
      rows.push(row);
    }
  }

  const columns = [
    "platform",
    "runtime_version",
    "channel",
    "branch",
    "branch_condition",
    "update_group_id",
    "update_id",
    "created_at",
    "message",
    "rollout_percentage",
    "is_rollback_to_embedded",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => toCsvValue(row[column])).join(","));
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n") + "\n");

  for (const row of rows) {
    console.log(`${row.platform} (branch ${row.branch}): ${row.update_id ?? "no update"}`);
  }
  console.log(`Wrote ${outFile}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
