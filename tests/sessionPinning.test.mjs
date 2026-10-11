import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function transpile(filePath) {
	return ts.transpileModule(readFileSync(filePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
}

function loadPinnedSettingsPolicy() {
	const sandbox = { exports: {} };
	vm.runInNewContext(transpile("src/shared/pinnedSessions.ts"), sandbox);
	return sandbox.exports;
}

test("persisted pin ids drop invalid values and duplicates", () => {
	const { normalizePinnedSessionIds } = loadPinnedSettingsPolicy();
	assert.deepEqual(Array.from(normalizePinnedSessionIds([" session-a ", "", null, "session-a", "session-b", 7])), ["session-a", "session-b"]);
	assert.deepEqual(Array.from(normalizePinnedSessionIds("session-a")), []);
});
