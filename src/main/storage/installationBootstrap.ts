import { app, dialog } from "electron";
import { existsSync, mkdirSync, lstatSync, writeFileSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { mainProcessT } from "../../shared/i18n/mainProcessCopy";
import { installRuntimeEnvironment, type InstallPaths } from "./installPaths";
import { migrateInstallationStorage } from "./installationMigration";
import { configureInstallationPiSettings } from "../config/installationPiSettings";

/** Configure storage before settings, sessions, logs, caches or child processes are created. */
export function initializeInstallationStorage(paths: InstallPaths, input: { desktopSources: readonly string[]; piSource: string; skipMigration?: boolean }): void {
	try {
		for (const directory of Object.values(paths)) {
			assertOwnedDirectory(paths.root, directory);
			mkdirSync(directory, { recursive: true });
			if (lstatSync(directory).isSymbolicLink()) throw new Error("Managed storage directory must not be a link");
		}
		// A protected install directory must fail visibly instead of silently changing storage policy.
		const probe = join(paths.data, `.write-probe-${process.pid}`);
		writeFileSync(probe, "", { flag: "wx" });
		unlinkSync(probe);
		const migration = migrateInstallationStorage(paths, { ...input, skip: input.skipMigration });
		configureInstallationPiSettings(paths);
		for (const [key, value] of Object.entries(installRuntimeEnvironment(paths, process.env))) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (!input.skipMigration) process.env.TC_PI_LEGACY_AGENT_DIR = migration.piSource ?? input.piSource;
		else delete process.env.TC_PI_LEGACY_AGENT_DIR;
		app.setPath("userData", paths.desktop);
		app.setPath("sessionData", paths.browser);
		app.setPath("temp", paths.temp);
		mkdirSync(join(paths.logs, "crashes"), { recursive: true });
		app.setPath("crashDumps", join(paths.logs, "crashes"));
		app.setAppLogsPath(paths.logs);
	} catch {
		dialog.showErrorBox(mainProcessT("en-US", "mainStorage.startupTitle"), mainProcessT("en-US", "mainStorage.startupFailed", { path: paths.root }));
		app.exit(1);
	}
}

/** Check every owned ancestor before mkdir can traverse it; no redirected data/cache/runtime roots. */
function assertOwnedDirectory(root: string, directory: string): void {
	const tail = relative(root, directory);
	if (isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`)) throw new Error("Managed storage escapes installation");
	let current = root;
	for (const segment of ["", ...tail.split(sep).filter(Boolean)]) {
		current = join(current, segment);
		if (existsSync(current)) {
			const info = lstatSync(current);
			if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Managed storage is redirected or unavailable");
		}
	}
}
