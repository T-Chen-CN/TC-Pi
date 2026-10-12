import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PiLocator } from "./PiLocator";
import { piRuntimeNodeBinDir, piRuntimePiPrefixDir } from "./piRuntimePaths";
import { runPiGlobalInstall, type PiGlobalInstallOutcome } from "./piGlobalInstall";
import { ensureManagedGit } from "./managedGitInstall";
import type { RuntimeDownloader } from "../utils/runtimeArchive";
import { getManagedRuntimeRoot } from "../storage/piPaths";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NpmAvailabilityResult } from "../../shared/types";

/** Install Pi using the installation's Node/npm and an explicit local prefix; no global fallback. */
export async function installManagedPi(locator: PiLocator, userData: string, useMirror: boolean, download?: RuntimeDownloader): Promise<PiGlobalInstallOutcome> {
	const npm = join(piRuntimeNodeBinDir(userData), process.platform === "win32" ? "npm.cmd" : "npm");
	if (!existsSync(npm)) return { success: false, exitCode: null, stdout: "", stderr: "npm is not available; complete the node install step first", launchCommand: npm };
	const root = getManagedRuntimeRoot();
	if (root && process.platform === "win32") {
		if (!download) throw new Error("PortableGit installer is unavailable");
		await ensureManagedGit({ runtimeRoot: root, tempRoot: process.env.TEMP ?? join(userData, "temp"), download });
	}
	const args = ["install", "-g", "@earendil-works/pi-coding-agent"];
	if (useMirror) args.push("--registry=https://registry.npmmirror.com");
	return runPiGlobalInstall({
		npmCommand: npm,
		npmArgs: args,
		prefixDir: piRuntimePiPrefixDir(userData),
		launcher: { createInvocation: (command, values) => locator.createInvocation(command, values), createProcessEnv: (prefix) => locator.createProcessEnv(undefined, prefix) },
		cwd: userData,
	});
}

/** Probe only the installation-owned npm; system npm cannot satisfy the managed setup gate. */
export async function probeManagedNpm(locator: PiLocator, userData: string): Promise<NpmAvailabilityResult> {
	const npm = join(piRuntimeNodeBinDir(userData), process.platform === "win32" ? "npm.cmd" : "npm");
	if (!existsSync(npm)) return { available: false };
	try {
		const invocation = locator.createInvocation(npm, ["--version"]);
		const { stdout } = await promisify(execFile)(invocation.command, invocation.args, { env: locator.createProcessEnv(undefined, invocation.pathPrefix), timeout: 10_000, windowsHide: true, encoding: "utf8" });
		return { available: Boolean(stdout.trim()), version: stdout.trim() };
	} catch {
		return { available: false };
	}
}
