import assert from "node:assert/strict";
import { test } from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
/** 通过 hook 的刷新入口检查异步快照、取消与配对清理。 */
function harness(api) {
	let state = { loading: true, providers: [], usageMissing: false, usageError: false, configError: false };
	const write = (next) => {
		state = typeof next === "function" ? next(state) : next;
	};
	const slots = [];
	const effects = [];
	let cursor = 0;
	const listeners = new Map();
	const timers = new Set();
	const react = {
		useRef(initial) {
			const index = cursor++;
			return (slots[index] ??= { current: initial });
		},
		useCallback(callback) {
			return callback;
		},
		useEffect(callback, deps) {
			const index = cursor++;
			const previous = slots[index];
			if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
			effects.push(() => {
				previous?.cleanup?.();
				slots[index] = { deps, cleanup: callback() };
			});
		},
	};
	const load = createTsSandbox({
		stubs: { react, jotai: { useSetAtom: () => write }, "../desktopApi": { desktopApi: api }, "../atoms/home-overview-atoms": { homeOverviewAtom: {} } },
		globals: {
			document: { hidden: false },
			window: {
				setInterval(callback) {
					const token = {};
					timers.add(token);
					return token;
				},
				clearInterval(token) {
					timers.delete(token);
				},
				addEventListener(name, callback) {
					listeners.set(name, callback);
				},
				removeEventListener(name, callback) {
					if (listeners.get(name) === callback) listeners.delete(name);
				},
			},
		},
	});
	const { useHomeOverview } = load("src/renderer/src/hooks/useHomeOverview.ts");
	return {
		render(enabled) {
			cursor = 0;
			const refresh = useHomeOverview(enabled);
			effects.splice(0).forEach((effect) => effect());
			return refresh;
		},
		read: () => state,
		timers,
		listeners,
	};
}
const api = (detect = async () => ({ installed: false })) => ({
	usageStats: { detect, refresh: async () => undefined, get: async () => undefined },
	config: { getModels: async () => ({ parsed: { providers: { custom: { models: [{ id: "model" }], apiKey: "fixture-secret" } } } }), getAuth: async () => ({ parsed: {} }), getSettings: async () => ({ parsed: { defaultProvider: "custom", defaultModel: "model" } }) },
});

test("missing usage stays distinct from zero usage and credentials never enter the snapshot", async () => {
	const h = harness(api());
	h.render(true);
	await flush();
	assert.equal(h.read().usageMissing, true);
	assert.equal(h.read().usage, undefined);
	assert.equal(h.read().defaultModel, "custom/model");
	assert.equal(h.read().providers[0].authenticated, true);
	assert.doesNotMatch(JSON.stringify(h.read()), /fixture-secret/);
});
test("leaving home removes the timer/listener and discards a late refresh result", async () => {
	let resolveDetect;
	const h = harness(
		api(
			() =>
				new Promise((resolve) => {
					resolveDetect = resolve;
				}),
		),
	);
	h.render(true);
	assert.equal(h.timers.size, 1);
	assert.equal(h.listeners.size, 1);
	h.render(false);
	const before = JSON.stringify(h.read());
	resolveDetect({ installed: false });
	await flush();
	assert.equal(h.timers.size, 0);
	assert.equal(h.listeners.size, 0);
	assert.equal(JSON.stringify(h.read()), before);
});
test("a failed usage read keeps provider metadata usable and exposes the usage error", async () => {
	const h = harness(
		api(async () => {
			throw new Error("unreadable");
		}),
	);
	h.render(true);
	await flush();
	assert.equal(h.read().usageError, true);
	assert.equal(h.read().configError, false);
	assert.equal(h.read().providers[0].id, "custom");
});
