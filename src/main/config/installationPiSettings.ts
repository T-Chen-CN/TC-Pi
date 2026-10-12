import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";
import type { InstallPaths } from "../storage/installPaths";

/** Pin Pi's native Windows shell to its private runtime; configuring Pi avoids implementing its tools. */
export function configureInstallationPiSettings(paths: InstallPaths, platform: NodeJS.Platform = process.platform): void {
	const file = join(paths.piAgent, "settings.json");
	if (!existsSync(file)) {
		try {
			writeFileSync(file, "{}", { flag: "wx" });
		} catch (error) {
			if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
		}
	}
	if (lstatSync(file).isSymbolicLink()) throw new Error("Pi settings must belong to the installation");
	const unlock = lockfile.lockSync(file, { realpath: false });
	try {
		writeOwnedSettings(file, paths, platform);
	} finally {
		unlock();
	}
}

/** Update generated runtime keys under Pi's lock, preserving other fields and publishing atomically. */
function writeOwnedSettings(file: string, paths: InstallPaths, platform: NodeJS.Platform): void {
	const raw = readFileSync(file, "utf8");
	const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Pi settings");
	const next = createInstallationPiSettings(value, paths, platform);
	const encoded = JSON.stringify(next, null, 2) + "\n";
	if (encoded === raw) return;
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, encoded, { flag: "wx" });
		renameSync(temporary, file);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/** Share the generated-key policy with migration verification; other settings retain their values. */
export function createInstallationPiSettings(value: object, paths: InstallPaths, platform: NodeJS.Platform = process.platform): object {
	const node = join(paths.runtimes, "node", platform === "win32" ? "node.exe" : "bin/node");
	const npm = join(paths.runtimes, "node", platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "lib/node_modules/npm/bin/npm-cli.js");
	const skills = "skills" in value && Array.isArray(value.skills) ? value.skills : [];
	// Pi still discovers ~/.agents independently of agentDir. Its native rules prevent loading
	// the shared copy and include the installation's copy without replacing Pi's resource loader.
	const sharedSkills = join(process.env.HOME || homedir(), ".agents", "skills")
		.split("\\")
		.join("/");
	const ownedSkills = paths.agentsSkills.split("\\").join("/");
	return { ...value, npmCommand: [node, npm], skills: [...new Set([...skills, ownedSkills, `-${sharedSkills}/**`])], ...(platform === "win32" ? { shellPath: join(paths.runtimes, "git", "bin", "bash.exe") } : {}) };
}
