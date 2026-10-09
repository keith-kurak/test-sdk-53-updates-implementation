// Copied from the app's src/components/updateChecker/updateCheckerViewModel.ts — cold-start OTA flow only.
// The expo-updates calls, their order, timeouts, error handling and splash-screen handling are kept as in the app.
// All non-update logic (IP check, store-version check, analytics, quiet/AppState re-check) is removed.
import { useEffect } from 'react'
import { Alert } from 'react-native'
import * as Updates from 'expo-updates'
import * as SplashScreen from 'expo-splash-screen'
import { CommonUtils } from '../../services/commonUtils'

const UpdateCheckerViewModel = ({ onUpdateComplete }: { onUpdateComplete?: () => void }) => {
	useEffect(() => {
		// Hide the native splash the moment the update checker mounts (same as the app).
		SplashScreen.hideAsync().catch(() => {})
		setTimeout(async () => {
			await _checkForHotUpdate()
		}, 100)
	}, [])

	// OTA check/download failed → block on a single-button prompt and retry the download.
	const _showHotUpdateRetryPop = () => {
		Alert.alert('', 'Update failed due to a slow network connection. Please try again.', [
			{ text: 'Try Again', onPress: () => _fetchAndReload() },
		])
	}
	const _checkForHotUpdate = async () => {
		try {
			// checkForUpdateAsync has no timeout of its own — cap it at 10s.
			const result = await CommonUtils.promiseWithTimeout(Updates.checkForUpdateAsync(), 10000, 'checkForUpdateAsync')
			if (!result.isAvailable) {
				_onCheckHotUpdateComplete(true)
			} else {
				_fetchAndReload()
			}
		} catch (e: any) {
			console.warn('Update check failed', e)
			if (__DEV__) {
				_onCheckHotUpdateComplete(true)
				return
			}
			_showHotUpdateRetryPop()
		}
	}

	const _fetchAndReload = async () => {
		try {
			// Cap the wait at 30s — on timeout the native download keeps going and expo-updates applies it on the next launch.
			await CommonUtils.promiseWithTimeout(Updates.fetchUpdateAsync(), 30000, 'fetchUpdateAsync')
			await Updates.reloadAsync()
			_onCheckHotUpdateComplete()
		} catch (e: any) {
			console.warn('Update fetch failed', e)
			if (__DEV__) {
				_onCheckHotUpdateComplete(true)
				return
			}
			_showHotUpdateRetryPop()
		}
	}
	const _onCheckHotUpdateComplete = (isSuccess: boolean = false) => {
		if (isSuccess) {
			onUpdateComplete && onUpdateComplete()
		} else {
			setTimeout(() => {
				onUpdateComplete && onUpdateComplete()
			}, 5000)
		}
	}
}
export default UpdateCheckerViewModel
