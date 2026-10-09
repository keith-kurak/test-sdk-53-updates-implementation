// Copied verbatim from the app's src/utils/common.utils.ts (CommonUtils.promiseWithTimeout).
export class CommonUtils {
	// Timeout guard for any promise that has no timeout of its own (e.g. expo-updates
	// checkForUpdateAsync / fetchUpdateAsync).
	public static promiseWithTimeout<T>(promise: Promise<T>, timeout: number, label = 'Operation'): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => {
					const err = new Error(`${label} timeout`) as Error & { isTimeout?: boolean }
					err.isTimeout = true
					reject(err)
				}, timeout),
			),
		])
	}
}
