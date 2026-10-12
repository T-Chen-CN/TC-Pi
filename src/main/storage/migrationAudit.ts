import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import type { InstallPaths } from "./installPaths";
import { assertMigrationPath, captureMigrationGroup, type MigrationAudit, type MigrationCategory, type MigrationFile, type MigrationGroup } from "./migrationEvidence";
import { relocateStorageValue } from "./storageRelocation";
import { encodeSessionDirName } from "../projects/userDataNameMigration";

/** The same source descriptors drive copy and verification, avoiding an unverified second file list. */
export type MigrationCopy = { source: string; destination: string; category: MigrationCategory; runtime?: boolean; owned: boolean };
export const migrationAuditPath = (paths: InstallPaths): string => join(paths.data, "migration-audit.json");

/** Persist only bounded, non-secret evidence; completed layout v1 installations can receive a new audit. */
export function createMigrationAudit(paths: InstallPaths, copies: readonly MigrationCopy[], mappings: Array<readonly [string, string]>): MigrationAudit {
	const audit: MigrationAudit = { version: 2, root: paths.root, groups: copies.filter((copy) => existsSync(copy.source)).map((copy) => captureMigrationGroup(copy.source, copy.destination, copy.category, copy.owned)), mappings };
	// v0.9.2 already renamed target directories. Infer their locations from source headers, not current target contents.
	for (const group of audit.groups.filter((group) => group.category === "pi" && basename(group.source) === "sessions")) {
		const seen = new Set<string>();
		for (const file of group.files.filter((file) => file.kind === "file" && file.relative.endsWith(".jsonl"))) {
			const directory = file.relative.split(/[\\/]/)[0];
			if (!directory?.startsWith("--") || !directory.endsWith("--") || seen.has(directory)) continue;
			const cwd = sourceSessionCwd(join(group.source, file.relative));
			const moved = typeof cwd === "string" ? relocateStorageValue(cwd, mappings) : undefined;
			if (typeof moved !== "string") continue;
			seen.add(directory);
			const target = join(paths.piSessions, encodeSessionDirName(moved));
			audit.mappings.unshift([join(group.source, directory), target], [join(paths.piSessions, directory), target]);
		}
	}
	return audit;
}

/** Read only a native bounded first line; malformed history is retained by subsequent verification. */
function sourceSessionCwd(file: string): string | undefined {
	const fd = openSync(file, "r");
	try {
		const buffer = Buffer.alloc(64 * 1024),
			count = readSync(fd, buffer, 0, buffer.length, 0);
		const newline = buffer.subarray(0, count).indexOf(10);
		if (newline < 0) return undefined;
		const header: unknown = JSON.parse(buffer.toString("utf8", 0, newline));
		return header && typeof header === "object" && "cwd" in header && typeof header.cwd === "string" ? header.cwd : undefined;
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

/** Read journals defensively: tampered shapes cannot authorize filesystem operations. */
export function readMigrationAudit(paths: InstallPaths, expectedRoot = paths.root): MigrationAudit | undefined {
	const file = migrationAuditPath(paths);
	if (!existsSync(file)) return undefined;
	assertMigrationPath(paths.root, file);
	if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 64 * 1024 * 1024) throw new Error("Invalid migration audit");
	const value: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!value || typeof value !== "object" || !("version" in value) || value.version !== 2 || !("root" in value) || value.root !== expectedRoot || !("groups" in value) || !Array.isArray(value.groups) || !("mappings" in value) || !Array.isArray(value.mappings)) throw new Error("Invalid migration audit");
	const groups: MigrationGroup[] = value.groups.map((entry: unknown) => {
		const group = record(entry);
		if (typeof group.source !== "string" || typeof group.destination !== "string" || typeof group.owned !== "boolean" || !isCategory(group.category) || !Array.isArray(group.files) || group.files.length > 100_000) throw new Error("Invalid migration group");
		const files: MigrationFile[] = group.files.map((entry: unknown) => {
			const file = record(entry);
			if (typeof file.relative !== "string" || !(file.kind === "file" || file.kind === "directory" || file.kind === "link") || typeof file.digest !== "string" || typeof file.size !== "number") throw new Error("Invalid migration file");
			return { relative: file.relative, kind: file.kind, digest: file.digest, size: file.size, targetDigest: typeof file.targetDigest === "string" ? file.targetDigest : undefined };
		});
		return {
			source: group.source,
			destination: group.destination,
			owned: group.owned,
			category: group.category,
			files,
			error: typeof group.error === "string" ? group.error : undefined,
			cleaned: typeof group.cleaned === "number" ? group.cleaned : undefined,
			done: group.done === true,
			cleanupStarted: group.cleanupStarted === true,
		};
	});
	const mappings: Array<readonly [string, string]> = value.mappings.map((pair: unknown) => {
		if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") throw new Error("Invalid migration mapping");
		return [pair[0], pair[1]];
	});
	return { version: 2, root: value.root, groups, mappings, completed: "completed" in value && value.completed === true, noticeFingerprint: "noticeFingerprint" in value && typeof value.noticeFingerprint === "string" ? value.noticeFingerprint : undefined };
}

/** Atomic journal publication keeps an interrupted copy/cleanup resumable. */
export function writeMigrationAudit(paths: InstallPaths, audit: MigrationAudit): void {
	assertMigrationPath(paths.root, paths.data);
	const file = migrationAuditPath(paths),
		temporary = `${file}.${randomUUID()}.tmp`;
	if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("Invalid migration audit path");
	try {
		writeFileSync(temporary, JSON.stringify(audit, null, 2), { flag: "wx" });
		renameSync(temporary, file);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/** Repair only journal destinations and installation-internal mapping prefixes after moving the application. */
export function relocateMigrationAudit(paths: InstallPaths, previousRoot: string, mappings: Array<readonly [string, string]>): void {
	const audit = readMigrationAudit(paths, previousRoot);
	if (!audit) return;
	audit.root = paths.root;
	for (const group of audit.groups) {
		const target = relocateStorageValue(group.destination, mappings);
		if (typeof target !== "string") throw new Error("Invalid migration destination");
		group.destination = target;
	}
	audit.mappings = audit.mappings.map(([from, to]) => {
		const source = relocateStorageValue(from, mappings),
			target = relocateStorageValue(to, mappings);
		if (typeof source !== "string" || typeof target !== "string") throw new Error("Invalid migration mapping");
		return [source, target];
	});
	writeMigrationAudit(paths, audit);
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid migration record");
	return Object.fromEntries(Object.entries(value));
}
function isCategory(value: unknown): value is MigrationCategory {
	return value === "desktop" || value === "browser" || value === "runtime" || value === "pi" || value === "shared";
}
