import assert from "node:assert/strict";
import test from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

/** Exercise public event handlers, pointer ownership and preference callbacks with real policy. */
function harness() {
	let cursor = 0;
	let dirty = false;
	let pixels = { list: 300, files: 350, conversation: 440, drawer: 240 };
	const slots = [];
	const pendingEffects = [];
	const commits = [];
	const captures = new Set();
	const capture = { focus() {}, setAttribute() {}, setPointerCapture: (id) => captures.add(id), hasPointerCapture: (id) => captures.has(id), releasePointerCapture: (id) => captures.delete(id) };
	const react = {
		useRef(value) {
			const index = cursor++;
			slots[index] ??= { current: value };
			return slots[index];
		},
		useState(value) {
			const index = cursor++;
			slots[index] ??= { value };
			return [
				slots[index].value,
				(next) => {
					if (slots[index].value !== next) {
						slots[index].value = next;
						dirty = true;
					}
				},
			];
		},
		useCallback(fn, deps) {
			const index = cursor++;
			const old = slots[index];
			if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { deps, value: fn };
			return slots[index].value;
		},
		useLayoutEffect(fn, deps) {
			const index = cursor++;
			const old = slots[index];
			if (!old || deps.some((value, i) => value !== old.deps[i]))
				pendingEffects.push(() => {
					old?.cleanup?.();
					slots[index] = { deps, cleanup: fn() };
				});
		},
	};
	const load = createTsSandbox({ stubs: { react, "./useResize": { LIST_WIDTH_MIN: 208, LIST_WIDTH_MAX: 440 }, "./useConversationPanel": { CONVERSATION_WIDTH_MIN: 320, CONVERSATION_WIDTH_MAX: 800 }, "./useWorkspacePanels": { DRAWER_WIDTH_MIN: 240, DRAWER_WIDTH_MIN_PINNED: 260, DRAWER_WIDTH_MAX: 560 } } });
	const { useWorkbenchPanelResize } = load("src/renderer/src/hooks/useWorkbenchPanelResize.ts");
	const options = {
		groupRef: {
			current: {
				getLayout: () => Object.fromEntries(Object.entries(pixels).map(([id, size]) => [id, size / 13.3])),
				setLayout: (layout) => {
					pixels = Object.fromEntries(Object.entries(layout).map(([id, size]) => [id, size * 13.3]));
					return layout;
				},
			},
		},
		elementRef: { current: { children: Object.keys(pixels).map((id) => ({ hasAttribute: (attr) => attr === "data-panel", getBoundingClientRect: () => ({ width: pixels[id] }) })) } },
		enabled: true,
		listCollapsed: false,
		drawerOpen: true,
		drawerPinned: false,
		conversationWidth: 440,
		setListWidth: (value) => commits.push(["list", value]),
		setDrawerWidth: (value) => commits.push(["drawer", value]),
		saveConversationWidth: (value) => commits.push(["conversation", value]),
	};
	let hook;
	return {
		commits,
		captures,
		options,
		widths: () => pixels,
		render(patch = {}) {
			Object.assign(options, patch);
			do {
				dirty = false;
				cursor = 0;
				hook = useWorkbenchPanelResize(options);
				while (pendingEffects.length) pendingEffects.shift()();
			} while (dirty);
			return hook;
		},
		event(x = 900, id = 1) {
			return { pointerId: id, button: 0, clientX: x, currentTarget: capture, preventDefault() {} };
		},
		handlers: (target) => hook.getHandleProps(target),
		unmount() {
			for (const slot of slots) slot?.cleanup?.();
		},
	};
}

test("tool gesture only saves tool preference after pointer release", () => {
	const h = harness();
	h.render();
	h.handlers("drawer").onPointerDown(h.event());
	h.render();
	h.handlers("drawer").onPointerMove(h.event(700));
	assert.ok(Math.abs(h.widths().list - 300) < 0.001);
	assert.ok(Math.abs(h.widths().files - 200) < 0.001);
	assert.ok(Math.abs(h.widths().conversation - 390) < 0.001);
	assert.deepEqual(h.commits, []);
	h.handlers("drawer").onPointerUp(h.event(700));
	h.render();
	assert.deepEqual(h.commits, [["drawer", 440]]);
	assert.equal(h.captures.size, 0);
});

test("unrelated pointer cannot move or finish the active gesture", () => {
	const h = harness();
	h.render();
	h.handlers("drawer").onPointerDown(h.event());
	h.render();
	h.handlers("drawer").onPointerMove(h.event(100, 2));
	h.handlers("drawer").onPointerUp(h.event(100, 2));
	h.handlers("drawer").onPointerCancel(h.event(100, 2));
	assert.ok(Math.abs(h.widths().drawer - 240) < 0.001);
	assert.equal(h.captures.size, 1);
	assert.deepEqual(h.commits, []);
});

test("cancel restores the initial layout without changing preferences", () => {
	const h = harness();
	h.render();
	h.handlers("drawer").onPointerDown(h.event());
	h.render();
	h.handlers("drawer").onPointerMove(h.event(100));
	h.handlers("drawer").onPointerCancel(h.event());
	h.render();
	assert.ok(Math.abs(h.widths().conversation - 440) < 0.001);
	assert.ok(Math.abs(h.widths().drawer - 240) < 0.001);
	assert.deepEqual(h.commits, []);
	assert.equal(h.captures.size, 0);
});

test("left gesture applies changed constraints in layout phase and only saves left preference", () => {
	const h = harness();
	h.render();
	h.handlers("list").onPointerDown(h.event());
	h.render();
	h.handlers("list").onPointerMove(h.event(960));
	assert.equal(h.widths().list, 300);
	assert.equal(h.render().listDragWidth, 360);
	assert.ok(Math.abs(h.widths().list - 360) < 0.001);
	h.handlers("list").onPointerUp(h.event(960));
	h.render();
	assert.deepEqual(h.commits, [["list", 360]]);
});

test("keyboard resizes only its target and closed handles cannot start gestures", () => {
	const h = harness();
	h.render();
	h.handlers("conversation").onKeyDown({ key: "ArrowLeft", shiftKey: false, preventDefault() {} });
	assert.deepEqual(h.commits, [["conversation", 450]]);
	h.render({ drawerOpen: false });
	h.handlers("drawer").onPointerDown(h.event());
	assert.equal(h.captures.size, 0);
});

test("unmount releases pointer capture and never writes a preference", () => {
	const h = harness();
	h.render();
	h.handlers("drawer").onPointerDown(h.event());
	h.render();
	h.unmount();
	assert.equal(h.captures.size, 0);
	assert.deepEqual(h.commits, []);
});
