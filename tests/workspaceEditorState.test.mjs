import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 只调度公开 hook 入口，验证工作区切换与异步关闭的身份隔离。 */
function harness() {
	const slots = [];
	let cursor = 0;
	const react = {
		useRef(initial) {
			const index = cursor++;
			return (slots[index] ??= { current: initial });
		},
		useState(initial) {
			const index = cursor++;
			slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
			return [
				slots[index].value,
				(value) => {
					slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
				},
			];
		},
		useCallback(callback) {
			return callback;
		},
		useMemo(callback) {
			return callback();
		},
	};
	const { useWorkspaceEditorState } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceEditorState.ts", { stubs: { react } });
	return (projectId) => {
		cursor = 0;
		return useWorkspaceEditorState(projectId);
	};
}

test("workspaces restore their own file selection and preview while editors remain mounted", () => {
	const render = harness();
	let state = render("alpha");
	state.setTabs([{ id: "a" }]);
	state.setActiveTabId("a");
	state.setPreviewTabId("a");
	state = render("beta");
	assert.equal(state.tabs.length, 0);
	state.setTabs([{ id: "b" }]);
	state.setActiveTabId("b");
	state = render("alpha");
	assert.equal(state.activeTabId, "a");
	assert.equal(state.previewTabId, "a");
	assert.deepEqual(
		Array.from(state.allTabs, (tab) => tab.id),
		["a", "b"],
	);
});

test("opening a document into an explicit owner does not overwrite the visible config workspace", () => {
	const render = harness();
	let state = render("pi-agent-config");
	state.setTabs([{ id: "config", dirty: true }]);
	state.setActiveTabId("config");
	state.setTabs([{ id: "project" }], "alpha");
	state.setActiveTabId("project", "alpha");
	state.setPreviewTabId("project", "alpha");
	assert.equal(render("pi-agent-config").activeTabId, "config");
	state = render("alpha");
	assert.equal(state.activeTabId, "project");
	assert.equal(state.previewTabId, "project");
	assert.equal(state.getWorkspace("pi-agent-config").tabs[0].dirty, true);
});

test("dirty updates from a hidden workspace do not affect the current workspace", () => {
	const render = harness();
	let state = render("alpha");
	state.setTabs([{ id: "a" }]);
	state.setPreviewTabId("a");
	state = render("beta");
	state.setTabs([{ id: "b" }]);
	state.setPreviewTabId("b");
	state.markDirty("a", true);
	state = render("beta");
	assert.equal(state.previewTabId, "b");
	state = render("alpha");
	assert.equal(state.tabs[0].dirty, true);
	assert.equal(state.previewTabId, null);
	state.markDirty("a", false);
	assert.equal(render("alpha").tabs[0].dirty, false);
});

test("failed saves retain the file and selection", async () => {
	const render = harness();
	const state = render("alpha");
	state.setTabs([{ id: "a", dirty: true }]);
	state.setActiveTabId("a");
	state.registerCloseGuard("a", async () => false);
	assert.equal(await state.closeTab("a"), false);
	assert.equal(render("alpha").activeTabId, "a");
	assert.equal(render("alpha").tabs.length, 1);
});

test("a delayed close removes the original file after workspace switches and preserves its neighbor", async () => {
	const render = harness();
	let finish;
	const state = render("alpha");
	state.setTabs([{ id: "a" }, { id: "neighbor" }]);
	state.setActiveTabId("a");
	state.registerCloseGuard(
		"a",
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const closing = state.closeTab("a");
	const beta = render("beta");
	beta.setTabs([{ id: "b" }]);
	beta.setActiveTabId("b");
	assert.equal(await beta.closeTab("a"), false);
	finish(true);
	assert.equal(await closing, true);
	assert.equal(render("beta").activeTabId, "b");
	assert.equal(render("alpha").activeTabId, "neighbor");
});

test("guard cleanup cannot unregister a newer guard for the same tab", async () => {
	const render = harness();
	const state = render("alpha");
	state.setTabs([{ id: "a" }]);
	const cleanup = state.registerCloseGuard("a", async () => true);
	state.registerCloseGuard("a", async () => false);
	cleanup();
	assert.equal(await state.closeTab("a"), false);
});

test("cache eviction preserves current and dirty files and refuses to discard protected edits", () => {
	const { pruneWorkspaceEditors } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceEditorState.ts", { stubs: { react: {} } });
	const state = (tabs) => ({ tabs, activeTabId: tabs[0]?.id ?? null, previewTabId: tabs[0]?.id ?? null });
	const projects = {
		alpha: state([
			{ id: "dirty", dirty: true },
			{ id: "old", lastAccess: 1 },
		]),
		beta: state([{ id: "active", lastAccess: 2 }]),
	};
	const trimmed = pruneWorkspaceEditors(projects, "beta", 2);
	assert.deepEqual(
		Array.from(trimmed.alpha.tabs, (tab) => tab.id),
		["dirty"],
	);
	assert.equal(trimmed.beta.activeTabId, "active");
	assert.equal(pruneWorkspaceEditors(trimmed, "beta", 1), null);
	assert.equal(projects.alpha.tabs.length, 2);
});
