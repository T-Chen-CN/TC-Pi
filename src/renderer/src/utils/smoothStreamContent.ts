export type SmoothStreamChange = { kind: "none" } | { kind: "append"; delta: string } | { kind: "rewind"; text: string } | { kind: "ignore" } | { kind: "replace"; text: string };

export function classifySmoothStreamChange(prevContent: string, displayed: string, nextContent: string): SmoothStreamChange {
	if (nextContent === prevContent) return { kind: "none" };
	if (nextContent.startsWith(prevContent)) {
		const delta = nextContent.slice(prevContent.length);
		return delta ? { kind: "append", delta } : { kind: "none" };
	}
	if (displayed.startsWith(nextContent)) {
		return { kind: "rewind", text: nextContent };
	}
	if (nextContent.length > 0 && nextContent.length < displayed.length && displayed.endsWith(nextContent)) {
		return { kind: "ignore" };
	}
	return { kind: "replace", text: nextContent };
}
