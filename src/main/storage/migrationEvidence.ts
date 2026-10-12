import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { InstallPaths } from "./installPaths";
import { relocateStorageMetadata, relocateStorageValue } from "./storageRelocation";
import { createInstallationPiSettings } from "../config/installationPiSettings";

export type MigrationCategory = "desktop" | "browser" | "runtime" | "pi" | "shared";
export type MigrationFile = { relative: string; kind: "file" | "directory" | "link"; digest: string; size: number; targetDigest?: string };
export type MigrationGroup = { source: string; destination: string; category: MigrationCategory; owned: boolean; files: MigrationFile[]; error?: string; cleaned?: number; done?: boolean; cleanupStarted?: boolean };
export type MigrationAudit = { version: 2; root: string; groups: MigrationGroup[]; mappings: Array<readonly [string, string]>; completed?: boolean; noticeFingerprint?: string };
const CHUNK = 256 * 1024;
const MAX_FILES = 100_000;
const MAX_JSON = 16 * 1024 * 1024;

/** Digest files in bounded chunks; history and binaries never occupy one whole-file buffer. */
export function digestFile(file: string, offset = 0): { digest: string; size: number } {
	const fd = openSync(file, "r"),
		hash = createHash("sha256"),
		buffer = Buffer.alloc(CHUNK);
	let size = 0;
	try {
		let count: number;
		while ((count = readSync(fd, buffer, 0, buffer.length, offset + size)) > 0) {
			hash.update(buffer.subarray(0, count));
			size += count;
		}
		return { digest: hash.digest("hex"), size };
	} finally {
		closeSync(fd);
	}
}

/** Reject redirected ancestors and path escape both when collecting evidence and just before deletion. */
export function assertMigrationPath(root: string, file: string, allowLeafLink = false): void {
	const tail = relative(resolve(root), resolve(file));
	if (isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`)) throw new Error("path");
	let current = resolve(root);
	const parts = tail.split(sep).filter(Boolean);
	for (const [index, part] of ["", ...parts].entries()) {
		current = join(current, part);
		const info = lstatSync(current);
		if (info.isSymbolicLink() && !(allowLeafLink && index === parts.length)) throw new Error("path");
	}
}

/** Record a tree's file set and content before copying; the journal contains hashes, never credential values. */
export function captureMigrationGroup(source: string, destination: string, category: MigrationCategory, owned: boolean): MigrationGroup {
	const group: MigrationGroup = { source, destination, category, owned, files: [] };
	function visit(file: string): void {
		if (group.files.length >= MAX_FILES) throw new Error("budget");
		const info = lstatSync(file),
			key = relative(source, file);
		if (info.isSymbolicLink()) {
			const link = readlinkSync(file);
			if (isAbsolute(link) || !inside(source, resolve(file, "..", link))) throw new Error("path");
			group.files.push({ relative: key, kind: "link", digest: link, size: 0 });
		} else if (info.isDirectory()) {
			group.files.push({ relative: key, kind: "directory", digest: "", size: 0 });
			for (const entry of readdirSync(file)) visit(join(file, entry));
		} else if (info.isFile()) group.files.push({ relative: key, kind: "file", ...digestFile(file) });
		else throw new Error("path");
	}
	try {
		assertMigrationPath(source, source);
		visit(source);
	} catch {
		group.error = "verification";
	}
	return group;
}

/** A trusted root may contain a path, but neither may be nested in the new installation. */
export function inside(root: string, value: string): boolean {
	const tail = relative(resolve(root), resolve(value));
	return !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`);
}

/** Compare JSON values without depending on object-key order or a VM/SDK object's prototype. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
}

/** Check file inventory, source stability, destination bytes and deliberately rewritten metadata independently. */
export function verifyMigrationGroup(group: MigrationGroup, audit: MigrationAudit, paths: InstallPaths, trustedDesktopRoots: readonly string[], piSource: string): boolean {
	try {
		if (group.error || !inside(paths.root, group.destination)) return false;
		const trusted = group.owned ? trustedDesktopRoots.find((root) => inside(root, group.source)) : [piSource, join(resolve(piSource, "../.."), ".agents", "skills"), join(resolve(piSource, "../.."), ".gitconfig"), join(resolve(piSource, "../.."), ".npmrc")].find((root) => inside(root, group.source));
		if (!trusted || inside(paths.root, group.source) || inside(group.source, paths.root)) return false;
		if (existsSync(group.source)) assertMigrationPath(trusted, group.source);
		else if (!group.cleanupStarted) return false;
		if (!group.done) {
			const current = existsSync(group.source) ? captureMigrationGroup(group.source, group.destination, group.category, group.owned) : { files: [], error: undefined };
			if (current.error) return false;
			if (current.files.some((file) => !group.files.some((previous) => previous.relative === file.relative && previous.kind === file.kind && previous.digest === file.digest && previous.size === file.size))) return false;
			if (!group.cleanupStarted && current.files.length !== group.files.length) return false;
		}
		for (const file of group.files) {
			const source = join(group.source, file.relative);
			const originalTarget = join(group.destination, file.relative);
			const moved = relocateStorageValue(originalTarget, audit.mappings);
			if (typeof moved !== "string" || !inside(paths.root, moved)) return false;
			assertMigrationPath(paths.root, moved, file.kind === "link");
			const targetInfo = lstatSync(moved);
			if (file.kind === "directory") {
				if (!targetInfo.isDirectory()) return false;
				continue;
			}
			if (file.kind === "link") {
				if (!targetInfo.isSymbolicLink() || readlinkSync(moved) !== file.digest) return false;
				continue;
			}
			if (!targetInfo.isFile()) return false;
			if (!existsSync(source)) {
				if (!group.cleanupStarted || !file.targetDigest || digestFile(moved).digest !== file.targetDigest) return false;
				continue;
			}
			if (isSession(source, group)) {
				const a = sessionEvidence(source),
					b = sessionEvidence(moved);
				const expected = { ...a.header, cwd: relocateStorageValue(a.header.cwd, audit.mappings), ...(typeof a.header.parentSession === "string" ? { parentSession: relocateStorageValue(a.header.parentSession, audit.mappings) } : {}) };
				if (canonical(expected) !== canonical(b.header) || a.digest !== b.digest || a.size !== b.size) return false;
				if (typeof b.header.parentSession === "string" && inside(paths.piSessions, b.header.parentSession) && !existsSync(b.header.parentSession)) return false;
			} else if (rewrittenJson(source, group)) {
				let expected = relocateStorageMetadata(readJson(source), basename(source), audit.mappings);
				if (resolve(originalTarget) === resolve(paths.piAgent, "settings.json")) {
					if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
					expected = createInstallationPiSettings(expected, paths);
				}
				const actual = readJson(moved);
				if (canonical(expected) !== canonical(actual)) return false;
				if (basename(source) === "session-catalog.json" && Array.isArray(actual))
					for (const entry of actual) {
						if (entry && typeof entry === "object" && "filePath" in entry && typeof entry.filePath === "string" && inside(paths.piSessions, entry.filePath) && !existsSync(entry.filePath)) return false;
					}
			} else if (digestFile(moved).digest !== file.digest) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Metadata transformation is limited to the same small files the migration writer changes. */
function rewrittenJson(file: string, group: MigrationGroup): boolean {
	if (/^auth(?:\.|$)/i.test(basename(file))) return false;
	if (group.category === "desktop") return /\.json(?:\.bak)?$/.test(file) && (group.files[0]?.kind === "file" || basename(group.source) === "drafts");
	return group.category === "pi" && group.files[0]?.kind === "file" && ["settings.json", "models.json", "trust.json"].includes(basename(file));
}
function readJson(file: string): unknown {
	if (lstatSync(file).size > MAX_JSON) throw new Error("budget");
	return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function isSession(file: string, group: MigrationGroup): boolean {
	return file.endsWith(".jsonl") && group.category === "pi" && basename(group.source) === "sessions";
}

/** Validate every JSONL record while retaining CRLF and message bytes in a separate digest. */
function sessionEvidence(file: string): { header: Record<string, unknown>; digest: string; size: number } {
	const fd = openSync(file, "r"),
		buffer = Buffer.alloc(CHUNK);
	let pending = Buffer.alloc(0),
		position = 0,
		header: Record<string, unknown> | undefined,
		bodyOffset = 0;
	try {
		let count: number;
		while ((count = readSync(fd, buffer, 0, buffer.length, position)) > 0) {
			position += count;
			pending = Buffer.concat([pending, buffer.subarray(0, count)]);
			let newline: number;
			while ((newline = pending.indexOf(10)) >= 0) {
				const line = pending.subarray(0, newline),
					text = line.toString("utf8").trim();
				if (text) {
					const entry: unknown = JSON.parse(text);
					if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("session");
					if (!header) {
						if (!("type" in entry) || entry.type !== "session" || !("cwd" in entry) || typeof entry.cwd !== "string") throw new Error("session");
						header = { ...entry };
						bodyOffset = newline - (line.at(-1) === 13 ? 1 : 0);
					}
				}
				pending = pending.subarray(newline + 1);
			}
			if (pending.length > MAX_JSON) throw new Error("budget");
		}
		if (pending.toString("utf8").trim()) {
			const entry: unknown = JSON.parse(pending.toString("utf8"));
			if (!entry || typeof entry !== "object") throw new Error("session");
		}
		if (!header) throw new Error("session");
		return { header, ...digestFile(file, bodyOffset) };
	} finally {
		closeSync(fd);
	}
}
