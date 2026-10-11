import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { AutomationStore } = loadTsCommonJs("src/main/automation/AutomationStore.ts");
const { AutomationScheduler } = loadTsCommonJs("src/main/automation/AutomationScheduler.ts");
async function fixture(t) {
	const dir = await mkdtemp(join(tmpdir(), "pideck-retired-automation-"));
	t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
	const file = join(dir, "automation.json"),
		baseline = new Date(2026, 9, 11, 8, 59).getTime();
	const input = { name: "Task", projectId: "p1", prompt: "Active", schedule: { type: "cron", expression: "0 9 * * *" } };
	return { store: new AutomationStore(file), file, baseline, input };
}
test("retired backend task creation is rejected before persistence", async (t) => {
	const { store, baseline, input } = await fixture(t);
	await store.load(baseline);
	for (const backend of ["dsh", "acp", "imagegen"]) await assert.rejects(store.createTask({ ...input, backend }, baseline), /only supports the pi backend/);
	assert.equal(store.listTasks().length, 0);
});
test("loading drops retired tasks while the scheduler still runs the Pi task", async (t) => {
	const { store, file, baseline, input } = await fixture(t);
	const tasks = ["pi", "dsh", "acp", "imagegen"].map((backend) => ({ ...input, id: backend, backend, enabled: true, createdAt: baseline, updatedAt: baseline, lastScheduledAt: baseline, budget: {} }));
	await writeFile(file, JSON.stringify({ version: 1, revision: 0, settings: {}, tasks, runs: [] }));
	await store.load(baseline);
	assert.deepEqual(
		[...store.listTasks()].map((task) => task.id),
		["pi"],
	);
	const scheduled = [],
		scheduler = new AutomationScheduler(store);
	scheduler.setTriggerHandler(async (task) => scheduled.push(task.id));
	await scheduler.tick(baseline + 65000);
	assert.deepEqual(scheduled, ["pi"]);
});
test("editing a Pi task cannot enable a retired backend", async (t) => {
	const { store, baseline, input } = await fixture(t);
	await store.load(baseline);
	const task = await store.createTask({ ...input, backend: "pi" }, baseline);
	await assert.rejects(store.updateTask(task.id, { backend: "dsh" }), /only supports the pi backend/);
	assert.equal(store.getTask(task.id).backend, "pi");
});
