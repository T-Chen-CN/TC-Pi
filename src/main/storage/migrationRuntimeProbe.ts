import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { setTimeout, clearTimeout } from "node:timers";
import { StringDecoder } from "node:string_decoder";
import type { PiAuthHostLaunch } from "../pi/auth/piAuthHostLaunch";
import type { InstallPaths } from "./installPaths";
import type { RuntimeProbeResult } from "./migrationCompletion";
import { assertMigrationPath } from "./migrationEvidence";

/** Read-only private runtime verification: no model request, session restore or user extension runs. */
export async function probeMigrationRuntime(paths: InstallPaths, launch: PiAuthHostLaunch, signal: AbortSignal): Promise<RuntimeProbeResult> {
	if (!launch.ok || signal.aborted) return { ok: false, reason: "runtime" };
	try {
		const cli = join(dirname(launch.sdkEntry), "cli.js");
		assertMigrationPath(paths.runtimes, launch.nodeExe);
		assertMigrationPath(paths.runtimes, cli);
		// Auth launch resolution already uses PiLocator.createProcessEnv and its child-environment sanitizer.
		const env = launch.env;
		if (env.PI_CODING_AGENT_DIR !== paths.piAgent || env.TC_PI_RUNTIME_ROOT !== paths.runtimes) return { ok: false, reason: "runtime" };
		const { stdout } = await promisify(execFile)(launch.nodeExe, ["--version"], { env, timeout: 10_000, signal, windowsHide: true, maxBuffer: 64 * 1024 });
		if (!/^v\d+\./.test(stdout.trim())) return { ok: false, reason: "runtime" };
		if (process.platform === "win32") {
			for (const file of [join(paths.runtimes, "git", "cmd", "git.exe"), join(paths.runtimes, "git", "bin", "bash.exe")]) {
				assertMigrationPath(paths.runtimes, file);
				if (!existsSync(file)) return { ok: false, reason: "runtime" };
			}
			// Git itself is queried through Pi's bash tool below; TC-Pi never adds a third Git runner.
			await promisify(execFile)(join(paths.runtimes, "git", "bin", "bash.exe"), ["--version"], { env, timeout: 10_000, signal, windowsHide: true, maxBuffer: 64 * 1024 });
		}
		return { ok: await probeRpc(launch.nodeExe, cli, paths, env, signal), reason: "runtime" };
	} catch {
		return { ok: false, reason: "runtime" };
	}
}

/** Own the probe process and its timeout/abort listeners; all terminal paths kill it exactly once. */
function probeRpc(node: string, cli: string, paths: InstallPaths, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(node, [cli, "--mode", "rpc", "--offline", "--no-extensions", "--no-skills", "--no-session"], { cwd: paths.desktop, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		let finished = false,
			buffer = "",
			step = 0;
		const decoder = new StringDecoder("utf8");
		// Quoted environment expansion selects the exact private Git even if the user exports shell functions.
		const commands = [{ type: "get_state" }, { type: "get_commands" }, ...(process.platform === "win32" ? [{ type: "bash", command: 'command "$TC_PI_RUNTIME_ROOT/git/cmd/git.exe" --version', excludeFromContext: true }] : [])];
		const timer = setTimeout(() => finish(false), 30_000);
		function finish(ok: boolean): void {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			child.kill();
			resolve(ok);
		}
		const abort = (): void => finish(false);
		const send = (): void => {
			child.stdin.write(JSON.stringify({ ...commands[step], id: `migration-${step}` }) + "\n");
		};
		child.on("error", () => finish(false));
		child.on("close", () => finish(false));
		child.stdin.on("error", () => finish(false));
		child.stderr.on("data", () => {
			/* Discard diagnostics: credentials and model payloads must not enter a migration report. */
		});
		child.stdout.on("data", (chunk) => {
			buffer += decoder.write(chunk);
			if (buffer.length > 2 * 1024 * 1024) {
				finish(false);
				return;
			}
			let newline: number;
			while (!finished && (newline = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				try {
					const value: unknown = JSON.parse(line);
					// Streaming tool events echo the request id too; only a response settles a command.
					if (!value || typeof value !== "object" || !("type" in value) || value.type !== "response" || !("id" in value) || value.id !== `migration-${step}`) continue;
					if (!("success" in value) || value.success !== true) {
						finish(false);
						return;
					}
					if (commands[step]?.type === "bash" && (!("data" in value) || !value.data || typeof value.data !== "object" || !("exitCode" in value.data) || value.data.exitCode !== 0 || !("output" in value.data) || typeof value.data.output !== "string" || !value.data.output.includes("git version"))) {
						finish(false);
						return;
					}
					step++;
					if (step === commands.length) finish(true);
					else send();
				} catch {
					finish(false);
				}
			}
		});
		if (signal.aborted) finish(false);
		else {
			signal.addEventListener("abort", abort, { once: true });
			send();
		}
	});
}
