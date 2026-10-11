import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const features = loadTsCommonJs("src/shared/productFeatures.ts");
const visibility = loadTsCommonJs("src/shared/hiddenModules.ts");

test("legacy settings cannot enable removed modules and are not mutated", () => {
	const saved = {
		defaultAgentBackend: "dsh",
		acpEnabled: true,
		acpTools: [{ id: "old" }],
		petEnabled: true,
		floatingBallEnabled: true,
		cuaEnabled: true,
		feishuAppId: "old",
		visionEnabled: true,
		imEnabled: true,
		promptStoreLastQuery: "old",
		sessionSortMode: "updated",
		announcementNotificationEnabled: true,
		webServiceEnabled: true,
		voiceTranscriptionEnabled: true,
	};
	const projected = features.productSettings(saved);
	assert.equal(projected.defaultAgentBackend, "pi");
	for (const key of ["acpEnabled", "acpTools", "petEnabled", "floatingBallEnabled", "cuaEnabled", "feishuAppId", "visionEnabled", "imEnabled", "promptStoreLastQuery", "sessionSortMode", "announcementNotificationEnabled"]) assert.equal(Object.hasOwn(projected, key), false);
	assert.equal(projected.webServiceEnabled, true);
	assert.equal(projected.voiceTranscriptionEnabled, true);
	assert.equal(saved.defaultAgentBackend, "dsh");
	assert.equal(saved.acpTools.length, 1);
	for (const id of ["dsh", "acp", "im", "pet", "vision", "imagegen"]) {
		assert.equal(visibility.isModuleHidden([], id), true);
		assert.equal(visibility.HIDEABLE_MODULE_IDS.includes(id), false);
	}
});

test("removed session identities are rejected before spawning or writing catalog data", async () => {
	const { SessionRuntimeCoordinator } = loadTsCommonJs("src/main/sessions/SessionRuntimeCoordinator.ts");
	for (const backend of ["dsh", "acp", "imagegen"]) {
		let spawned = 0;
		let written = 0;
		const entry = { id: "old", projectId: "project", backend, status: "draft" };
		const catalog = {
			get: () => entry,
			update: () => {
				written++;
			},
			attachRuntime: () => {
				written++;
			},
		};
		const agents = {
			backend: "pi",
			list: () => [],
			create: () => {
				spawned++;
			},
		};
		const coordinator = new SessionRuntimeCoordinator(catalog, agents, () => {
			throw new Error("must not send");
		});
		const result = await coordinator.activateRuntime("old");
		assert.equal(result.ok, false);
		assert.match(result.error.debugDetails, /only supports the pi backend/);
		assert.equal(spawned, 0);
		assert.equal(written, 0);
		assert.equal(entry.backend, backend);
	}
});

test("local resources remain available while online store handlers are absent", () => {
	const handlers = new Map();
	const { registerStoreIpc } = loadTsCommonJs("src/main/ipc/storeIpc.ts", { stubs: { electron: { ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) } } } });
	registerStoreIpc({ promptManager: {}, skillManager: {}, extensionManager: {}, projectResourceManager: {}, appLogger: {}, mainCopy: (key) => key });
	for (const channel of ["prompts:list", "prompts:create", "extensions:list", "extensions:install"]) assert.equal(handlers.has(channel), true);
	for (const channel of handlers.keys()) assert.doesNotMatch(channel, /(?:prompt-store|skill-store|skill-hub|xue|yao|catalog)/);
});

test("distribution dependencies and resources exclude removed runtimes", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) assert.doesNotMatch(dependency, /^(?:@deepseek-ai\/|@larksuiteoapi\/|koffi$|dsh-|@astron-team\/)/);
	for (const resource of pkg.build.extraResources) assert.doesNotMatch(resource.from, /dsh-runtime|build\/pets|xueprompts/);
	assert.doesNotMatch(pkg.scripts.build, /dsh|xueprompts|runtime:pack/);
});
