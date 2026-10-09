# Reproduction notes

Problem: after we publish an update, some clients take up to ~1 hour to get it.

## Versions

The `expo-*`, `react` and `react-native*` entries in `package.json` are the same as in the app's `package.json`, including the
same ranges (for example `"expo-updates": "~0.28.12"`). The other `expo-*` packages are the native Expo modules the app ships.

| Package | Version in the app's `package.json` |
| --- | --- |
| expo | 53.0.19 |
| expo-updates | ~0.28.12 |
| expo-splash-screen | ^0.30.8 |
| react-native | 0.79.1 (New Architecture enabled on both platforms, same as the SDK 53 default) |
| react | 19.0.0 |
| EAS CLI | 16.4.1 (global `eas`) |
| Package manager | yarn 1.22 (same as the app) |

The app uses react-navigation, not `expo-router`. This repo keeps the template's `expo-router` setup, because navigation does
not affect updates. The template's other dependencies are unchanged, except `query-string@7.1.3`, which was added because
`expo-router` 5.1.11 imports it without declaring it and the template's `@react-navigation/native` 7.5.0 no longer brings it in.
Without it, the release bundle fails with "Unable to resolve module query-string".

## Update configuration

The app is a **bare** React Native project (`ios/` and `android/` are checked in, no CNG). The native files are the source of truth:

| Setting | iOS `Expo.plist` | Android `AndroidManifest.xml` |
| --- | --- | --- |
| enabled | `EXUpdatesEnabled = true` | `expo.modules.updates.ENABLED = true` |
| check on launch | `EXUpdatesCheckOnLaunch = NEVER` | `EXPO_UPDATES_CHECK_ON_LAUNCH = NEVER` |
| launch wait | `EXUpdatesLaunchWaitMs = 0` | `EXPO_UPDATES_LAUNCH_WAIT_MS = 0` |
| runtime version | `EXUpdatesRuntimeVersion = 4.1.171` (written by build script) | `EXPO_RUNTIME_VERSION = ${expoRuntimeVersion}` (gradle `-Pexpo_runtime_version`) |
| channel | `EXUpdatesRequestHeaders.expo-channel-name = uat` (written by build script) | `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY = {"expo-channel-name":"${expoChannelName}"}` (gradle `-Pexpo_channel_name`) |
| URL | `EXUpdatesURL = https://u.expo.dev/<projectId>` | `EXPO_UPDATE_URL = ${expoUpdateUrl}` (gradle `-Pexpo_update_url`) |

No code signing, no `assetPatternsToBeBundled`, no bsdiff, no anti-bricking override. No custom native code touches expo-updates.

`app.json` is the same as the app's `app.json`, except the names. `extra.eas.projectId` and `updates.url` are placeholders
(`[projectId]`, `[update-url]`): replace them with the new EAS project's values (from `eas init` / `eas update:configure`) before building or publishing.

**Channel — set it yourself when you build.** Like the app's, `app.json` has the channel at `expo.requestHeaders`, not at
`expo.updates.requestHeaders`. Expo ignores the key there, so a native project generated from this `app.json` has **no**
`expo-channel-name`. In the app, the channel comes only from the build script (see **Builds**), which writes it into the native
files. This repo has no build script. After `npx expo prebuild`, add the channel to the native files before building, the same as
the app's build script does:

- iOS `ios/<App>/Supporting/Expo.plist`: `EXUpdatesRequestHeaders` → `expo-channel-name` = `uat`
- Android `android/app/src/main/AndroidManifest.xml`:
  `<meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;uat&quot;}"/>`

### Builds

Not EAS Build. Jenkins runs `yarn releaseBuild <platform> <env> <JSVersion> <expoRuntimeVersion> <fpmsPlatformId> <buildNumber> <flavor> <splitApk>`
(`nodeCommand/releaseBuild.js` → `build.js`). The interactive form of the same script is `yarn release:build`. The update-related steps:

1. `yarn install`
2. `app.json` `runtimeVersion` = `<expoRuntimeVersion>`, `requestHeaders.expo-channel-name` = `<env>`
3. iOS: rewrite `Expo.plist` `EXUpdatesRuntimeVersion`, `EXUpdatesRequestHeaders.expo-channel-name` = `<env>`, `EXUpdatesURL` → `pod install` → `xcodebuild archive`
4. Android: `./gradlew assemble<Flavor>Release -Pexpo_runtime_version=<rv> -Pexpo_channel_name=<env> -Pexpo_update_url=https://u.expo.dev/<projectId>`
   (gradle `manifestPlaceholders` → `AndroidManifest.xml` meta-data)

This repo has no build script. Run `npx expo prebuild`, add the channel to the native files (see **Channel** above), then build a
release with `npx expo run:android --variant release` or `npx expo run:ios --configuration Release`.

No `eas.json`: we don't use EAS Build, and `eas update` doesn't need `eas.json`.

### Publishing

We publish with `yarn hotfix <platform> <env> <JSVersion> <expoRuntimeVersion> <message> [swimlaneUrl] [fpmsPlatformId]`
(`nodeCommand/hotfix.js`). It validates the arguments, runs `yarn install`, sets `runtimeVersion` and
`requestHeaders.expo-channel-name` in `app.json`, then runs the globally installed EAS CLI (16.4.1):

```bash
eas update -p <android|ios|all> --branch <qat|uat|preprod|prod> --message "Hotfix: <ENV> - <JSVersion> - <expoRuntimeVersion> - <message>"
```

In this repo: `yarn hotfix <android|ios|all> <env> <JSVersion> <expoRuntimeVersion> [message]` (`nodeCommand/hotfix.js`)
does the same steps and runs the same command. The swimlane URL and FPMS platform arguments are left out, because they only
rewrite the app's env files.

We publish with `--branch`, **not** `--channel`. Channel `uat`/`prod` is linked to the branch with the same name on EAS.

## `expo-updates` code (cold-start flow only, same order and timing as the app)

| Repo file | App file | What it does |
| --- | --- | --- |
| `app/_layout.tsx` | `index.js` + `App.tsx` / `AppController.tsx` | `SplashScreen.preventAutoHideAsync()` at module load. On cold start, renders `UpdateChecker` before the app UI, then the router `Stack` when it completes |
| `src/components/updateChecker/*` | `src/components/updateChecker/*` | `SplashScreen.hideAsync()` on mount → after 100 ms `checkForUpdateAsync()` (10 s timeout) → if an update is available, `fetchUpdateAsync()` (30 s timeout) → `reloadAsync()`. On error or timeout: a blocking "Try Again" prompt that retries the download (release builds only) |
| `src/services/commonUtils.ts` | `src/utils/common.utils.ts` | `promiseWithTimeout` (copied verbatim) |

Kept out on purpose, to keep the demo simple: the app's second, quiet check when Home re-mounts, the AppState-driven reload, the
reload screen, and reloads triggered by business events (network error, maintenance). Also removed because they are not
update-related: the IP-restriction / remote-config / WAF checks, the store-version backend check, analytics, websocket handling
and the loading bar.

Added for the reproduction (not from the app): the update-state panel in `app/(tabs)/index.tsx`.
