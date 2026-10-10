import assert from "node:assert/strict";
import { test } from "node:test";
import { atom, createStore } from "jotai";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const projects = atom([{ id: "root" }, { id: "child", worktreeParentId: "root" }]);
const ids = atom({ root: ["main"], child: ["child"] });
const runtimes = atom({});
const ui = atom({});
const { workspaceProjectStatusAtomFamily } = loadTsCommonJs("src/renderer/src/atoms/workspace-project-atoms.ts", { stubs: { "./project-atoms": { projectInventoryAtom: projects }, "./session-atoms": { sessionIdsByProjectAtom: ids, sessionRuntimeByIdAtom: runtimes, sessionRuntimeUiByIdAtom: ui } } });
test("worktree summaries include current-generation asks and ignore late UI from stopped/replaced runtimes", () => {
	const store = createStore();
	store.set(runtimes, { main: { agentId: "new", runtimeGeneration: 2, status: "running" }, child: { agentId: "child-agent", runtimeGeneration: 1, status: "idle" } });
	const request = { status: "pending", request: { method: "confirm" } };
	store.set(ui, { main: { agentId: "old", runtimeGeneration: 1, requests: { ask: request } }, child: { agentId: "child-agent", runtimeGeneration: 1, requests: { ask: request } } });
	const status = workspaceProjectStatusAtomFamily("root");
	assert.deepEqual(JSON.parse(JSON.stringify(store.get(status))), { pending: 1, running: true, live: true });
	store.set(runtimes, { child: { agentId: "child-agent", runtimeGeneration: 1, status: "closed" } });
	assert.deepEqual(JSON.parse(JSON.stringify(store.get(status))), { pending: 0, running: false, live: false });
});
