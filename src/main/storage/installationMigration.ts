import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32, posix } from "node:path";
import { relocateInstallationSessions } from "./sessionRelocation";
import type { InstallPaths } from "./installPaths";
import { canonicalizeSessionPath } from "../../shared/sessionIdentity";

const MAX_CONFIG_BYTES = 16 * 1024 * 1024;
const DESKTOP_DIRECTORIES = new Set(["chat-workspace", "external-sessions", "drafts", "custom-themes", "sounds", "backgrounds", "host-plugins", "builtin-extensions", "skills-overlay", "prompts-overlay"]);
const BROWSER_NAMES = new Set(["Network", "Partitions", "Local Storage", "Session Storage", "IndexedDB", "Preferences", "Local State", "SharedStorage", "Shared Dictionary", "blob_storage"]);
const PI_DIRECTORIES = new Set(["sessions", "prompts", "skills", "extensions", "themes", "agents", "npm", "pi-subagents", "backups", "missions", "analytics", "agents-skills"]);

/** Change installation-owned path prefixes only; external project paths are deliberately retained. */
export function relocateStorageValue(value: unknown, mappings: ReadonlyArray<readonly [string, string]>): unknown {
	if (typeof value === "string") {
		if (/^[!+-](?:[A-Za-z]:[/\\]|[/\\])/.test(value)) return value[0] + relocateStorageValue(value.slice(1), mappings);
		for (const [from, to] of mappings) {
			const candidate = value.replace(/\\/g, "/");
			const prefix = from.replace(/\\/g, "/");
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
		// Stable identities stay unchanged; catalog deduplication keys must follow relocated files.
		if ("filePath" in value && typeof value.filePath === "string" && typeof result.filePath === "string" && "originKey" in value && typeof value.originKey === "string") {
			const environment = "environment" in value && value.environment === "wsl" ? "wsl" : "native";
			result.originKey = value.originKey.replace(canonicalizeSessionPath(value.filePath, environment), canonicalizeSessionPath(result.filePath, environment));
		}
		return result;
	}
	return value;
}

/** Copy without clobbering newer destination data or following untrusted directory links. */
function copyMissing(source: string, target: string): void {
	if (!existsSync(source)) return;
	const info = lstatSync(source);
	if (info.isSymbolicLink()) throw new Error("Migration source contains a symbolic link");
	if (info.isDirectory()) {
		if (existsSync(target) && (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink())) throw new Error("Migration destination is not an owned directory");
		mkdirSync(target, { recursive: true });
		for (const entry of readdirSync(source)) copyMissing(join(source, entry), join(target, entry));
	} else if (info.isFile() && !existsSync(target)) cpSync(source, target, { errorOnExist: true, force: false });
}

/** Copy native release trees verbatim: relative npm bin links remain relative inside the new runtime. */
function copyRuntime(source: string, target: string): void {
	if (!existsSync(source)) return;
	validateRuntimeLinks(source, source);
	if (existsSync(target)) validateRuntimeLinks(target, target);
	cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: false, force: false });
}

/** Relative npm links may stay inside a runtime; absolute or escaping links would retain global dependencies. */
function validateRuntimeLinks(root: string, path: string): void {
	const info = lstatSync(path);
	if (info.isSymbolicLink()) {
		const link = readlinkSync(path);
		const rel = relative(root, resolve(dirname(path), link));
		if (isAbsolute(link) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Runtime contains an external link");
	} else if (info.isDirectory()) for (const name of readdirSync(path)) validateRuntimeLinks(root, join(path, name));
}

/** Bounded JSON metadata rewrite, never auth or JSONL message contents. */
function rewriteConfig(path: string, mappings: ReadonlyArray<readonly [string, string]>): void {
	if (!existsSync(path) || lstatSync(path).size > MAX_CONFIG_BYTES) return;
	const before = readFileSync(path, "utf8");
	let value = relocateStorageValue(JSON.parse(before), mappings);
	// Pi trust decisions are keyed by path, unlike session catalogs keyed by stable identities.
	if (basename(path) === "trust.json" && value && typeof value === "object" && !Array.isArray(value)) {
		value = Object.fromEntries(
			Object.entries(value).map(([key, decision]) => {
				const relocated = relocateStorageValue(key, mappings);
				return [typeof relocated === "string" ? relocated : key, decision];
			}),
		);
	}
	const after = `${JSON.stringify(value, null, 2)}\n`;
	if (after !== before) writeFileSync(path, after, "utf8");
}

/** Relocate structured draft attachment references, leaving credential backups and message bodies opaque. */
function rewriteDesktopMetadata(root: string, mappings: ReadonlyArray<readonly [string, string]>): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isFile() && /\.json(?:\.bak)?$/.test(entry.name) && !/^auth(?:\.|$)/i.test(entry.name)) rewriteConfig(join(root, entry.name), mappings);
		else if (entry.isDirectory() && entry.name === "drafts") rewriteDraftMetadata(join(root, entry.name), mappings);
	}
}

/** Only bounded JSON draft manifests are rewritten; Markdown input text is retained verbatim. */
function rewriteDraftMetadata(root: string, mappings: ReadonlyArray<readonly [string, string]>): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) rewriteDraftMetadata(join(root, entry.name), mappings);
		else if (entry.isFile() && entry.name.endsWith(".json")) rewriteConfig(join(root, entry.name), mappings);
	}
}

export type InstallationMigrationResult = { desktopSource?: string; piSource?: string; alreadyComplete: boolean };

/** Migrate application data by copying; the original profile and Pi credentials remain untouched. */
export function migrateInstallationStorage(paths: InstallPaths, input: { desktopSources: readonly string[]; piSource: string; skip?: boolean }): InstallationMigrationResult {
	const marker = join(paths.data, "storage-layout.json");
	if (input.skip) return { alreadyComplete: true };
	if (existsSync(marker)) {
		const metadata: unknown = JSON.parse(readFileSync(marker, "utf8"));
		if (metadata && typeof metadata === "object" && "root" in metadata && typeof metadata.root === "string" && metadata.root !== paths.root) {
			const mappings: Array<readonly [string, string]> = [[metadata.root, paths.root]];
			mappings.unshift(...relocateInstallationSessions(paths.piSessions, mappings));
			rewriteDesktopMetadata(paths.desktop, mappings);
			for (const name of ["settings.json", "models.json", "trust.json"]) rewriteConfig(join(paths.piAgent, name), mappings);
			writeFileSync(marker, JSON.stringify({ ...metadata, root: paths.root }, null, 2));
		}
		return { alreadyComplete: true };
	}
	const desktopSource = input.desktopSources.find((source) => existsSync(join(source, "settings.json")) || existsSync(join(source, "session-catalog.json")));
	const mappings: Array<readonly [string, string]> = [
		[join(dirname(dirname(input.piSource)), ".agents", "skills"), paths.agentsSkills],
		[join(input.piSource, "install"), join(paths.runtimes, "pi", "install")],
		[join(input.piSource, "bin"), join(paths.runtimes, "pi", "bin")],
		[join(input.piSource, "win-git-bash"), join(paths.runtimes, "git")],
		[input.piSource, paths.piAgent],
	];
	if (desktopSource) {
		mappings.push([desktopSource, paths.desktop]);
		for (const entry of readdirSync(desktopSource)) {
			if (DESKTOP_DIRECTORIES.has(entry) || /\.json(?:\.bak)?$/.test(entry)) {
				if (/^(?:announcements-cache|usage-stats-cache|tokendance-models)\./.test(entry)) continue;
				copyMissing(join(desktopSource, entry), join(paths.desktop, entry));
			} else if (BROWSER_NAMES.has(entry)) copyMissing(join(desktopSource, entry), join(paths.browser, entry));
		}
		copyRuntime(join(desktopSource, "voice-runtime"), paths.voice);
		copyMissing(join(desktopSource, "logs"), paths.logs);
		copyMissing(join(desktopSource, "config-backups"), paths.backups);
		copyRuntime(join(desktopSource, "pi-runtime", "node"), join(paths.runtimes, "node"));
		copyRuntime(join(desktopSource, "pi-runtime", "pi-global"), join(paths.runtimes, "pi-global"));
	}
	if (existsSync(input.piSource)) {
		for (const entry of readdirSync(input.piSource)) {
			// Credentials are migrated later, only inside the Pi authentication host.
			if (/^auth(?:\.|$)/i.test(entry)) continue;
			if (PI_DIRECTORIES.has(entry) || /\.(?:json|md)$/.test(entry)) copyMissing(join(input.piSource, entry), join(paths.piAgent, entry));
		}
		copyRuntime(join(input.piSource, "install"), join(paths.runtimes, "pi", "install"));
		copyRuntime(join(input.piSource, "bin"), join(paths.runtimes, "pi", "bin"));
		copyRuntime(join(input.piSource, "win-git-bash"), join(paths.runtimes, "git"));
		copyMissing(join(dirname(dirname(input.piSource)), ".agents", "skills"), paths.agentsSkills);
		copyMissing(join(dirname(dirname(input.piSource)), ".gitconfig"), join(paths.data, "gitconfig"));
		copyMissing(join(dirname(dirname(input.piSource)), ".npmrc"), join(paths.data, "npmrc"));
	}
	const sessionMappings = relocateInstallationSessions(paths.piSessions, mappings);
	for (const [from, to] of sessionMappings) mappings.unshift([from.replace(paths.piAgent, input.piSource), to]);
	rewriteDesktopMetadata(paths.desktop, mappings);
	for (const entry of ["settings.json", "models.json", "trust.json"]) rewriteConfig(join(paths.piAgent, entry), mappings);
	const pending = `${marker}.tmp`;
	writeFileSync(pending, JSON.stringify({ version: 1, root: paths.root, desktopSource, piSource: input.piSource }, null, 2));
	renameSync(pending, marker);
	return { desktopSource, piSource: existsSync(input.piSource) ? input.piSource : undefined, alreadyComplete: false };
}
