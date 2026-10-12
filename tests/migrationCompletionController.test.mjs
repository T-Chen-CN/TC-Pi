import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { resolveInstallPaths } = loadTsCommonJs("src/main/storage/installPaths.ts");
const { migrateInstallationStorage } = loadTsCommonJs("src/main/storage/installationMigration.ts");
const { mainProcessT } = loadTsCommonJs("src/shared/i18n/mainProcessCopy.ts");
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-notice-")),
		old = join(root, "old"),
		pi = join(root, "pi");
	mkdirSync(old);
	mkdirSync(pi);
	writeFileSync(join(old, "settings.json"), "{}");
	writeFileSync(join(pi, "models.json"), "{}");
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "app", "app.exe"), appPath: "unused" });
	for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
	const sources = { desktopSources: [old], piSource: pi };
	migrateInstallationStorage(paths, sources);
	return { paths, sources, old, pi };
}
function controller(f, messages, options = {}) {
	const { MigrationCompletionController } = loadTsCommonJs("src/main/storage/MigrationCompletionController.ts", { stubs: { electron: { dialog: { showMessageBox: async (_window, message) => messages.push(message) } } } });
	return new MigrationCompletionController({ paths: f.paths, sources: f.sources, probe: async () => ({ ok: true }), window: () => ({ isDestroyed: () => false }), copy: (key, params) => mainProcessT("zh-CN", key, params), warn: () => {}, ...options });
}
test("notice names cleaned and retained sources, reasons and destinations once across restarts", async () => {
	const f = fixture(),
		messages = [];
	const owner = controller(f, messages);
	await owner.run();
	await owner.notify();
	assert.equal(messages.length, 1);
	assert.match(messages[0].detail, /已迁移并清理/);
	assert.match(messages[0].detail, /已迁移但未清理/);
	assert.match(messages[0].detail, /可能共用/);
	assert.ok(messages[0].detail.includes(join(f.old, "settings.json")));
	assert.ok(messages[0].detail.includes(join(f.pi, "models.json")));
	assert.ok(existsSync(join(f.paths.data, "migration-result.json")));
	await controller(f, messages).run();
	assert.equal(messages.length, 1);
	owner.dispose();
});
test("verification before window creation is reported when the window becomes available", async () => {
	const f = fixture(),
		messages = [];
	let window = null;
	const owner = controller(f, messages, { window: () => window });
	await owner.run();
	assert.equal(messages.length, 0);
	window = { isDestroyed: () => false };
	await owner.notify();
	assert.equal(messages.length, 1);
	owner.dispose();
});
test("a later successful runtime installation reports the newly completed cleanup", async () => {
	const f = fixture(),
		messages = [];
	let ready = false;
	const owner = controller(f, messages, { probe: async () => ({ ok: ready }) });
	await owner.run();
	assert.equal(messages.length, 1);
	assert.match(messages[0].detail, /尚未通过启动验证/);
	ready = true;
	await owner.run();
	assert.equal(messages.length, 2);
	assert.equal(existsSync(join(f.old, "settings.json")), false);
	owner.dispose();
});
test("invalid audit data retains sources and produces a warning notice", async () => {
	const f = fixture(),
		messages = [];
	writeFileSync(join(f.paths.data, "migration-audit.json"), "bad JSON");
	await controller(f, messages).run();
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].type, "warning");
});
test("controller disposal cancels its own probe and prevents cleanup or notices", async () => {
	const f = fixture(),
		messages = [];
	let owner;
	owner = controller(f, messages, {
		probe: async (signal) => {
			owner.dispose();
			assert.equal(signal.aborted, true);
			return { ok: true };
		},
	});
	await owner.run();
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	assert.equal(messages.length, 0);
});
