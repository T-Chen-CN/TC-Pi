import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256OfFile, type RuntimeDownloader } from "../utils/runtimeArchive";

const HASHES: Record<string, string> = {
	x64: "075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b",
	arm64: "0f21e681bd33e006e0348dfa1a2be6769efd77e3bfdb247320314facde23a46c",
};
const run = promisify(execFile);
const installations = new Map<string, Promise<void>>();
type ManagedGitInstallInput = { runtimeRoot: string; tempRoot: string; download: RuntimeDownloader; arch?: string; platform?: NodeJS.Platform; expectedHash?: string; execute?: (file: string, args: string[]) => Promise<void> };

/** Prepare Git independently of Pi detection: migrated Pi installations may already be present. */
export async function prepareInstallationGit(input: { runtimeRoot: string; tempRoot: string; download: RuntimeDownloader; enabled: boolean; onError: (message: string) => void }): Promise<void> {
	if (!input.enabled || process.platform !== "win32") return;
	try {
		await ensureManagedGit(input);
	} catch (error) {
		input.onError(error instanceof Error ? error.message : String(error));
	}
}

/** Install official PortableGit only after digest validation, publishing a verified staged tree. */
export function ensureManagedGit(input: ManagedGitInstallInput): Promise<void> {
	const key = resolve(input.runtimeRoot);
	const pending = installations.get(key);
	if (pending) return pending;
	const operation = installManagedGit(input).finally(() => installations.delete(key));
	installations.set(key, operation);
	return operation;
}

/** One staged publication per installation; concurrent setup requests share the same operation. */
async function installManagedGit(input: ManagedGitInstallInput): Promise<void> {
	if ((input.platform ?? process.platform) !== "win32") return;
	const target = join(input.runtimeRoot, "git");
	if (existsSync(join(target, "cmd", "git.exe")) && existsSync(join(target, "bin", "bash.exe"))) return;
	const arch = input.arch ?? process.arch;
	const digest = input.expectedHash ?? HASHES[arch];
	if (!digest) throw new Error(`Unsupported PortableGit architecture: ${arch}`);
	await mkdir(input.tempRoot, { recursive: true });
	await mkdir(input.runtimeRoot, { recursive: true });
	const stage = await mkdtemp(join(input.tempRoot, "git-install-"));
	const execute =
		input.execute ??
		(async (file, args) => {
			await run(file, args, { timeout: 120_000, windowsHide: true });
		});
	try {
		const name = `PortableGit-2.56.0.2-${arch === "x64" ? "64-bit" : "arm64"}.7z.exe`;
		const archive = join(stage, name);
		await input.download(`https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/${name}`, archive);
		if ((await sha256OfFile(archive)) !== digest) throw new Error("PortableGit digest mismatch; archive was not executed");
		const extracted = join(stage, "git");
		await execute(archive, ["-y", `-o${extracted}`]);
		await execute(join(extracted, "cmd", "git.exe"), ["--version"]);
		await execute(join(extracted, "bin", "bash.exe"), ["--version"]);
		// Never erase an existing runtime on a failed repair; preserve it for diagnosis.
		if (existsSync(target)) await rename(target, join(input.runtimeRoot, `git-incomplete-${Date.now()}`));
		await rename(extracted, target);
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
