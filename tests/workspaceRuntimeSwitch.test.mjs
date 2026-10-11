import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { switchWorkspaceRuntimes } = loadTsCommonJs("src/main/sessions/WorkspaceRuntimeSwitch.ts");
const { ProjectRuntimeFence } = loadTsCommonJs("src/main/pi/ProjectRuntimeFence.ts");

/** 隔离进程目录：停机只允许命中来源工作区，包括不可见的预热进程。 */
function harness(busy = false, fail = false) {
	const agents = new Map([
		["a", { project: "alpha", busy }],
		["standby", { project: "alpha", busy: false }],
		["b", { project: "beta", busy: true }],
	]);
	const calls = [];
	const port = {
		listProject: (id) => [...agents].filter(([, item]) => item.project === id).map(([id, item]) => ({ id, busy: item.busy })),
		pauseProject: (id) => calls.push(["pause", id]),
		resumeProject: (id) => calls.push(["resume", id]),
		stopAgent: async (id) => {
			if (fail) throw new Error("stop failed");
			calls.push(["stop", id]);
			agents.delete(id);
		},
		logFailure: (error) => calls.push(["error", error.message]),
	};
	return { agents, calls, port };
}
test("busy switch requires confirmation and leaves all processes intact", async () => {
	const h = harness(true);
	const result = await switchWorkspaceRuntimes({ fromProjectId: "alpha", toProjectId: "beta", terminateBusy: false }, h.port);
	assert.equal(result.status, "confirmation-required");
	assert.equal(result.busyCount, 1);
	assert.equal(h.agents.size, 3);
	assert.deepEqual(h.calls, []);
});
test("idle switch silently stops source Agents and standby before permitting selection", async () => {
	const h = harness();
	assert.equal((await switchWorkspaceRuntimes({ fromProjectId: "alpha", toProjectId: "beta", terminateBusy: false }, h.port)).status, "ready");
	assert.deepEqual(h.calls, [
		["pause", "alpha"],
		["stop", "a"],
		["stop", "standby"],
		["resume", "beta"],
	]);
	assert.equal(h.agents.has("b"), true);
});
test("confirmed busy switch terminates all source processes", async () => {
	const h = harness(true);
	assert.equal((await switchWorkspaceRuntimes({ fromProjectId: "alpha", toProjectId: "beta", terminateBusy: true }, h.port)).status, "ready");
	assert.deepEqual([...h.agents.keys()], ["b"]);
});
test("stop failure does not allow destination selection and reopens the source startup gate", async () => {
	const h = harness(false, true);
	const result = await switchWorkspaceRuntimes({ fromProjectId: "alpha", toProjectId: "beta", terminateBusy: false }, h.port);
	assert.equal(result.status, "failed");
	assert.equal(result.error, "stop failed");
	assert.deepEqual(h.calls, [
		["pause", "alpha"],
		["resume", "alpha"],
		["error", "stop failed"],
	]);
});
test("same workspace selection leaves its Agents running", async () => {
	const h = harness(true);
	await switchWorkspaceRuntimes({ fromProjectId: "alpha", toProjectId: "alpha", terminateBusy: false }, h.port);
	assert.equal(h.agents.size, 3);
	assert.deepEqual(h.calls, [["resume", "alpha"]]);
});
test("an old prewarm cannot resurrect after leaving and returning to its workspace", () => {
	const fence = new ProjectRuntimeFence();
	const generation = fence.capture("alpha");
	fence.pause("alpha");
	assert.equal(fence.valid("alpha", generation), false);
	assert.throws(() => fence.capture("alpha"));
	fence.resume("alpha");
	assert.equal(fence.valid("alpha", generation), false);
	assert.equal(fence.valid("alpha", fence.capture("alpha")), true);
});
