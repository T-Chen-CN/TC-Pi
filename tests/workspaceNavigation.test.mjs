import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { workspaceLandingSession, workspaceSessions } = loadTsCommonJs("src/renderer/src/utils/workspaceNavigation.ts");
const session = (id, updatedAt, extra = {}) => ({ id, projectId: "workspace", title: id, preview: "", messageCount: 0, status: "active", source: "pi", environment: "native", createdAt: updatedAt, updatedAt, ...extra });

test("workspace restores the remembered stable session before the newest one", () => {
	const records = [session("old", 1), session("new", 2)];
	assert.equal(workspaceLandingSession(records, "old").id, "old");
	assert.equal(workspaceLandingSession(records, "deleted").id, "new");
	assert.deepEqual(
		records.map((record) => record.id),
		["old", "new"],
		"sorting does not mutate the catalog",
	);
});
test("updating an old session never moves it above a later creation", () => {
	assert.deepEqual(
		Array.from(workspaceSessions([session("old", 100, { createdAt: 1 }), session("new", 2)]), (record) => record.id),
		["new", "old"],
	);
});
test("empty or replaced histories do not create or restore a session", () => {
	assert.equal(workspaceLandingSession([]), undefined);
	assert.equal(workspaceLandingSession([session("anonymous", 9, { noSession: true }), session("parent", 8, { supersededBy: "fork" })], "parent"), undefined);
	assert.deepEqual(
		Array.from(workspaceSessions([session("b", 1), session("a", 1)]), (record) => record.id),
		["a", "b"],
	);
});
