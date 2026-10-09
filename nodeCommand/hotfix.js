// Equivalent of the app's `yarn hotfix` (nodeCommand/hotfix.js), used to publish an update.
// Steps kept, in the same order:
//   1. validate platform / env / versions (same lists and version format as hotfix.js)
//   2. yarn install
//   3. app.json: runtimeVersion = <expoRuntimeVersion>, requestHeaders.expo-channel-name = <env>
//                (updateSettingFile → utils.js readAndUpdateSetting 'appJson')
//   4. eas update -p <platform> --branch <env> --message "Hotfix: <ENV> - <JSVersion> - <expoRuntimeVersion> - <message>"
// We publish with --branch (not --channel). The channel with the same name is linked to that branch on EAS.
// Runs the globally installed `eas`, same as the app (eas-cli/16.4.1).
// Not copied (not update-related): swimlane URL / FPMS platform env-file rewrites, AppENV.js, the console banners and delays.
//
// Usage: node nodeCommand/hotfix.js <android|ios|all> <qat|uat|preprod|prod> <JSVersion> <expoRuntimeVersion> [message]
// e.g.   node nodeCommand/hotfix.js all uat 4.0.200 4.1.171 'Update 2'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = process.cwd()
const appJsonPath = path.join(root, 'app.json')
const platforms = ['android', 'ios', 'all']
const envs = ['QAT', 'UAT', 'PROD', 'PREPROD']
const isStrictVersion = s => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(s || '').trim())

const cli_platform = process.argv[2]
const cli_env = (process.argv[3] || '').toUpperCase()
const cli_JSVersion = process.argv[4]
const cli_expoRuntimeVersion = process.argv[5]
const cli_message = process.argv[6]

function userCancel(msg) {
	console.error(msg)
	console.error(
		'Usage: node nodeCommand/hotfix.js <android|ios|all> <qat|uat|preprod|prod> <JSVersion> <expoRuntimeVersion> [message]',
	)
	process.exit(1)
}
if (!platforms.includes(cli_platform)) {
	userCancel(`Invalid platform: ${cli_platform}, valid platforms: ${platforms.join(', ')}`)
}
if (!envs.includes(cli_env)) {
	userCancel(`Invalid env: ${cli_env}, valid envs: ${envs.join(', ').toLowerCase()}.`)
}
if (!isStrictVersion(cli_JSVersion)) {
	userCancel('Invalid JS Version')
}
if (!isStrictVersion(cli_expoRuntimeVersion)) {
	userCancel('Invalid Expo Runtime Version')
}

function run(cmd, args) {
	console.log(`> ${cmd} ${args.join(' ')}`)
	const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
	if (result.status !== 0) process.exit(result.status ?? 1)
}

// (2)
run('yarn', ['install'])

// (3)
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
appJson.expo.runtimeVersion = cli_expoRuntimeVersion
appJson.expo.requestHeaders = { ...(appJson.expo.requestHeaders || {}), 'expo-channel-name': cli_env.toLowerCase() }
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8')

// (4)
run('eas', [
	'update',
	'-p',
	cli_platform,
	'--branch',
	cli_env.toLowerCase(),
	'--message',
	`Hotfix: ${cli_env} - ${cli_JSVersion} - ${cli_expoRuntimeVersion} ${cli_message ? `- ${cli_message}` : ''}`,
])
