import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { useSessionActions } = loadTsCommonJs("src/renderer/src/hooks/useSessionActions.ts", { stubs: { "../i18n": { t: (key) => key } } });

/** 选择命令的公开端口；草稿、消息和历史的删除口独立记录以防误清。 */
function harness(prepare, createDraft = async () => ({ id: "draft", projectId: "alpha" })) {
	const calls = [];
	const options = {
		openSessionRequestRef: { current: 0 },
		creatingSessionDraftRef: { current: new Set() },
		activeProjectId: "alpha",
		projects: [{ id: "alpha", name: "Alpha" }],
		setActiveProjectId: (id) => calls.push(["project", id]),
		setCurrentSessionId: (id) => calls.push(["session", id]),
		upsertSession: (record) => calls.push(["upsert", record.id]),
		removeSessionState: (id) => calls.push(["remove", id]),
		removeSessionComposerState: (id) => calls.push(["remove-draft", id]),
		api: { sessions: { createDraft } },
		showToast: (message) => calls.push(["error", message]),
		prepareProjectSelection: prepare,
	};
	return { actions: useSessionActions(options), calls };
}
test("a cancelled workspace selection changes no session, draft or history", async () => {
	const h = harness(async () => false);
	assert.equal(await h.actions.selectSession("beta", "history"), false);
	assert.deepEqual(h.calls, []);
});
test("a rejected duplicate request cannot undo a switch whose source has already stopped", async () => {
	let release;
	let pending = false;
	const h = harness(() => {
		if (pending) return Promise.resolve(false);
		pending = true;
		return new Promise((resolve) => {
			release = resolve;
		});
	});
	const first = h.actions.selectProject("beta");
	assert.equal(await h.actions.selectProject("gamma"), false);
	release(true);
	assert.equal(await first, true);
	assert.deepEqual(h.calls, [
		["project", "beta"],
		["session", undefined],
	]);
});
test("draft creation stays deduplicated while awaiting the workspace gate", async () => {
	let release;
	let created = 0;
	let first = true;
	const h = harness(
		() => {
			if (!first) return Promise.resolve(true);
			first = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		},
		async () => {
			created++;
			return { id: "draft", projectId: "alpha" };
		},
	);
	const pending = h.actions.createSessionDraft("alpha");
	assert.equal(await h.actions.createSessionDraft("alpha"), undefined);
	release(true);
	assert.equal((await pending).id, "draft");
	assert.equal(created, 1);
});
