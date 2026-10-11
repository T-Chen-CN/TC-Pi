import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

test("stop during async startup prevents a delayed child process from spawning", async () => {
	let release;
	let spawned = 0;
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = () => true;
	const { PiProcess } = createTsSandbox({
		globals: { process, Buffer, console: { log() {}, warn() {}, error() {} } },
		stubs: {
			"node:child_process": {
				spawn: () => {
					spawned++;
					return child;
				},
				execFile: (_cmd, _args, _opts, callback) => callback(null, "0.81.1\n", ""),
			},
			"./PiLocator": { PiLocator: class {} },
			"../logging/sharedLogger": { getAppLogger: () => null },
			"./piExtensionFilter": { parkBlockedExtensionsInDir: () => [], unparkBlockedExtensions: () => undefined },
			"../extensions/builtInExtensions": { appendBuiltInExtensionArgs: (args) => args },
		},
	})("src/main/pi/PiProcess.ts");
	const locator = { resolveCommand: () => "mock-pi", createInvocation: (_command, args) => ({ command: "mock-pi", args, shell: false }), createProcessEnv: () => ({}) };
	const agent = new PiProcess(process.cwd(), undefined, locator, {
		repairSessionFileBeforeStart: () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	});
	const starting = agent.start("session.jsonl");
	agent.stop();
	release(false);
	await assert.rejects(starting, /stopped during startup/);
	assert.equal(spawned, 0);
	assert.equal(agent.isRunning(), false);
});
