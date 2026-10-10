import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 普通问询会话的公开 hook 行为：不用真实 pi，不改当前主会话选择。 */
function harness(activate) {
	const atoms = Object.fromEntries(["askPanelOpenAtom", "askPanelSessionIdAtom", "askPanelOriginSessionIdAtom", "askPanelCreatingAtom", "askPanelGenerationAtom"].map((key) => [key, key]));
	const values = new Map([
		[atoms.askPanelOpenAtom, false],
		[atoms.askPanelSessionIdAtom, null],
		[atoms.askPanelOriginSessionIdAtom, null],
		[atoms.askPanelCreatingAtom, false],
		[atoms.askPanelGenerationAtom, 0],
		["backend", "pi"],
	]);
	const calls = [];
	const records = new Map();
	const runtime = { sessionId: "saved-ask", projectId: "p", cwd: "C:/p", agentId: "agent", runtimeGeneration: 1, status: "idle", updatedAt: 1 };
	const store = { get: (key) => values.get(key), set: (key, value) => (key === "upsert" ? records.set(value.id, value) : values.set(key, value)) };
	const sessions = {
		createDraft: async (input) => {
			calls.push(["create", input]);
			return { id: "saved-ask", projectId: input.projectId, title: input.title, backend: input.backend, source: "pi", environment: "native", preview: "", messageCount: 0, status: "draft", createdAt: 1, updatedAt: 1 };
		},
		activateRuntime: async (id) => {
			calls.push(["activate", id]);
			if (activate) return activate(runtime);
			values.set(`runtime:${id}`, runtime);
			return { ok: true, value: runtime };
		},
		sendPrompt: async (input) => {
			calls.push(["send", input]);
			return { accepted: true };
		},
		stopRuntime: async (target) => calls.push(["stop", target]),
	};
	const { useAskPanel } = loadTsCommonJs("src/renderer/src/hooks/useAskPanel.ts", {
		stubs: {
			react: { useCallback: (fn) => fn },
			jotai: { useAtom: (key) => [values.get(key), (value) => values.set(key, value)], useAtomValue: (key) => values.get(key), useStore: () => store },
			"../atoms/ask-panel-atoms": atoms,
			"../atoms/app-ui-atoms": { effectiveAgentBackendAtom: "backend" },
			"../atoms/session-atoms": { upsertSessionAtom: "upsert" },
			"../atoms/session-selectors": { sessionRuntimeBySessionIdAtomFamily: (id) => `runtime:${id}` },
			"../desktopApi": { desktopApi: { sessions } },
			"../i18n": { t: (key) => key },
			"../utils/notice": { showNotice: (message) => calls.push(["notice", message]) },
		},
	});
	return { render: useAskPanel, values, records, calls };
}
test("ask creates and activates a saved session, reuses it for follow-up and keeps history on close", async () => {
	const h = harness();
	assert.equal(await h.render().sendToAsk("p", "question", { context: "context", originSessionId: "main" }), true);
	assert.equal(h.records.get("saved-ask").noSession, undefined);
	assert.equal(h.render().originSessionId, "main");
	assert.equal(await h.render().sendFollowUp("follow-up"), true);
	assert.equal(h.calls.filter(([kind]) => kind === "create").length, 1);
	assert.equal(h.calls.find(([kind]) => kind === "send")[1].agentMessage, "context\n\nquestion");
	await h.render().close();
	assert.equal(h.render().sessionId, null);
	assert.equal(h.render().originSessionId, null);
	assert.ok(h.records.has("saved-ask"));
	assert.equal(h.calls.filter(([kind]) => kind === "stop").length, 1);
});
test("activation failure preserves the draft, clears the panel and never sends a prompt", async () => {
	const h = harness(async () => ({ ok: false, error: { code: "SESSION_NOT_FOUND" } }));
	assert.equal(await h.render().sendToAsk("p", "question"), false);
	assert.equal(h.render().isOpen, false);
	assert.equal(h.render().sessionId, null);
	assert.equal(h.render().creating, false);
	assert.ok(h.records.has("saved-ask"));
	assert.equal(h.calls.filter(([kind]) => kind === "send").length, 0);
});
test("closing during activation stops the late runtime without reopening or sending", async () => {
	let finish;
	const h = harness(
		(runtime) =>
			new Promise((resolve) => {
				finish = () => resolve({ ok: true, value: runtime });
			}),
	);
	const send = h.render().sendToAsk("p", "question");
	await new Promise(setImmediate);
	assert.equal(h.render().isOpen, true);
	await h.render().close();
	finish();
	assert.equal(await send, false);
	assert.equal(h.render().isOpen, false);
	assert.equal(h.render().sessionId, null);
	assert.equal(h.calls.filter(([kind]) => kind === "send").length, 0);
	assert.equal(h.calls.filter(([kind]) => kind === "stop").length, 1);
});
