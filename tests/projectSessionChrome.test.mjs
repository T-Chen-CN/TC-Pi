import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { projectSessionTabs, mergeProjectSessionTabs, projectSplitLayout } = loadTsCommonJs("src/renderer/src/utils/projectSessionChrome.ts");

/** 完整稳定会话记录；不同工作区的记录一直保留在共享 catalog。 */
function record(id, projectId) {
	return { id, projectId, title: id, preview: "", messageCount: 0, status: "active", source: "pi", environment: "native", createdAt: 1, updatedAt: 1 };
}
const records = { a: record("a", "alpha"), a2: record("a2", "alpha"), b: record("b", "beta"), chat: record("chat", "chat") };
test("opening a resident tab again does not invalidate the global tab snapshot", () => {
	const all = ["a", "b", "chat"];
	assert.equal(mergeProjectSessionTabs(all, ["a"], records, "alpha"), all);
});
test("only the selected workspace's tabs are visible including independent chat", () => {
	const tabs = ["a", "b", "a2", "chat"];
	assert.deepEqual(Array.from(projectSessionTabs(tabs, records, "alpha")), ["a", "a2"]);
	assert.deepEqual(Array.from(projectSessionTabs(tabs, records, "beta")), ["b"]);
	assert.deepEqual(Array.from(projectSessionTabs(tabs, records, "chat")), ["chat"]);
	assert.deepEqual(Array.from(projectSessionTabs(tabs, records, undefined)), []);
});
test("closing all visible tabs preserves other workspaces' saved tabs", () => {
	const all = mergeProjectSessionTabs(["a", "b", "chat"], [], records, "alpha");
	assert.deepEqual(Array.from(all), ["b", "chat"]);
	assert.deepEqual(Array.from(projectSessionTabs(all, records, "beta")), ["b"]);
});
test("changing preview in one workspace preserves another workspace's order", () => {
	const all = mergeProjectSessionTabs(["b", "a", "chat"], ["a2", "a"], records, "alpha");
	assert.deepEqual(Array.from(projectSessionTabs(all, records, "alpha")), ["a2", "a"]);
	assert.deepEqual(Array.from(projectSessionTabs(all, records, "beta")), ["b"]);
});
test("cross-workspace split layouts cannot enter the current conversation area", () => {
	const layout = {
		orientation: "horizontal",
		panels: [
			{ kind: "session", sessionId: "a" },
			{ kind: "session", sessionId: "b" },
		],
	};
	assert.equal(projectSplitLayout(layout, records, "alpha"), null);
});
test("returning to a workspace restores its saved split layout", () => {
	const layout = {
		orientation: "horizontal",
		panels: [
			{ kind: "session", sessionId: "a" },
			{ kind: "session", sessionId: "a2" },
		],
	};
	assert.equal(projectSplitLayout(layout, records, "beta"), null);
	assert.equal(projectSplitLayout(layout, records, "alpha"), layout);
});
