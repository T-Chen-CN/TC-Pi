import { win32, posix } from "node:path";
import { canonicalizeSessionPath } from "../../shared/sessionIdentity";

/** Rewrite installation-owned references, preserving external paths and stable identities. */
export function relocateStorageValue(value: unknown, mappings: ReadonlyArray<readonly [string, string]>): unknown {
	if (typeof value === "string") {
		if (/^[!+-](?:[A-Za-z]:[/\\]|[/\\])/.test(value)) return value[0] + relocateStorageValue(value.slice(1), mappings);
		for (const [from, to] of mappings) {
			const candidate = value.replace(/\\/g, "/"),
				prefix = from.replace(/\\/g, "/");
			const windows = /^[A-Za-z]:\//.test(prefix) || prefix.startsWith("//");
			const a = windows || process.platform === "darwin" ? candidate.toLowerCase() : candidate;
			const b = windows || process.platform === "darwin" ? prefix.toLowerCase() : prefix;
			if (a === b || a.startsWith(b + "/")) return (windows ? win32 : posix).join(to, candidate.slice(prefix.length));
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => relocateStorageValue(item, mappings));
	if (value && typeof value === "object") {
		const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "id" ? item : relocateStorageValue(item, mappings)]));
		if ("filePath" in value && typeof value.filePath === "string" && typeof result.filePath === "string" && "originKey" in value && typeof value.originKey === "string") {
			const environment = "environment" in value && value.environment === "wsl" ? "wsl" : "native";
			result.originKey = value.originKey.replace(canonicalizeSessionPath(value.filePath, environment), canonicalizeSessionPath(result.filePath, environment));
		}
		return result;
	}
	return value;
}

/** Trust uses path keys; all other configuration follows the ordinary value relocation policy. */
export function relocateStorageMetadata(value: unknown, name: string, mappings: ReadonlyArray<readonly [string, string]>): unknown {
	const next = relocateStorageValue(value, mappings);
	if (name !== "trust.json" || !next || typeof next !== "object" || Array.isArray(next)) return next;
	return Object.fromEntries(
		Object.entries(next).map(([key, decision]) => {
			const relocated = relocateStorageValue(key, mappings);
			return [typeof relocated === "string" ? relocated : key, decision];
		}),
	);
}
