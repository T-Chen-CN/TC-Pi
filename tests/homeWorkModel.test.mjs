import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { buildHomeWork } = loadTsCommonJs("src/renderer/src/components/home/homeWorkModel.ts");
const { createHomeSession } = loadTsCommonJs("src/renderer/src/components/home/homeWorkActions.ts");
const project = (id, extra = {}) => ({ id, name: id, path: `C:/work/${id}`, lastOpenedAt: 0, ...extra });
const session = (id, projectId = "alpha", extra = {}) => ({ id, projectId, title: id, source: "pi", environment: "native", preview: "", messageCount: 0, status: "active", createdAt: 1, updatedAt: 1, ...extra });
const build = (extra = {}) => buildHomeWork({ projects: [project("alpha")], sessions: [], runtimes: {}, pendingRequests: {}, ...extra });

test("home recent sessions follow last activity and keep a bounded list without mutating the catalog", () => {
	const sessions = Array.from({ length: 13 }, (_, index) => session(`session-${index}`, "alpha", { createdAt: index, updatedAt: index }));
	sessions[0].updatedAt = 100;
	const before = JSON.stringify(sessions);
	const result = build({ sessions });
	assert.equal(result.recentSessions.length, 12);
	assert.equal(result.recentSessions[0].id, "session-0");
	assert.equal(JSON.stringify(sessions), before);
});

test("continue work keeps the selected session and falls back to the latest available session", () => {
	const sessions = [session("older"), session("latest", "alpha", { updatedAt: 10 })];
	assert.equal(build({ sessions, currentSessionId: "older" }).resumeSession.id, "older");
	assert.equal(build({ sessions, currentSessionId: "deleted" }).resumeSession.id, "latest");
	assert.equal(build().resumeSession, undefined);
});

for (const [signal, metadata] of [
	["stable parent identity", { parentSessionId: "parent" }],
	["parent file path", { parentSessionPath: "C:/work/alpha/parent.jsonl" }],
	["imported subagent source", { codexThreadSource: "subagent" }],
]) {
	test(`home recent and resume entries exclude children identified by ${signal}`, () => {
		const result = build({ sessions: [session("parent"), session("child", "alpha", { ...metadata, updatedAt: 100 })], currentSessionId: "child" });
		assert.deepEqual(
			Array.from(result.recentSessions, (row) => row.id),
			["parent"],
		);
		assert.equal(result.resumeSession.id, "parent");
		assert.equal(result.recentWorkspaces[0].lastSession.id, "parent");
	});
}

test("orphan children never fill the recent-session quota or become a resume target", () => {
	const children = Array.from({ length: 13 }, (_, index) => session(`child-${index}`, "alpha", { parentSessionId: "missing-parent", updatedAt: 100 + index }));
	const result = build({ sessions: [session("normal"), ...children] });
	assert.deepEqual(
		Array.from(result.recentSessions, (row) => row.id),
		["normal"],
	);
	assert.equal(result.resumeSession.id, "normal");
	assert.equal(build({ sessions: children }).resumeSession, undefined);
});

test("explicit user forks stay independent even when their origin retains a parent reference", () => {
	const result = build({ sessions: [session("parent"), session("fork", "alpha", { forked: true, parentSessionId: "parent", parentSessionPath: "C:/work/alpha/parent.jsonl", updatedAt: 100 })] });
	assert.deepEqual(
		Array.from(result.recentSessions, (row) => row.id),
		["fork", "parent"],
	);
	assert.equal(result.resumeSession.id, "fork");
});

test("hiding child history does not discard a child task that needs a response", () => {
	const result = build({ sessions: [session("parent"), session("child", "alpha", { parentSessionId: "parent" })], runtimes: { child: { agentId: "child-agent", status: "idle" } }, pendingRequests: { child: 1 } });
	assert.equal(result.attention[0].session.id, "child");
	assert.equal(result.attention[0].pendingCount, 1);
	assert.equal(result.recentWorkspaces[0].activeCount, 1);
});

test("home excludes anonymous, replaced and unavailable sessions from every work entry", () => {
	const result = build({
		projects: [project("alpha"), project("missing", { missing: true })],
		sessions: [session("valid"), session("anonymous", "alpha", { noSession: true }), session("replaced", "alpha", { supersededBy: "valid" }), session("orphan", "deleted"), session("missing", "missing")],
		runtimes: { anonymous: { agentId: "a", status: "running" }, replaced: { agentId: "b", status: "running" }, orphan: { agentId: "c", status: "error" } },
	});
	assert.deepEqual(
		Array.from(result.recentSessions, (row) => row.id),
		["valid"],
	);
	assert.equal(result.attention.length, 0);
	assert.equal(result.running.length, 0);
});

test("home separates requests and failures from active tasks and never treats idle processes as work", () => {
	const ids = ["idle", "pending", "error", "running", "starting", "closed", "unbound"];
	const runtimes = Object.fromEntries(ids.map((id) => [id, { agentId: id === "unbound" ? undefined : `agent-${id}`, status: id === "pending" || id === "unbound" ? "idle" : id }]));
	const result = build({ sessions: ids.map((id) => session(id)), runtimes, pendingRequests: { pending: 2, closed: 1, unbound: 1 } });
	assert.deepEqual(
		Array.from(result.attention, (row) => [row.session.id, row.state, row.pendingCount]),
		[
			["pending", "pending", 2],
			["error", "error", 0],
		],
	);
	assert.deepEqual(Array.from(result.running, (row) => row.state).sort(), ["running", "starting"]);
});

test("recent workspaces follow activity, keep six entries and attach their latest session", () => {
	const projects = Array.from({ length: 8 }, (_, index) => project(`project-${index}`, { lastOpenedAt: index }));
	projects.push(project("chat", { kind: "chat", lastOpenedAt: 1000 }));
	const result = build({ projects, sessions: [session("recent", "project-0", { updatedAt: 100 })] });
	assert.equal(result.recentWorkspaces.length, 6);
	assert.equal(result.recentWorkspaces[0].project.id, "project-0");
	assert.equal(result.recentWorkspaces[0].lastSession.id, "recent");
	assert.equal(result.newSessionProjectId, "project-0");
});

test("new sessions use the selected ordinary workspace while chat falls back to a workspace", () => {
	const projects = [project("alpha"), project("beta", { lastOpenedAt: 10 }), project("chat", { kind: "chat" })];
	const sessions = [session("selected"), session("chat-session", "chat", { updatedAt: 100 })];
	assert.equal(build({ projects, sessions, currentSessionId: "selected" }).newSessionProjectId, "alpha");
	assert.equal(build({ projects, sessions, currentSessionId: "chat-session" }).newSessionProjectId, "beta");
});

test("home new session reuses the workspace without opening a directory dialog", async () => {
	const calls = [];
	await createHomeSession({ addWorkspace: async () => calls.push("unexpected"), createDraft: async (id) => calls.push(id) }, "alpha");
	assert.deepEqual(calls, ["alpha"]);
});

test("home new session asks for a workspace first and cancellation creates no session", async () => {
	const calls = [];
	const actions = { addWorkspace: async () => undefined, createDraft: async (id) => calls.push(id) };
	await createHomeSession(actions);
	assert.deepEqual(calls, []);
	await createHomeSession({ ...actions, addWorkspace: async () => "new-project" });
	assert.deepEqual(calls, ["new-project"]);
});
