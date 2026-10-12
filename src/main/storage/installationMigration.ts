import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { relocateInstallationSessions } from "./sessionRelocation";
import type { InstallPaths } from "./installPaths";
import { relocateStorageMetadata } from "./storageRelocation";
import { collectMigrationCopies, migrationRootMappings } from "./migrationPlan";
import { createMigrationAudit, migrationAuditPath, relocateMigrationAudit, writeMigrationAudit } from "./migrationAudit";
export { relocateStorageValue } from "./storageRelocation";

const MAX_CONFIG_BYTES = 16 * 1024 * 1024;

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
	const value = relocateStorageMetadata(JSON.parse(before), basename(path), mappings);
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
			relocateMigrationAudit(paths, metadata.root, mappings);
			writeFileSync(marker, JSON.stringify({ ...metadata, root: paths.root }, null, 2));
		}
		// v0.9.2 copied without evidence; reconstruct conservatively, never overwrite current data.
		if (!existsSync(migrationAuditPath(paths))) {
			const desktopSource = metadata && typeof metadata === "object" && "desktopSource" in metadata && typeof metadata.desktopSource === "string" && input.desktopSources.includes(metadata.desktopSource) ? metadata.desktopSource : undefined;
			const mappings = migrationRootMappings(paths, desktopSource, input.piSource);
			const sessionMappings = relocateInstallationSessions(paths.piSessions, mappings);
			for (const [from, to] of sessionMappings) mappings.unshift([from.replace(paths.piAgent, input.piSource), to]);
			const audit = createMigrationAudit(paths, collectMigrationCopies(paths, desktopSource, input.piSource), [...sessionMappings, ...mappings]);
			writeMigrationAudit(paths, audit);
		}
		return { alreadyComplete: true };
	}
	const desktopSource = input.desktopSources.find((source) => existsSync(join(source, "settings.json")) || existsSync(join(source, "session-catalog.json")));
	const mappings = migrationRootMappings(paths, desktopSource, input.piSource);
	const copies = collectMigrationCopies(paths, desktopSource, input.piSource);
	const audit = createMigrationAudit(paths, copies, mappings);
	for (const copy of copies) {
		if (copy.runtime) copyRuntime(copy.source, copy.destination);
		else copyMissing(copy.source, copy.destination);
	}
	const sessionMappings = relocateInstallationSessions(paths.piSessions, mappings);
	for (const [from, to] of sessionMappings) mappings.unshift([from.replace(paths.piAgent, input.piSource), to]);
	audit.mappings.unshift(...sessionMappings);
	writeMigrationAudit(paths, audit);
	rewriteDesktopMetadata(paths.desktop, mappings);
	for (const entry of ["settings.json", "models.json", "trust.json"]) rewriteConfig(join(paths.piAgent, entry), mappings);
	const pending = `${marker}.tmp`;
	writeFileSync(pending, JSON.stringify({ version: 1, root: paths.root, desktopSource, piSource: input.piSource }, null, 2));
	renameSync(pending, marker);
	return { desktopSource, piSource: existsSync(input.piSource) ? input.piSource : undefined, alreadyComplete: false };
}
