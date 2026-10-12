import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
import { promisify } from "node:util";
const { resolveInstallPaths } = loadTsCommonJs("src/main/storage/installPaths.ts");
function fixture(mode = "success") {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-runtime-proof-"));
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "app.exe"), appPath: "unused" });
	for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
	const node = join(paths.runtimes, "node", "node.exe"),
		sdkEntry = join(paths.runtimes, "pi", "dist", "index.js");
	for (const file of [node, sdkEntry, join(paths.runtimes, "pi", "dist", "cli.js"), join(paths.runtimes, "git", "cmd", "git.exe"), join(paths.runtimes, "git", "bin", "bash.exe")]) {
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, "test executable");
	}
	const calls = [],
		commands = [],
		children = [];
	const execFile = (file, args, options, callback) => {
		calls.push({ file, args, options });
		callback(null, "v24.0.0", "");
	};
	execFile[promisify.custom] = async (file, args, options) => {
		calls.push({ file, args, options });
		return { stdout: "v24.0.0", stderr: "" };
	};
	const { probeMigrationRuntime } = loadTsCommonJs("src/main/storage/migrationRuntimeProbe.ts", {
		stubs: {
			"node:child_process": {
				execFile,
				spawn: (file, args, options) => {
					calls.push({ file, args, options });
					const child = new EventEmitter();
					children.push(child);
					child.stdin = new EventEmitter();
					child.stdout = new EventEmitter();
					child.stderr = new EventEmitter();
					child.kill = () => {
						child.killed = true;
						return true;
					};
					child.stdin.write = (line) => {
						const request = JSON.parse(line);
						commands.push(request);
						if (mode === "pending") return;
						queueMicrotask(() => {
							if (mode === "error") {
								child.emit("error", new Error("spawn failed"));
								return;
							}
							if (mode === "progress") child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "bash_execution_update", id: request.id }) + "\n"));
							const value = { type: "response", id: request.id, success: mode !== "failed", data: { output: "git version 2.56.0", exitCode: mode === "nonzero" ? 1 : 0 } };
							child.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
						});
					};
					return child;
				},
			},
		},
	});
	const launch = { ok: true, nodeExe: node, sdkEntry, helperPath: "unused", env: { PI_CODING_AGENT_DIR: paths.piAgent, TC_PI_RUNTIME_ROOT: paths.runtimes } };
	return { paths, launch, probeMigrationRuntime, calls, commands, children };
}
test("private runtime verification uses only offline RPC and version probes, never a model prompt", async () => {
	const f = fixture();
	const result = await f.probeMigrationRuntime(f.paths, f.launch, new AbortController().signal);
	assert.equal(result.ok, true);
	assert.ok(f.calls.every((call) => call.file.startsWith(f.paths.runtimes)));
	assert.ok(f.calls.some((call) => call.args.includes("--offline") && call.args.includes("--no-session") && call.args.includes("--no-extensions")));
	assert.deepEqual(
		f.commands.map((command) => command.type),
		process.platform === "win32" ? ["get_state", "get_commands", "bash"] : ["get_state", "get_commands"],
	);
	assert.ok(f.children.every((child) => child.killed));
});
test("RPC errors and spawn failures settle the probe and release its process", async () => {
	for (const mode of ["error", "failed"]) {
		const f = fixture(mode);
		assert.equal((await f.probeMigrationRuntime(f.paths, f.launch, new AbortController().signal)).ok, false);
		assert.ok(f.children.every((child) => child.killed));
	}
});
test("aborting verification kills only its own probe process", async () => {
	const f = fixture("pending"),
		abort = new AbortController();
	const result = f.probeMigrationRuntime(f.paths, f.launch, abort.signal);
	await new Promise((resolve) => setImmediate(resolve));
	abort.abort();
	assert.equal((await result).ok, false);
	assert.equal(f.children[0].killed, true);
});
test("external runtimes and WSL cannot authorize private installation cleanup", async () => {
	const f = fixture();
	assert.equal((await f.probeMigrationRuntime(f.paths, { ...f.launch, nodeExe: process.execPath }, new AbortController().signal)).ok, false);
	assert.equal((await f.probeMigrationRuntime(f.paths, { ok: false, reason: "wsl" }, new AbortController().signal)).ok, false);
	assert.equal(f.calls.length, 0);
});
test("progress events carrying the command id are ignored until the RPC response arrives", async () => {
	const f = fixture("progress");
	assert.equal((await f.probeMigrationRuntime(f.paths, f.launch, new AbortController().signal)).ok, true);
	assert.ok(f.children.every((child) => child.killed));
});
test("a nonzero Git tool exit cannot authorize cleanup even if output contains a version", async () => {
	if (process.platform !== "win32") return;
	const f = fixture("nonzero");
	assert.equal((await f.probeMigrationRuntime(f.paths, f.launch, new AbortController().signal)).ok, false);
});
