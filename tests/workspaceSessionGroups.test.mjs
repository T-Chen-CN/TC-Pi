import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { workspaceSessionGroups } = loadTsCommonJs("src/renderer/src/utils/workspaceSessionGroups.ts");
const session = (id, createdAt = 1, extra = {}) => ({ id, projectId: "p", title: id, source: "pi", environment: "native", preview: "", messageCount: 0, status: "active", createdAt, updatedAt: 100, ...extra });
const ids = (items) => Array.from(items, (item) => item.session.id);
test("pins precede creation order without updates influencing the order", () => {
	assert.deepEqual(ids(workspaceSessionGroups([session("old", 1), session("new", 2), session("pin", 0)], new Set(["pin"]))), ["pin", "new", "old"]);
});
test("pi and codex children nest while forks and orphan sessions stay reachable", () => {
	const rows = workspaceSessionGroups(
		[
			session("parent", 1, { filePath: "C:\\P\\parent.jsonl", codexSessionId: "thread" }),
			session("pi", 2, { parentSessionPath: "c:/p/parent.jsonl" }),
			session("codex", 3, { codexThreadSource: "subagent", codexParentThreadId: "thread" }),
			session("fork", 4, { parentSessionId: "parent", forked: true }),
			session("orphan", 5, { parentSessionId: "missing" }),
		],
		new Set(),
	);
	assert.deepEqual(ids(rows), ["orphan", "fork", "parent"]);
	assert.deepEqual(ids(rows[2].children), ["codex", "pi"]);
});
test("cycles and cross-project parents never hide sessions", () => {
	const rows = workspaceSessionGroups([session("a", 1, { parentSessionId: "b" }), session("b", 2, { parentSessionId: "a" }), session("other", 3, { projectId: "other", parentSessionId: "a" })], new Set());
	const walk = (items) => items.flatMap((item) => [item.session.id, ...walk(item.children)]);
	assert.deepEqual(Array.from(walk(rows)).sort(), ["a", "b", "other"]);
});
