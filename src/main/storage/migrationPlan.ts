import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InstallPaths } from "./installPaths";
import type { MigrationCopy } from "./migrationAudit";
const DESKTOP_DIRECTORIES = new Set(["chat-workspace", "external-sessions", "drafts", "custom-themes", "sounds", "backgrounds", "host-plugins", "builtin-extensions", "skills-overlay", "prompts-overlay"]);
const BROWSER_NAMES = new Set(["Network", "Partitions", "Local Storage", "Session Storage", "IndexedDB", "Preferences", "Local State", "SharedStorage", "Shared Dictionary", "blob_storage"]);
const PI_DIRECTORIES = new Set(["sessions", "prompts", "skills", "extensions", "themes", "agents", "npm", "pi-subagents", "backups", "missions", "analytics", "agents-skills"]);

/** Only application-owned legacy files are cleanup candidates; shared Pi and home files are copy-only. */
export function collectMigrationCopies(paths: InstallPaths, desktopSource: string | undefined, piSource: string): MigrationCopy[] {
	const copies: MigrationCopy[] = [];
	if (desktopSource && existsSync(desktopSource)) {
		for (const entry of readdirSync(desktopSource)) {
			if (DESKTOP_DIRECTORIES.has(entry) || /\.json(?:\.bak)?$/.test(entry)) {
				if (/^(?:announcements-cache|usage-stats-cache|tokendance-models)\./.test(entry)) continue;
				copies.push({ source: join(desktopSource, entry), destination: join(paths.desktop, entry), category: "desktop", owned: true });
			} else if (BROWSER_NAMES.has(entry)) copies.push({ source: join(desktopSource, entry), destination: join(paths.browser, entry), category: "browser", owned: true });
		}
		copies.push(
			{ source: join(desktopSource, "voice-runtime"), destination: paths.voice, category: "runtime", owned: true, runtime: true },
			{ source: join(desktopSource, "logs"), destination: paths.logs, category: "desktop", owned: true },
			{ source: join(desktopSource, "config-backups"), destination: paths.backups, category: "desktop", owned: true },
			{ source: join(desktopSource, "pi-runtime", "node"), destination: join(paths.runtimes, "node"), category: "runtime", owned: true, runtime: true },
			{ source: join(desktopSource, "pi-runtime", "pi-global"), destination: join(paths.runtimes, "pi-global"), category: "runtime", owned: true, runtime: true },
		);
	}
	if (existsSync(piSource)) {
		for (const entry of readdirSync(piSource)) {
			if (/^auth(?:\.|$)/i.test(entry)) continue;
			if (PI_DIRECTORIES.has(entry) || /\.(?:json|md)$/.test(entry)) copies.push({ source: join(piSource, entry), destination: join(paths.piAgent, entry), category: "pi", owned: false });
		}
		copies.push(
			{ source: join(piSource, "install"), destination: join(paths.runtimes, "pi", "install"), category: "runtime", owned: false, runtime: true },
			{ source: join(piSource, "bin"), destination: join(paths.runtimes, "pi", "bin"), category: "runtime", owned: false, runtime: true },
			{ source: join(piSource, "win-git-bash"), destination: join(paths.runtimes, "git"), category: "runtime", owned: false, runtime: true },
			{ source: join(dirname(dirname(piSource)), ".agents", "skills"), destination: paths.agentsSkills, category: "shared", owned: false },
			{ source: join(dirname(dirname(piSource)), ".gitconfig"), destination: join(paths.data, "gitconfig"), category: "shared", owned: false },
			{ source: join(dirname(dirname(piSource)), ".npmrc"), destination: join(paths.data, "npmrc"), category: "shared", owned: false },
		);
	}
	return copies.filter((copy) => existsSync(copy.source));
}

/** Reference mappings are the same for a first copy and a v0.9.2 audit retrofit. */
export function migrationRootMappings(paths: InstallPaths, desktopSource: string | undefined, piSource: string): Array<readonly [string, string]> {
	return [
		[join(dirname(dirname(piSource)), ".agents", "skills"), paths.agentsSkills],
		[join(piSource, "install"), join(paths.runtimes, "pi", "install")],
		[join(piSource, "bin"), join(paths.runtimes, "pi", "bin")],
		[join(piSource, "win-git-bash"), join(paths.runtimes, "git")],
		[piSource, paths.piAgent],
		...(desktopSource ? [[desktopSource, paths.desktop] as const] : []),
	];
}
