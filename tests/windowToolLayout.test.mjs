import assert from "node:assert/strict";
import test from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

/** Run the public workspace hook through project changes, including effect-driven restores. */
function harness(initial = {}, git, customStorage) {
	const storage = new Map(Object.entries(initial));
	const slots = [];
	const effects = [];
	let cursor = 0;
	let dirty = false;
	let hook;
	let projectId = null;
	const memo = (fn, deps) => {
		const index = cursor++;
		const old = slots[index];
		if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { value: fn(), deps };
		return slots[index].value;
	};
	const react = {
		useRef: (value) => {
			const index = cursor++;
			slots[index] ??= { current: value };
			return slots[index];
		},
		useState: (initialValue) => {
			const index = cursor++;
			slots[index] ??= { value: typeof initialValue === "function" ? initialValue() : initialValue };
			return [
				slots[index].value,
				(next) => {
					const value = typeof next === "function" ? next(slots[index].value) : next;
					if (!Object.is(value, slots[index].value)) {
						slots[index].value = value;
						dirty = true;
					}
				},
			];
		},
		useCallback: (fn, deps) => memo(() => fn, deps),
		useMemo: memo,
		useEffect: (fn, deps) => {
			const index = cursor++;
			const old = slots[index];
			if (!old || deps.some((value, i) => value !== old.deps[i]))
				effects.push(() => {
					old?.cleanup?.();
					slots[index] = { deps, cleanup: fn() };
				});
		},
	};
	const load = createTsSandbox({ stubs: { react, "./usePersistedPanelWidth": { usePersistedPanelWidth() {} } } });
	const { useWorkspacePanels } = load("src/renderer/src/hooks/useWorkspacePanels.ts");
	const options = { storage: customStorage ?? { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, git };
	return {
		storage,
		render(nextProjectId = projectId) {
			projectId = nextProjectId;
			let rounds = 0;
			do {
				if (++rounds > 20) throw new Error("hook did not settle");
				cursor = 0;
				dirty = false;
				hook = useWorkspacePanels({ ...options, projectId });
				while (effects.length) effects.shift()();
			} while (dirty);
			return hook;
		},
		get current() {
			return hook;
		},
	};
}

const legacy = (panel, drawerPinned = false) => JSON.stringify({ panel, pinnedPanels: ["files", "git", "browser"], drawerPinned });

test("open tools and their width survive first and repeated workspace visits", () => {
	const h = harness({ "pid:project-drawer:b": legacy(null), "pid:drawer-width": "470" });
	h.render("a").openDrawer("git");
	h.render();
	for (const project of ["b", "a", "b", null, "a"]) {
		const state = h.render(project);
		assert.equal(state.drawer, "git");
		assert.equal(state.drawerCollapsed, false);
		assert.equal(state.drawerWidth, 470);
	}
});

test("closed tools do not open from another workspace's historical cache", () => {
	const h = harness({ "pid:project-drawer:b": legacy("browser", true) });
	for (const project of ["a", "b", "a", "b", null]) assert.equal(h.render(project).drawer, null);
});

test("collapsed tools stay collapsed across workspace switches", () => {
	const h = harness();
	h.render("a").openDrawer("git");
	h.render().collapseDrawer();
	h.render();
	assert.equal(h.render("b").drawer, "git");
	assert.equal(h.current.drawerCollapsed, true);
});

test("tool pin and tab arrangement belong to the window including independent chat", () => {
	const h = harness();
	h.render("a").toggleDrawerPanelPinned("browser");
	h.render().openDrawer("browser");
	h.render().toggleDrawerPinned();
	const before = h.render();
	for (const project of ["b", null, "a"]) {
		const state = h.render(project);
		assert.equal(state.drawer, "browser");
		assert.equal(state.drawerPinned, true);
		assert.deepEqual([...state.pinnedPanels], [...before.pinnedPanels]);
		state.closeDrawer();
		assert.equal(h.render().drawer, "browser");
	}
});

test("browser fullscreen survives a workspace change", () => {
	const h = harness();
	h.render("a").openBrowser();
	h.render().enterBrowserFullscreen();
	h.render();
	assert.equal(h.render("b").browserFullscreen, true);
	assert.equal(h.current.drawer, "browser");
});

test("workspace change invalidates old agent logs without closing their tool area", () => {
	const h = harness();
	h.render("a").openRpcLogPanel("agent-a");
	assert.equal(h.render().rpcLogAgentId, "agent-a");
	assert.equal(h.render("b").drawer, "rpcLog");
	assert.equal(h.current.rpcLogAgentId, undefined);
	assert.equal(h.current.drawerCollapsed, false);
	assert.equal(h.render("a").rpcLogAgentId, undefined);
});

test("tool tabs persist globally while a new window starts closed and unpinned", () => {
	const h = harness();
	h.render("a").toggleDrawerPanelPinned("browser");
	h.render().openDrawer("browser");
	h.render().toggleDrawerPinned();
	h.render();
	const restarted = harness(Object.fromEntries(h.storage));
	const state = restarted.render("b");
	assert.equal(state.drawer, null);
	assert.equal(state.drawerPinned, false);
	assert.ok(state.pinnedPanels.includes("browser"));
});

test("legacy tab migration happens once and never imports workspace open or pin flags", () => {
	const h = harness({ "pid:project-drawer:a": legacy("browser", true), "pid:project-drawer:b": JSON.stringify({ panel: "git", pinnedPanels: ["files", "git"] }) });
	const first = h.render("a");
	assert.equal(first.drawer, null);
	assert.equal(first.drawerPinned, false);
	assert.ok(first.pinnedPanels.includes("browser"));
	assert.deepEqual([...h.render("b").pinnedPanels], [...first.pinnedPanels]);
	assert.equal(h.storage.get("pid:project-drawer:a"), legacy("browser", true));
});

test("manual tab changes before workspace hydration take precedence over legacy caches", () => {
	const h = harness({ "pid:project-drawer:a": legacy("browser", true) });
	h.render().toggleDrawerPanelPinned("scratchPad");
	h.render().openDrawer("git");
	const state = h.render("a");
	assert.ok(state.pinnedPanels.includes("scratchPad"));
	assert.equal(state.pinnedPanels.includes("browser"), false);
	assert.equal(state.drawer, "git");
});

test("first workspace selection cannot replace the window's existing tool tabs", () => {
	const h = harness({ "pid:project-drawer:a": legacy("browser", true) });
	h.render().openDrawer("git");
	const before = h.render();
	const state = h.render("a");
	assert.deepEqual([...state.pinnedPanels], [...before.pinnedPanels]);
	assert.equal(state.drawer, "git");
});

test("global tab cache filters transient panels and never opens or pins a new window", () => {
	const h = harness({ "pid:window-tool-layout": JSON.stringify({ panel: "browser", drawerPinned: true, pinnedPanels: ["git", "browser", "rpcLog", "unknown", "git"] }), "pid:project-drawer:a": legacy(null) });
	const state = h.render("a");
	assert.deepEqual([...state.pinnedPanels], ["git", "browser"]);
	assert.equal(state.drawer, null);
	assert.equal(state.drawerPinned, false);
});

test("corrupt layout caches fall back to usable default tools", () => {
	const h = harness({ "pid:window-tool-layout": "{broken", "pid:project-drawer:a": "[]" });
	assert.deepEqual([...h.render("a").pinnedPanels], ["files", "git"]);
	h.current.openDrawer("git");
	assert.equal(h.render().drawer, "git");
});

test("old single-panel editor pin migrates only its tab preference", () => {
	const h = harness({ "pid:project-drawer:a": JSON.stringify({ panel: "editor", pinned: true }) });
	const state = h.render("a");
	assert.deepEqual([...state.pinnedPanels], ["files"]);
	assert.equal(state.drawer, null);
	assert.equal(state.drawerPinned, false);
});

test("unavailable storage never blocks tool controls or workspace switches", () => {
	const h = harness({}, undefined, {
		getItem() {
			throw new Error("blocked");
		},
		setItem() {
			throw new Error("blocked");
		},
	});
	h.render("a").toggleDrawerPanelPinned("browser");
	h.render().openDrawer("browser");
	h.render().toggleDrawerPinned();
	assert.equal(h.render("b").drawer, "browser");
	assert.equal(h.current.drawerPinned, true);
});

test("late Git content cannot reopen or replace tools after switching workspace", async () => {
	let resolve;
	const pending = new Promise((done) => {
		resolve = done;
	});
	const h = harness({}, { workspaceFileDiff: () => pending });
	h.render("a").openDrawer("browser");
	const request = h.render().openWorkspaceFileDiff("workingTree", "file.ts");
	h.render("b");
	resolve({ path: "file.ts", originalContent: "old", modifiedContent: "new" });
	assert.equal(await request, null);
	assert.equal(h.render().drawer, "browser");
	assert.equal(h.current.gitDiff, null);
});
