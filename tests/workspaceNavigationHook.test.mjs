import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 最小 hook 调度器：测试公开导航动作与 catalog 异步结算，不加载窗口或 pi。 */
function harness(prepareProjectSelection) {
	const atoms = { sessionRecordsAtom: {}, sessionCatalogLoadStateAtom: {} };
	const navigationAtoms = { workspacePageAtom: {}, workspaceListsAtom: {}, workspaceLastSessionsAtom: {} };
	const pluginAtom = {};
	const values = new Map([
		[atoms.sessionRecordsAtom, {}],
		[atoms.sessionCatalogLoadStateAtom, {}],
		[navigationAtoms.workspacePageAtom, "home"],
		[navigationAtoms.workspaceListsAtom, { projects: false, sessions: false }],
		[navigationAtoms.workspaceLastSessionsAtom, {}],
		[pluginAtom, null],
	]);
	const slots = [];
	const effects = [];
	let cursor = 0;
	let projectId;
	let sessionId;
	const calls = [];
	const update = (key, next) => values.set(key, typeof next === "function" ? next(values.get(key)) : next);
	const react = {
		useRef(initial) {
			const index = cursor++;
			return (slots[index] ??= { current: initial });
		},
		useState(initial) {
			const index = cursor++;
			slots[index] ??= { value: initial };
			return [
				slots[index].value,
				(next) => {
					slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
				},
			];
		},
		useCallback(callback) {
			return callback;
		},
		useMemo(factory) {
			return factory();
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
	const { useWorkspaceNavigation } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceNavigation.ts", {
		stubs: {
			react,
			jotai: { useStore: () => ({ get: (key) => values.get(key) }), useAtom: (key) => [values.get(key), (next) => update(key, next)], useAtomValue: (key) => values.get(key) },
			"../atoms": atoms,
			"../atoms/workspace-navigation-atoms": navigationAtoms,
			"../atoms/host-plugin-atoms": { hostPluginPanelAtom: pluginAtom },
			"../utils/notice": { showNotice: () => undefined },
			"../i18n": { t: (key) => key },
		},
	});
	const rawActions = {
		projects: {
			select: (id) => {
				projectId = id;
				sessionId = undefined;
				calls.push(["select", id]);
			},
			add: async () => undefined,
		},
		sessions: {
			ensureCatalogsLoaded: (ids) => calls.push(["load", ...ids]),
			open: async (id, sid) => {
				projectId = id;
				sessionId = sid;
				calls.push(["open", id, sid]);
			},
			createDraft: async (id) => calls.push(["create", id]),
		},
	};
	const render = () => {
		cursor = 0;
		const result = useWorkspaceNavigation(rawActions, projectId, sessionId, prepareProjectSelection);
		effects.splice(0).forEach((effect) => effect());
		return result;
	};
	const ready = (id, records) => {
		update(atoms.sessionCatalogLoadStateAtom, (current) => ({ ...current, [id]: { status: "ready" } }));
		update(atoms.sessionRecordsAtom, (current) => ({ ...current, ...Object.fromEntries(records.map((record) => [record.id, record])) }));
	};
	return { render, ready, calls };
}
const session = (id, projectId, updatedAt) => ({ id, projectId, title: id, preview: "", messageCount: 0, status: "active", source: "pi", environment: "native", createdAt: updatedAt, updatedAt });

test("late catalogs cannot restore a previously selected workspace", async () => {
	const h = harness();
	h.render().actions.projects.select("alpha");
	h.render().actions.projects.select("beta");
	h.ready("alpha", [session("alpha-session", "alpha", 1)]);
	h.render();
	assert.equal(h.calls.filter(([action]) => action === "open").length, 0);
	h.ready("beta", [session("beta-session", "beta", 2)]);
	h.render();
	assert.deepEqual(
		h.calls.filter(([action]) => action === "open"),
		[["open", "beta", "beta-session"]],
	);
});

test("cancelled workspace switch preserves the selected session and navigation page", async () => {
	let allowed = true;
	const h = harness(async () => allowed);
	await h.render().actions.sessions.open("alpha", "existing");
	h.render().home();
	allowed = false;
	assert.equal(await h.render().actions.projects.select("beta"), false);
	assert.equal(h.render().page, "home");
	assert.deepEqual(h.calls, [["open", "alpha", "existing"]]);
});

test("cancelling independent chat does not expand its session list", async () => {
	const h = harness(async () => false);
	h.render().chat("builtin-chat");
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(h.render().lists.sessions, false);
	assert.equal(h.render().page, "home");
	assert.deepEqual(h.calls, []);
});

test("a rejected duplicate click cannot invalidate an accepted pending switch", async () => {
	let resolve;
	let pending = false;
	const h = harness(() => {
		if (pending) return Promise.resolve(false);
		pending = true;
		return new Promise((answer) => {
			resolve = answer;
		});
	});
	const first = h.render().actions.projects.select("alpha");
	assert.equal(await h.render().actions.projects.select("beta"), false);
	resolve(true);
	assert.equal(await first, true);
	assert.deepEqual(h.calls, [
		["select", "alpha"],
		["load", "alpha"],
	]);
});
test("returning home cancels pending restoration without clearing the selected session or creating one", () => {
	const h = harness();
	h.render().actions.projects.select("alpha");
	h.render().home();
	h.ready("alpha", [session("history", "alpha", 1)]);
	const navigation = h.render();
	assert.equal(navigation.page, "home");
	assert.equal(h.calls.filter(([action]) => action === "open" || action === "create").length, 0);
	assert.equal(h.calls.filter(([action]) => action === "select").length, 1);
});
test("independent chat selects its workspace without automatically opening a session picker", () => {
	const h = harness();
	h.render().chat("builtin-chat");
	const navigation = h.render();
	assert.equal(navigation.page, "workspace");
	assert.equal(navigation.lists.sessions, false);
	assert.deepEqual(h.calls, [
		["select", "builtin-chat"],
		["load", "builtin-chat"],
	]);
});
test("switching back restores the remembered stable session and empty workspaces stay empty", async () => {
	const h = harness();
	h.ready("alpha", [session("older", "alpha", 1), session("newest", "alpha", 2)]);
	await h.render().actions.sessions.open("alpha", "older");
	h.render();
	h.render().actions.projects.select("beta");
	h.ready("beta", []);
	h.render();
	assert.equal(h.calls.filter(([action]) => action === "create").length, 0);
	h.render().actions.projects.select("alpha");
	h.render();
	assert.deepEqual(h.calls.filter(([action]) => action === "open").at(-1), ["open", "alpha", "older"]);
});

test("new-session welcome clears the selection even inside the same workspace", async () => {
	const h = harness();
	await h.render().actions.sessions.open("alpha", "existing");
	h.render().welcome("alpha");
	assert.equal(h.render().page, "workspace");
	assert.deepEqual(h.calls.at(-1), ["select", "alpha"]);
	assert.equal(h.calls.filter(([action]) => action === "create").length, 0);
});

test("selecting the current workspace from home restores history when no session is selected", () => {
	const h = harness();
	h.render().welcome("alpha");
	h.ready("alpha", [session("history", "alpha", 1)]);
	h.render().home();
	h.render().actions.projects.select("alpha");
	h.render();
	assert.deepEqual(h.calls.filter(([action]) => action === "open").at(-1), ["open", "alpha", "history"]);
});
