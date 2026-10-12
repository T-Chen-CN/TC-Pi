import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { ensureManagedGit, prepareInstallationGit } = loadTsCommonJs("src/main/pi/managedGitInstall.ts");
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-git-test-"));
	return { runtimeRoot: join(root, "runtimes"), tempRoot: join(root, "temp"), platform: "win32", arch: "x64" };
}
test("untrusted PortableGit archive never executes or publishes a runtime", async () => {
	const f = fixture();
	let executed = false;
	await assert.rejects(
		ensureManagedGit({
			...f,
			download: async (_url, path) => writeFileSync(path, "bad"),
			execute: async () => {
				executed = true;
			},
		}),
		/digest mismatch/,
	);
	assert.equal(executed, false);
	assert.equal(existsSync(join(f.runtimeRoot, "git")), false);
});
test("verified PortableGit extraction is probed and published inside the runtime root", async () => {
	const f = fixture();
	const commands = [];
	await ensureManagedGit({
		...f,
		expectedHash: createHash("sha256").update("good").digest("hex"),
		download: async (_url, path) => writeFileSync(path, "good"),
		execute: async (file, args) => {
			commands.push([file, args]);
			if (args[0] === "-y") {
				const root = args[1].slice(2);
				for (const name of ["cmd/git.exe", "bin/bash.exe"]) {
					const path = join(root, name);
					mkdirSync(join(path, ".."), { recursive: true });
					writeFileSync(path, "executable");
				}
			}
		},
	});
	assert.equal(commands.length, 3);
	assert.equal(existsSync(join(f.runtimeRoot, "git", "cmd", "git.exe")), true);
	await ensureManagedGit({
		...f,
		download: async () => {
			throw new Error("unexpected network");
		},
	});
});

test("concurrent setup requests share one staged Git download and publication", async () => {
	const f = fixture();
	let downloads = 0;
	const input = {
		...f,
		expectedHash: createHash("sha256").update("good").digest("hex"),
		download: async (_url, path) => {
			downloads++;
			writeFileSync(path, "good");
		},
		execute: async (_file, args) => {
			if (args[0] === "-y")
				for (const name of ["cmd/git.exe", "bin/bash.exe"]) {
					const path = join(args[1].slice(2), name);
					mkdirSync(join(path, ".."), { recursive: true });
					writeFileSync(path, "executable");
				}
		},
	};
	await Promise.all([ensureManagedGit(input), ensureManagedGit(input)]);
	assert.equal(downloads, 1);
});

test("disabled startup preparation performs no download", async () => {
	const f = fixture();
	await prepareInstallationGit({
		...f,
		enabled: false,
		download: async () => {
			throw new Error("unexpected network");
		},
		onError: () => {
			throw new Error("unexpected failure");
		},
	});
});
