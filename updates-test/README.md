# Verify that clients get the published update

Use these two scripts after you publish an update. They tell you if the update that EAS Update sends to clients is the same as the update that you published.

| Script | What it checks |
| --- | --- |
| `check-latest-update.cjs` | **The server.** Uses the EAS CLI to find the latest update for a channel and runtime version. |
| `simulate-manifest-requests.cjs` | **The clients.** Sends 100 Android and 100 iOS manifest requests, the same as real app launches, and records the update that each request gets. |

If the two scripts show the same update IDs, the server sends the published update to clients. If they do not, the CSV files show which requests got a different update, or got an error.

## Requirements

- **Node.js 20 or newer.** The scripts use only modules that are built into Node. They do not need `npm install`, and they do not use the packages in your project.
- **The EAS CLI, logged in** to an account that can see the project (`npx eas-cli@latest login`). Only `check-latest-update.cjs` uses the EAS CLI. It runs the EAS CLI with `npx`, so the EAS CLI does not need to be installed.
- **An Expo project that is linked to the EAS project.** `check-latest-update.cjs` runs the EAS CLI in this project's directory. The project ID that `eas project:info` shows must be the same as `--project-id`.

## Copy the scripts to your project

1. Copy the `updates-test` folder to the root of the project that you want to test. Copy the full folder, including the hidden `.gitignore` file:

   ```bash
   cp -R updates-test /path/to/your-project/
   ```

   The result is:

   ```text
   your-project/
   ├── app.json (or app.config.js / app.config.ts)
   ├── package.json
   └── updates-test/
       ├── .gitignore
       ├── README.md
       ├── check-latest-update.cjs
       └── simulate-manifest-requests.cjs
   ```

2. Run the commands in this README from the root of your project.

The scripts use the `.cjs` extension, so they work also in a project that has `"type": "module"` in `package.json`.

`check-latest-update.cjs` runs the EAS CLI in the parent of the `updates-test` folder. If you put the folder in a different location, use `--project-dir` to point to the project root. In a monorepo, use the folder of the app (for example, `--project-dir apps/mobile`).

The scripts write the CSV files to `updates-test/output/`. The `updates-test/.gitignore` file tells Git to ignore this folder. You can delete the `updates-test` folder when you are done.

## Parameters

Both scripts take the same three parameters:

| Parameter | Description | Where to find it |
| --- | --- | --- |
| `--project-id` | The EAS project ID | `extra.eas.projectId` in the app config, or the end of `updates.url` |
| `--channel` | The channel that the build uses | `channel` in the `eas.json` build profile, or `expo-channel-name` in `updates.requestHeaders` |
| `--runtime-version` | The runtime version of the build | The `runtimeVersion` value for the build. For a policy, use the resolved value (for example, the app version for `appVersion`). |

Use the values of the build that has the problem. If the values are not correct, the scripts do not test the same thing that the app does.

Other options:

| Script | Option | Default | Description |
| --- | --- | --- | --- |
| Both | `--out` | A file name with a timestamp, in `updates-test/output/` | The CSV output path |
| `check-latest-update.cjs` | `--project-dir` | The parent of the `updates-test` folder | The directory of the Expo project that is linked to `--project-id` |
| `check-latest-update.cjs` | `--eas-cli-version` | `latest` | The EAS CLI version for `npx eas-cli@<version>` |
| `simulate-manifest-requests.cjs` | `--count` | `100` | The number of requests for each platform |
| `simulate-manifest-requests.cjs` | `--concurrency` | `10` | The number of requests that run at the same time |

## Procedure

Run these steps after each update that you publish.

### Step 1: Publish the update

```bash
npx eas-cli@latest update --channel preview --message "Update 2"
```

Write down the update group ID and the Android and iOS update IDs from the output.

### Step 2: Check the update on the server

```bash
node updates-test/check-latest-update.cjs \
  --project-id <project-id> \
  --channel preview \
  --runtime-version 1.0.0
```

The script does these steps:

1. Gets the channel with `eas channel:view`.
2. Reads the branch mapping of the channel. It finds the branch that a client with this runtime version gets.
3. For each platform, gets the latest update on that branch for this runtime version with `eas update:list`.
4. Gets the platform-specific update ID with `eas update:view`.

The output is a CSV file (`updates-test/output/server-update-<timestamp>.csv`) with one row for each platform and branch:

| Column | Description |
| --- | --- |
| `platform` | `android` or `ios` |
| `runtime_version`, `channel` | The parameters |
| `branch` | The branch that the channel points to |
| `branch_condition` | `always` if every client gets this branch. Otherwise, the branch mapping rule (for example, a branch rollout). |
| `update_group_id` | The update group ID |
| `update_id` | The platform-specific update ID. This is the ID that the client gets in the manifest. |
| `created_at` | When the update was published |
| `message` | The update message |
| `rollout_percentage` | The rollout percentage of the update, if the update has a rollout |
| `is_rollback_to_embedded` | `true` if the update is a rollback to the embedded update |

Make sure that `update_id` is the same as the update that you published in Step 1. If it is different, the problem is in the publish step or in the channel configuration, not in the client.

### Step 3: Check what clients get

```bash
node updates-test/simulate-manifest-requests.cjs \
  --project-id <project-id> \
  --channel preview \
  --runtime-version 1.0.0
```

The script sends 200 GET requests to `https://u.expo.dev/<project-id>`. Each request has the same headers as the `expo-updates` client in SDK 53, and a new random `EAS-Client-ID`. The script reads the update ID from the manifest in each response.

The output is a CSV file (`updates-test/output/manifest-results-<timestamp>.csv`) with one row for each request:

| Column | Description |
| --- | --- |
| `platform` | `android` or `ios` |
| `runtime_version`, `channel` | The parameters |
| `eas_client_id` | The random client ID of the request |
| `http_status` | The HTTP status code. Empty if the request failed before a response. |
| `update_id` | The update ID in the manifest. Empty if the response has no manifest. |
| `response_preview` | The first 300 characters of the response body |

The script also shows a summary of the results for each platform, by HTTP status and by update ID. For example:

```text
Results by platform and status: { 'android 200': 100, 'ios 200': 100 }
Results by platform and update ID: {
  'android 01a0452c-eb96-745d-a138-aef2073a77c3': 100,
  'ios 01a0452c-eb96-7199-be8a-13d9469ed091': 100
}
```

### Step 4: Compare the results

Compare the update IDs from the summary in Step 3 with the `update_id` column from Step 2.

| Result | Meaning |
| --- | --- |
| All requests have the same update ID as Step 2 | The server sends the published update to clients. If an app does not get the update, look at the app: its configuration, its `expo-updates` code, or its network. |
| Some requests have a different update ID | Look for a rollout. An update rollout (`rollout_percentage`) or a branch rollout (`branch_condition`) sends different updates to different clients. The split is approximately the rollout percentage. |
| All requests have a different update ID | The server sends a different update than the latest update. Look at the branch mapping of the channel and the runtime version. Compare the `response_preview` and the update ID with `eas update:view <update-id>`. |
| Requests have no update ID and a 2xx HTTP status | The response has no manifest. Possibly, the server has no update for this channel and runtime version, and clients run the embedded update. Read `response_preview` to see what the server sent. |
| Requests have HTTP status 4xx or 5xx | Read `response_preview`. Typical causes are a project ID that is not correct, or a channel that does not exist. |

## Limitations

- The simulated requests are the same as the first launch of a new install. They do not send `expo-embedded-update-id`, `expo-current-update-id`, or `expo-recent-failed-update-ids`. These headers come from the app's local database. A real client that already has an update can get a different response.
- The simulated requests do not send `expo-expect-signature`. If the app uses code signing, the response does not have a signature.
- `check-latest-update.cjs` evaluates branch mapping rules that use the runtime version. It cannot evaluate rules that depend on the client, such as a branch rollout. For these rules, it shows all branches that a client can get.
- `check-latest-update.cjs` does not include rollouts for the update itself in the branch result. It shows the latest update and its `rollout_percentage`. Clients that are not in the rollout get the update before it.
- Each run of `simulate-manifest-requests.cjs` sends 200 manifest requests to the EAS project, each with a new client ID. These requests can show in the project's update usage and insights. Use `--count` to send fewer requests, and do not run it against a production project unless you accept this.
