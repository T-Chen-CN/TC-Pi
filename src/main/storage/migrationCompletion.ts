import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InstallPaths } from "./installPaths";
import { readMigrationAudit, writeMigrationAudit } from "./migrationAudit";
import { assertMigrationPath, digestFile, inside, verifyMigrationGroup, type MigrationCategory, type MigrationGroup } from "./migrationEvidence";
import { relocateStorageValue } from "./storageRelocation";

export type MigrationReason = "shared" | "verification" | "runtime" | "credentials" | "in-use" | "cleanup";
export type MigrationReportItem = { source: string; destination: string; category: MigrationCategory; files: number; cleaned: number; retained: number; removed: boolean; verified: boolean; reason?: MigrationReason };
export type MigrationReport = { verified: boolean; items: MigrationReportItem[]; credentials?: "verified" | "pending"; credentialsSkipped?: number; unknown: string[] };
export type MigrationSources = { desktopSources: readonly string[]; piSource: string; skipMigration?: boolean };
export type RuntimeProbeResult = { ok: boolean; reason?: "runtime" };

/** Validate the entire migration before cleanup; shared data is never a deletion candidate. */
export async function finishInstallationMigration(paths: InstallPaths, input: MigrationSources, probeRuntime: () => Promise<RuntimeProbeResult>): Promise<MigrationReport | undefined> {
	if (input.skipMigration) return undefined;
	const audit = readMigrationAudit(paths);
	const hasCredentials = existsSync(join(input.piSource, "auth.json"));
	if (!audit || (audit.groups.length === 0 && !hasCredentials)) return undefined;
	const proof = credentialProof(paths);
	const credentials = !hasCredentials || proof.verified;
	const checked = new Map(audit.groups.map((group) => [group, group.done || audit.completed || verifyMigrationGroup(group, audit, paths, input.desktopSources, input.piSource)]));
	let reason: MigrationReason | undefined;
	if (!audit.completed) {
		const groups = audit.groups.filter((group) => !group.done);
		if (groups.some((group) => !checked.get(group))) reason = "verification";
		else if (!credentials) reason = "credentials";
		else if (input.desktopSources.some(legacyProfileActive)) reason = "in-use";
		else if (!(await probeRuntime()).ok) reason = "runtime";
		if (!reason) {
			// Recheck after an asynchronous runtime probe: no stale proof can authorize removal.
			if (groups.some((group) => !verifyMigrationGroup(group, audit, paths, input.desktopSources, input.piSource))) reason = "verification";
			else if (input.desktopSources.some(legacyProfileActive)) reason = "in-use";
			else {
				for (const group of groups.filter((group) => group.owned)) {
					// Persist verified destination hashes before the first unlink so partial cleanup can resume.
					if (!group.cleanupStarted) {
						for (const file of group.files.filter((file) => file.kind === "file")) {
							const target = relocateStorageValue(join(group.destination, file.relative), audit.mappings);
							if (typeof target !== "string") throw new Error("Invalid migration target");
							file.targetDigest = digestFile(target).digest;
						}
						group.cleanupStarted = true;
						writeMigrationAudit(paths, audit);
					}
					try {
						cleanupVerifiedGroup(group, paths, input.desktopSources);
					} catch {
						reason = "cleanup";
					}
					writeMigrationAudit(paths, audit);
				}
				audit.completed = !reason;
				writeMigrationAudit(paths, audit);
			}
		}
	}
	const items: MigrationReportItem[] = audit.groups.map((group) => {
		const files = group.files.filter((file) => file.kind !== "directory").length;
		const cleaned = group.cleaned ?? 0;
		return { source: group.source, destination: group.destination, category: group.category, files, cleaned, retained: Math.max(0, files - cleaned), removed: group.done === true, verified: checked.get(group) === true, reason: group.done ? undefined : !group.owned && checked.get(group) ? "shared" : reason };
	});
	if (hasCredentials) items.push({ source: join(input.piSource, "auth.json"), destination: join(paths.piAgent, "auth.json"), category: "pi", files: 1, cleaned: 0, retained: 1, removed: false, verified: credentials, reason: credentials ? "shared" : "credentials" });
	return { verified: (!reason || reason === "cleanup") && credentials, items, credentials: hasCredentials ? (credentials ? "verified" : "pending") : undefined, credentialsSkipped: hasCredentials ? proof.skipped : undefined, unknown: unknownDesktopEntries(input.desktopSources, audit.groups) };
}

/** A v1 credential marker is insufficient proof: the Pi host upgrades it without resurrecting logged-out accounts. */
function credentialProof(paths: InstallPaths): { verified: boolean; skipped: number } {
	try {
		const file = join(paths.piAgent, "credentials-migrated.json");
		assertMigrationPath(paths.root, file);
		if (lstatSync(file).size > 4096) return { verified: false, skipped: 0 };
		const value: unknown = JSON.parse(readFileSync(file, "utf8"));
		return {
			verified: Boolean(value && typeof value === "object" && "version" in value && value.version === 2 && "verified" in value && value.verified === true),
			skipped: value && typeof value === "object" && "skipped" in value && typeof value.skipped === "number" && Number.isSafeInteger(value.skipped) && value.skipped > 0 ? value.skipped : 0,
		};
	} catch {
		return { verified: false, skipped: 0 };
	}
}

/** Remove exact verified files, then empty directories only; never recursively delete a legacy root. */
function cleanupVerifiedGroup(group: MigrationGroup, paths: InstallPaths, trustedRoots: readonly string[]): void {
	const root = trustedRoots.find((root) => inside(root, group.source));
	if (!root || inside(paths.root, group.source) || inside(group.source, paths.root)) throw new Error("Untrusted cleanup root");
	group.cleaned = 0;
	for (const file of group.files.filter((file) => file.kind !== "directory")) {
		const path = join(group.source, file.relative);
		if (entryExists(path)) {
			assertMigrationPath(root, path, file.kind === "link");
			if (file.kind === "file" && digestFile(path).digest !== file.digest) throw new Error("Source changed");
			unlinkSync(path);
		}
		group.cleaned++;
	}
	for (const file of group.files.filter((file) => file.kind === "directory").sort((a, b) => b.relative.length - a.relative.length)) {
		const path = join(group.source, file.relative);
		if (entryExists(path)) {
			assertMigrationPath(root, path);
			rmdirSync(path);
		}
	}
	group.done = true;
	// node/pi-global share an otherwise unselected parent; only remove it when it is empty.
	const parent = dirname(group.source);
	if (inside(root, parent) && parent !== root && existsSync(parent) && readdirSync(parent).length === 0) {
		assertMigrationPath(root, parent);
		rmdirSync(parent);
	}
}

/** A dangling link still exists as a directory entry and must not be reported as removed without unlinking it. */
function entryExists(file: string): boolean {
	try {
		lstatSync(file);
		return true;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

/** Detect a live old desktop before touching its settings, drafts or browser stores. */
function legacyProfileActive(root: string): boolean {
	const locks = join(root, "instance-locks");
	if (!existsSync(locks)) return false;
	try {
		assertMigrationPath(root, locks);
		for (const name of readdirSync(locks).filter((name) => name.endsWith(".lock"))) {
			const file = join(locks, name);
			if (lstatSync(file).size > 4096) return true;
			const value: unknown = JSON.parse(readFileSync(file, "utf8"));
			if (!value || typeof value !== "object" || !("pid" in value) || typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return true;
			try {
				process.kill(value.pid, 0);
				return true;
			} catch (error) {
				if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") return true;
			}
		}
		return false;
	} catch {
		return true;
	}
}

/** Unselected files are not claimed as migrated; they appear separately in the completion notice. */
function unknownDesktopEntries(roots: readonly string[], groups: readonly MigrationGroup[]): string[] {
	const result: string[] = [];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		try {
			assertMigrationPath(root, root);
			for (const name of readdirSync(root)) {
				const file = join(root, name);
				if (!groups.some((group) => group.owned && (inside(file, group.source) || inside(group.source, file)))) result.push(file);
			}
		} catch {
			result.push(root);
		}
	}
	return result;
}
