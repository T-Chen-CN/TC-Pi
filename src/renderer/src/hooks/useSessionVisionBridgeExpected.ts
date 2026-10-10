/** Native image input remains available; the separate vision bridge was removed. */
export function useSessionVisionBridgeExpected(_sessionId: string, _hasUserImages: boolean): boolean {
	return false;
}
