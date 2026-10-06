#!/usr/bin/env node

/**
 * This script simulates app launches that request an update manifest from EAS Update.
 * It sends the same headers as the expo-updates client in SDK 53 (see FileDownloader.kt and FileDownloader.swift).
 * Each request uses a new random EAS client ID. The results are written to a CSV file.
 * It uses only Node.js (20 or newer). It does not need any packages.
 *
 * Usage:
 *   node updates-test/simulate-manifest-requests.cjs --project-id <id> --channel <name> --runtime-version <version>
 *
 * Options:
 *   --count <n>         Requests per platform (default: 100)
 *   --concurrency <n>   Requests that run at the same time (default: 10)
 *   --out <file>        CSV output path (default: updates-test/output/manifest-results-<timestamp>.csv)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const { values: args } = parseArgs({
  options: {
    "project-id": { type: "string" },
    channel: { type: "string" },
    "runtime-version": { type: "string" },
    count: { type: "string", default: "100" },
    concurrency: { type: "string", default: "10" },
    out: { type: "string" },
  },
});

const projectId = args["project-id"];
const channel = args.channel;
const runtimeVersion = args["runtime-version"];

if (!projectId || !channel || !runtimeVersion) {
  console.error(
    "Usage: node updates-test/simulate-manifest-requests.cjs --project-id <id> --channel <name> --runtime-version <version>"
  );
  process.exit(1);
}

const count = parseInt(args.count, 10);
const concurrency = parseInt(args.concurrency, 10);
const outFile =
  args.out ??
  path.join(__dirname, "output", `manifest-results-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const updateUrl = `https://u.expo.dev/${projectId}`;

function buildHeaders(platform, easClientId) {
  return {
    Accept: "multipart/mixed,application/expo+json,application/json",
    "Expo-Platform": platform,
    "Expo-Protocol-Version": "1",
    "Expo-API-Version": "1",
    "Expo-Updates-Environment": "BARE",
    "Expo-JSON-Error": "true",
    "EAS-Client-ID": easClientId,
    "Expo-Runtime-Version": runtimeVersion,
    // Comes from updates.requestHeaders in app config (set by EAS Build from the channel in eas.json)
    "expo-channel-name": channel,
  };
}

// Gets the manifest from a multipart/mixed response, or from a JSON response
function getUpdateId(contentType, body) {
  if (contentType.startsWith("multipart/mixed")) {
    const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
    if (!boundary) {
      return "";
    }
    for (const part of body.split(`--${boundary}`)) {
      const separatorIndex = part.indexOf("\r\n\r\n");
      if (separatorIndex === -1) {
        continue;
      }
      const partHeaders = part.slice(0, separatorIndex);
      if (/name="manifest"/i.test(partHeaders)) {
        return JSON.parse(part.slice(separatorIndex + 4).trim()).id ?? "";
      }
    }
    return "";
  }
  if (contentType.includes("json")) {
    return JSON.parse(body).id ?? "";
  }
  return "";
}

async function requestManifest(platform) {
  const easClientId = crypto.randomUUID().toUpperCase();
  const result = {
    platform,
    runtimeVersion,
    channel,
    easClientId,
    status: "",
    updateId: "",
    response: "",
  };
  try {
    const response = await fetch(updateUrl, {
      headers: buildHeaders(platform, easClientId),
    });
    const body = await response.text();
    result.status = response.status;
    result.response = body.slice(0, 300);
    if (response.ok) {
      try {
        result.updateId = getUpdateId(response.headers.get("content-type") ?? "", body);
      } catch {
        // The response preview shows what came back
      }
    }
  } catch (error) {
    result.response = `Request failed: ${error.message}`.slice(0, 300);
  }
  return result;
}

async function runAll(tasks) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
      done++;
      process.stdout.write(`\r${done}/${tasks.length} requests complete`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return results;
}

function toCsvValue(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  console.log(`Requesting ${updateUrl}`);
  console.log(`Channel: ${channel}, runtime version: ${runtimeVersion}, ${count} requests per platform`);

  const tasks = [];
  for (const platform of ["android", "ios"]) {
    for (let i = 0; i < count; i++) {
      tasks.push(() => requestManifest(platform));
    }
  }
  const results = await runAll(tasks);

  const columns = [
    ["platform", "platform"],
    ["runtime_version", "runtimeVersion"],
    ["channel", "channel"],
    ["eas_client_id", "easClientId"],
    ["http_status", "status"],
    ["update_id", "updateId"],
    ["response_preview", "response"],
  ];
  const lines = [columns.map(([header]) => header).join(",")];
  for (const result of results) {
    lines.push(columns.map(([, key]) => toCsvValue(result[key])).join(","));
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n") + "\n");

  const statusCounts = {};
  for (const result of results) {
    const key = `${result.platform} ${result.status || "error"}`;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  console.log("Results by platform and status:", statusCounts);

  const updateIdCounts = {};
  for (const result of results) {
    const key = `${result.platform} ${result.updateId || "(no update ID)"}`;
    updateIdCounts[key] = (updateIdCounts[key] ?? 0) + 1;
  }
  console.log("Results by platform and update ID:", updateIdCounts);
  console.log(`Wrote ${outFile}`);
}

main();
