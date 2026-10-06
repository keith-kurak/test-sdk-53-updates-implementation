# Minimal reproduction of an EAS Update setup

Use this repo as a starting point to copy your EAS Update implementation into a small, clean project. The goal is a project that has the same package versions, the same update configuration, and the same `expo-updates` code as the your app, and nothing else.

This project starts from the default `create-expo-app` template for **Expo SDK 53**, and uses **npm** (`package-lock.json`).

> Expo changes between SDK versions. Always use the docs for your SDK version:
> `https://docs.expo.dev/versions/v<major>.0.0/sdk/updates/`

## What you need from the customer

Collect these items before you start:

- `package.json` and the lock file (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`)
- `app.json`, `app.config.js`, or `app.config.ts` (also the resolved config: `npx expo config --type public`)
- How they build the app: EAS Build, local Xcode / Android Studio, Fastlane, or another CI service
- `eas.json`, only if they build with EAS Build
- All files that import `expo-updates` (search for `expo-updates` in the project)
- Config plugins that change update behavior (local plugins in the repo, or third-party plugins)
- If you do not use Continuous Native Generation: the update keys in `ios/<App>/Supporting/Expo.plist` and `android/app/src/main/AndroidManifest.xml`
- Build scripts that change update settings during the build (for example, a CI step that writes `expo-channel-name` into `Expo.plist` or `AndroidManifest.xml`)
- The exact EAS CLI version and the commands you use to publish updates

## Step 1: Set the package versions to the exact versions of the customer's app

The bug can depend on one patch version, so use exact versions.

1. Find the installed versions in the customer's lock file, not only in `package.json`. A range such as `~0.28.0` in `package.json` can resolve to different versions. If you can run commands in their project, use:

   ```bash
   npm ls expo expo-updates react-native expo-dev-client expo-router
   ```

2. In this repo, set the same versions in `package.json`. Write exact versions (no `~` or `^`) for the important packages:
   - `expo`
   - `expo-updates`
   - `react-native`
   - `react` and `react-dom`
   - `expo-dev-client` (if they use it)
   - `expo-router` (if they use it)
   - All other packages that their update code imports, or that add native code relevant to the issue (for example, `expo-splash-screen` or `expo-asset`)

3. If the customer uses a different SDK major version than this repo, use the customer's version. Do not upgrade or downgrade the customer's versions.

4. Install the dependencies:

   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

5. Make sure that the installed versions are correct:

   ```bash
   npm ls expo expo-updates react-native
   ```

6. Optional: run `npx expo-doctor`. If it reports version mismatches that the customer also has, **keep them**. A mismatch can be the cause of the problem. Do not run `npx expo install --fix`, because it changes the versions that you copied.

7. If the customer uses a different package manager (yarn, pnpm, bun), use the same one. Package managers can install dependencies in different ways.

## Step 2: Add all relevant configuration to `app.json`

Copy only the configuration that affects updates. Do not copy the customer's `owner`, `slug`, `projectId`, or bundle identifiers. You use your own EAS project in Step 4.

1. Copy these fields from the customer's config to `expo` in `app.json`. Keep the same values and the same structure:

   | Field | Notes |
   | --- | --- |
   | `runtimeVersion` | Copy the string or the policy (`appVersion`, `nativeVersion`, `fingerprint`). Also copy `ios.runtimeVersion` and `android.runtimeVersion` if they exist. |
   | `version`, `ios.buildNumber`, `android.versionCode` | Needed if the runtime version policy is `appVersion` or `nativeVersion`. |
   | `updates.enabled` | |
   | `updates.checkAutomatically` | `ON_LOAD`, `ON_ERROR_RECOVERY`, `WIFI_ONLY`, or `NEVER`. |
   | `updates.fallbackToCacheTimeout` | |
   | `updates.useEmbeddedUpdate` | |
   | `updates.requestHeaders` | Copy the keys. Change the values only if they contain secrets. |
   | `updates.codeSigningCertificate`, `updates.codeSigningMetadata` | If the customer uses code signing, configure it here with the same `codeSigningMetadata` (`keyid` and `alg`). Make your own certificate and private key with `npx expo-updates codesigning:generate`. Do not use the customer's keys. Publish updates with `--private-key-path`. |
   | `updates.assetPatternsToBeBundled` | |
   | `updates.disableAntiBrickingMeasures` | |
   | `updates.enableBsdiffPatchSupport` | |
   | `plugins` | Copy `expo-updates` and all plugins that change native startup or update behavior. |

   The full list of update fields for SDK 53 is in the [expo-updates configuration table](https://docs.expo.dev/versions/v53.0.0/sdk/updates/#configuration).

2. Do **not** copy `updates.url` or `extra.eas.projectId`. You set these values in Step 4.

3. If the customer uses `app.config.js` or `app.config.ts` with dynamic logic (for example, a different runtime version for each environment), copy that logic. Then compare the resolved output of the two projects:

   ```bash
   npx expo config --type public
   ```

4. If the customer builds with EAS Build, copy the update-related parts of their `eas.json` to a new `eas.json` in this repo. If they do not use EAS Build, skip this item. Find out how they set the channel instead (see items 5 and 6).
   - The `channel` of each build profile
   - `distribution`, `developmentClient`, and `env` values that change how the app starts
   - The `cli.version` and `cli.appVersionSource` values

   Example:

   ```json
   {
     "cli": {
       "version": ">= 16.0.0",
       "appVersionSource": "remote"
     },
     "build": {
       "preview": {
         "distribution": "internal",
         "channel": "preview"
       },
       "production": {
         "channel": "production"
       }
     }
   }
   ```

5. If the customer has `ios/` and `android/` directories in source control, the native files can override `app.json`. In that case, also copy the update keys from `Expo.plist` and `AndroidManifest.xml` (for example, `EXUpdatesRuntimeVersion` and `expo.modules.updates.EXPO_RUNTIME_VERSION`). If the customer uses Continuous Native Generation, do not add `ios/` or `android/` to this repo.

6. Find all build scripts that change update settings, and copy their behavior. These scripts run after `app.json` is read, so `npx expo config` does not show their changes. Look in:
   - CI configuration (GitHub Actions, Bitrise, CircleCI, `.eas/workflows/`)
   - Fastlane lanes
   - `package.json` scripts, such as `eas-build-pre-install` and `eas-build-post-install`
   - Shell scripts that run `sed`, `PlistBuddy`, or similar tools on native files
   - Config plugins that read environment variables

   Typical changes:
   - Write `expo-channel-name` into `EXUpdatesRequestHeaders` in `Expo.plist`, or into `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` in `AndroidManifest.xml`
   - Set `updates.url`, `runtimeVersion`, or `updates.enabled` for each environment
   - Change the code signing certificate for each environment

   Add an equivalent script to this repo, or apply the same values manually before you build. Write down which method you used.

## Step 3: Add the `expo-updates` code to the app

The reproduction must call `expo-updates` in the same way and at the same time as the customer's app.

1. Find every reference to the library in the customer's project:

   ```bash
   grep -rn "expo-updates" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . | grep -v node_modules
   ```

2. For each reference, copy the update logic to this repo. Remove code that is not related to updates, such as API calls, analytics, and app screens. Keep these items the same:
   - The API calls, such as `checkForUpdateAsync()`, `fetchUpdateAsync()`, `reloadAsync()`, and `useUpdates()`
   - The order of the calls
   - When the calls occur (for example, at startup, in the root layout, on `AppState` change, or from a button)
   - The error handling (`try`/`catch`, retries, and timeouts)
   - The interaction with the splash screen (`SplashScreen.preventAutoHideAsync()` and `hideAsync()`)

3. Put the code in the equivalent location in this repo. Routes are in the `app/` directory. The root layout is `app/_layout.tsx`.

4. Show the update state on the screen, so you can see which update runs. For example, add this to `app/(tabs)/index.tsx`:

   ```tsx
   import * as Updates from 'expo-updates';

   // ...

   <ThemedView>
     <ThemedText>Message: Update 1</ThemedText>
     <ThemedText>Channel: {Updates.channel ?? 'none'}</ThemedText>
     <ThemedText>Runtime version: {Updates.runtimeVersion ?? 'none'}</ThemedText>
     <ThemedText>Update ID: {Updates.updateId ?? 'none'}</ThemedText>
     <ThemedText>Embedded launch: {String(Updates.isEmbeddedLaunch)}</ThemedText>
     <ThemedText>Emergency launch: {String(Updates.isEmergencyLaunch)}</ThemedText>
   </ThemedView>
   ```

   Change the `Message` text each time you publish an update. Then you can see which version runs.

5. If the customer does not have a manual check, you can add one to test. Use the [manual check example](https://docs.expo.dev/versions/v53.0.0/sdk/updates/#example-check-for-updates-manually) from the docs. Make a note in the reproduction that this code is not from the customer's app.

6. Run lint and typecheck:

   ```bash
   npx expo lint
   npx tsc --noEmit
   ```

## Step 4: Test against an EAS project by publishing an update and running the app

Use your own Expo account and a new EAS project. Do not publish to the customer's project.

1. Log in and link this repo to a new EAS project. This command adds `extra.eas.projectId` and `owner` to `app.json`:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

2. Configure EAS Update. This command adds `updates.url` to `app.json`. Make sure that it did not change the `runtimeVersion` that you copied in Step 2:

   ```bash
   npx eas-cli@latest update:configure
   ```

   If the customer uses a specific EAS CLI version, use `npx eas-cli@<version>` for all commands.

3. Make a **release** build in the same way as the customer. The full Updates API is not available in Expo Go or in a development build.

   If the customer uses EAS Build, use the same profile:

   ```bash
   npx eas-cli@latest build --profile preview --platform android
   npx eas-cli@latest build --profile preview --platform ios
   ```

   If the customer does not use EAS Build, make a local release build:

   ```bash
   npx expo run:android --variant release
   npx expo run:ios --configuration Release
   ```

   A local build does not get a channel from `eas.json`. Set the channel in the same way as the customer: with `updates.requestHeaders` in `app.json`, or with the build script from Step 2, item 6. Run that script at the same point in the build as the customer does.

4. Install the build on a device, emulator, or simulator. Open the app. Make sure that the screen shows:
   - `Message: Update 1`
   - `Embedded launch: true`
   - The expected channel and runtime version

5. Change the `Message` text to `Update 2`. Publish an update to the same channel as the build:

   ```bash
   npx eas-cli@latest update --channel preview --message "Update 2"
   ```

   Use the same flags as the customer (for example, `--platform`, `--environment`, or `--branch`).

6. Make sure that the update has the same runtime version as the build:

   ```bash
   npx eas-cli@latest update:list
   ```

7. Close the app fully and open it again. With the default `checkAutomatically: ON_LOAD` and `fallbackToCacheTimeout: 0`, the app downloads the update on the first launch and runs it on the **next** launch. Thus, you may need to close and open the app two times. If the customer's config is different, follow their expected behavior.

8. Make sure that the screen shows `Message: Update 2`, `Embedded launch: false`, and an update ID that is the same as the one from `eas update`.

9. Do the customer's steps to cause the problem. Record:
   - What you expected and what occurred
   - The device logs: `adb logcat` on Android, or Console.app / `xcrun simctl spawn booted log stream` on iOS. Filter the logs for `expo-updates` or `dev.expo.updates`.
   - The values on the screen from Step 3
   - The build ID and the update group ID from EAS

## Step 5: Share the reproduction

1. Remove secrets and customer-specific data (API keys, private URLs, user data).
2. Commit the changes. Make a note of the files that you added or changed and why.
3. In the issue or support ticket, include:
   - A link to this repo
   - The SDK, `expo-updates`, and EAS CLI versions
   - The build profile and channel
   - The exact commands to build and publish
   - The steps to cause the problem, and the expected and actual results

## Checklist

- [ ] Package versions are the same as the customer's lock file
- [ ] `npm ls expo expo-updates react-native` shows the correct versions
- [ ] All update fields and relevant plugins are in `app.json`
- [ ] Code signing (if used) is configured in `app.json` with your own keys
- [ ] The channel is set in the same way as the customer (`eas.json`, `app.json`, or a build script)
- [ ] Build scripts that change update settings are copied or applied manually
- [ ] All `expo-updates` code is copied, in the same location and order
- [ ] The screen shows the channel, runtime version, and update ID
- [ ] `npx expo lint` and `npx tsc --noEmit` pass
- [ ] A release build runs the embedded update
- [ ] A published update downloads and runs
- [ ] The customer's problem occurs (or does not occur) in the reproduction
