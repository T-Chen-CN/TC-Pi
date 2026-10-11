import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { AutomationStore } = loadTsCommonJs("src/main/automation/AutomationStore.ts");
const { AutomationRunCoordinator } = loadTsCommonJs("src/main/automation/AutomationRunCoordinator.ts");
const { AutomationScheduler } = loadTsCommonJs("src/main/automation/AutomationScheduler.ts");

/** Emulate persisted legacy tasks without invoking a real Agent or touching user data. */
async function fixture(t) {
	const dir = await mkdtemp(join(tmpdir(), "pideck-retired-automation-"));
	t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
	const store = new AutomationStore(join(dir, "automation.json"));
	const baseline = new Date(2026, 9, 11, 8, 59).getTime();
	await store.load(baseline);
	const legacy = await store.createTask({ name: "Legacy task", backend: "dsh", projectId: "p1", prompt: "Legacy", schedule: { type: "cron", expression: "0 9 * * *" } }, baseline);
	const sessions = [];
	const coordinator = new AutomationRunCoordinator({
		store,
		catalog: {
			createDraft: async (input) => {
				sessions.push(input);
				return { ...input, id: "draft" };
			},
		},
		sessionRuntimeCoordinator: {
			send: async () => {
				throw new Error("No runtime may start");
			},
		},
		projectStore: { get: (id) => ({ id, path: dir, environment: "native" }) },
	});
	t.after(() => coordinator.dispose());
	return { store, coordinator, sessions, legacy, baseline };
}

test("manual legacy automation is rejected before writing a run or draft", async (t) => {
	const { store, coordinator, sessions, legacy } = await fixture(t);
	await assert.rejects(coordinator.runNow(legacy.id), /only supports the pi backend/);
	assert.equal(store.listRuns().length, 0);
	assert.equal(sessions.length, 0);
	assert.equal(store.getTask(legacy.id).backend, "dsh");
});

test("legacy queued automation fails without creating a session", async (t) => {
	const { store, coordinator, sessions, legacy } = await fixture(t);
	const run = await store.createRun({ task: legacy, trigger: "manual", status: "queued" });
	await coordinator.drainQueue();
	assert.equal(store.getRun(run.id).status, "failed");
	assert.match(store.getRun(run.id).error, /only supports the pi backend/);
	assert.equal(sessions.length, 0);
});

test("scheduler skips retired tasks while scheduling supported tasks", async (t) => {
	const { store, legacy, baseline } = await fixture(t);
	const active = await store.createTask({ name: "Pi task", projectId: "p1", prompt: "Active", schedule: legacy.schedule }, baseline);
	const scheduled = [];
	const scheduler = new AutomationScheduler(store);
	scheduler.setTriggerHandler(async (task) => {
		scheduled.push(task.id);
	});
	await scheduler.tick(baseline + 65_000);
	assert.deepEqual(scheduled, [active.id]);
	assert.equal(store.getTask(legacy.id).backend, "dsh");
	assert.equal(store.getTask(legacy.id).lastScheduledAt, legacy.lastScheduledAt);
});

test("automation IPC cannot silently convert a legacy task to pi", async (t) => {
	const { store, coordinator, legacy } = await fixture(t);
	const handlers = new Map();
	const { registerAutomationIpc } = loadTsCommonJs("src/main/ipc/automationIpc.ts", { stubs: { electron: { ipcMain: { handle: (key, handler) => handlers.set(key, handler), removeHandler: (key) => handlers.delete(key) } } } });
	const unregister = registerAutomationIpc({ automationStore: store, automationRunCoordinator: coordinator, automationScheduler: { tick: async () => {} }, appLogger: { info() {}, error() {} }, onNotifyChanged() {} });
	t.after(unregister);
	await assert.rejects(handlers.get("automation:update-task")({}, legacy.id, { backend: "pi", name: "Rewritten" }), /only supports the pi backend/);
	assert.equal(store.getTask(legacy.id).backend, "dsh");
	assert.equal(store.getTask(legacy.id).name, "Legacy task");
});
