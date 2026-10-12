import assert from "node:assert/strict";
import test from "node:test";
import * as jotai from "jotai";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
import { quickMessageHookHost } from "./helpers/quickMessageHookHost.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Two independently mounted consumers share an actual Jotai store and a deterministic IPC service. */
function consumers() {
	const store = jotai.createStore();
	const pending = [];
	const api = { projects: { listModelsReport: (projectId, force) => new Promise((resolve) => pending.push({ projectId, force, resolve })) } };
	const cache = new Map();
	function mount(projectId) {
		const host = quickMessageHookHost();
		// Cache the module graph so all consumers use the same catalog atom family.
		const loaded =
			cache.get("module") ??
			loadTsCommonJs("src/renderer/src/hooks/useBackendModelCatalog.ts", {
				stubs: {
					react: { useCallback: (...args) => cache.get("host").react.useCallback(...args), useEffect: (...args) => cache.get("host").react.useEffect(...args) },
					jotai: { ...jotai, useStore: () => store, useAtomValue: (atom) => store.get(atom) },
					"../desktopApi": { desktopApi: api },
					"../utils/notice": { showNotice() {} },
				},
			});
		cache.set("module", loaded);
		return {
			render: () => {
				cache.set("host", host);
				return host.render(() => loaded.useBackendModelCatalog({ sessionId: "welcome", backend: "pi", projectId, enabled: true }));
			},
			unmount: host.unmount,
		};
	}
	const resolve = (index, id) => pending[index].resolve({ ok: true, models: [{ provider: "demo", id }], at: index, source: "cache", reason: null, version: null });
	return { mount, resolve, pending };
}

test("Refreshing the model picker also updates an already mounted welcome composer catalog", async () => {
	const ui = consumers();
	const bottom = ui.mount();
	bottom.render();
	ui.resolve(0, "model-before-refresh");
	await flush();
	const picker = ui.mount();
	picker.render();
	if (ui.pending.length > 1) {
		ui.resolve(1, "model-before-refresh");
		await flush();
	}
	picker.render().reload(true);
	assert.equal(bottom.render().refreshing, true);
	assert.equal(bottom.render().loading, false);
	ui.resolve(ui.pending.length - 1, "model-after-refresh");
	await flush();
	assert.equal(picker.render().models[0].id, "model-after-refresh");
	assert.equal(bottom.render().models[0].id, "model-after-refresh");
	assert.equal(bottom.render().refreshing, false);
	bottom.unmount();
	picker.unmount();
});

test("A late old catalog response cannot overwrite the latest manual refresh", async () => {
	const ui = consumers();
	const bottom = ui.mount();
	bottom.render();
	const picker = ui.mount();
	picker.render().reload(true);
	ui.resolve(ui.pending.length - 1, "model-after-refresh");
	await flush();
	ui.resolve(0, "model-before-refresh");
	await flush();
	assert.equal(bottom.render().models[0].id, "model-after-refresh");
	bottom.unmount();
	picker.unmount();
});

test("A project catalog refresh does not replace another project's catalog", async () => {
	const ui = consumers();
	const a = ui.mount("project-a");
	a.render();
	ui.resolve(0, "model-a");
	await flush();
	const b = ui.mount("project-b");
	b.render();
	ui.resolve(ui.pending.length - 1, "model-b");
	await flush();
	assert.equal(a.render().models[0].id, "model-a");
	assert.equal(b.render().models[0].id, "model-b");
	a.unmount();
	b.unmount();
});
