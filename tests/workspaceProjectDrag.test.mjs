import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function harness() {
	const snapshot = { current: undefined };
	const calls = [];
	const controller = {
		catalog: { projects: [{ id: "a" }, { id: "b" }, { id: "child", worktreeParentId: "a" }, { id: "chat", kind: "chat" }] },
		drag: {},
		startProjectDrag: (id) => {
			controller.drag = { sourceProjectId: id };
		},
		setProjectDropTarget: (id, placement) => calls.push(["over", id, placement]),
		finishProjectDrag: () => calls.push(["finish"]),
	};
	const actions = { projects: { reorder: async (...args) => calls.push(["reorder", ...args]) } };
	const { useWorkspaceProjectDrag, WORKSPACE_DRAG_MIME } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceProjectDrag.ts", { stubs: { react: { useRef: () => snapshot, useCallback: (fn) => fn }, "../utils/notice": { showNotice: () => undefined }, "../i18n": { t: (key) => key } } });
	const data = new Map();
	const event = { clientY: 75, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) }, dataTransfer: { types: [], setData: (type, value) => data.set(type, value), getData: (type) => data.get(type) ?? "" }, preventDefault: () => calls.push(["prevent"]) };
	return { render: () => useWorkspaceProjectDrag(controller, actions), controller, calls, event, data, mime: WORKSPACE_DRAG_MIME };
}
test("workspace dragging uses a distinct MIME and the actual upper/lower drop position", async () => {
	const h = harness();
	const drag = h.render();
	drag.start(h.event, "a");
	assert.equal(h.data.get(h.mime), "a");
	drag.over(h.event, "b");
	drag.drop(h.event, "b");
	assert.ok(h.calls.some(([kind, id, placement]) => kind === "over" && id === "b" && placement === "after"));
	assert.deepEqual(
		h.calls.find(([kind]) => kind === "reorder"),
		["reorder", "a", "b", "after"],
	);
});
test("session/file drops and worktree/chat targets cannot reorder workspaces", () => {
	const h = harness();
	const drag = h.render();
	h.data.set("text/plain", "a");
	drag.drop(h.event, "b");
	h.data.set(h.mime, "a");
	drag.drop(h.event, "child");
	drag.drop(h.event, "chat");
	assert.equal(h.calls.length, 0);
});
test("a target removed during the drag is rejected using the latest catalog", () => {
	const h = harness();
	const drag = h.render();
	drag.start(h.event, "a");
	h.controller.catalog = { projects: [{ id: "a" }] };
	h.render();
	drag.drop(h.event, "b");
	assert.equal(
		h.calls.some(([kind]) => kind === "reorder"),
		false,
	);
});
