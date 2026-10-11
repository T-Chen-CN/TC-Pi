import assert from "node:assert/strict";
import test from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

/** 调度公开 hook 的布局阶段，模拟容器测量与配对清理，不启动 Electron。 */
function harness() {
	let cursor = 0;
	let dirty = false;
	let layout = { list: 15, files: 50, conversation: 35, drawer: 0 };
	const slots = [];
	const pending = [];
	const layouts = [];
	const observers = [];
	class Element {
		constructor(width, separator = false) {
			this.offsetWidth = width;
			this.separator = separator;
		}
		hasAttribute(name) {
			return name === "data-separator" && this.separator;
		}
	}
	const element = { clientWidth: 1606, children: [new Element(350), new Element(6, true), new Element(650), new Element(0, true), new Element(600), new Element(0, true), new Element(0)] };
	const react = {
		useState(initial) {
			const index = cursor++;
			slots[index] ??= { value: initial };
			return [
				slots[index].value,
				(value) => {
					if (slots[index].value !== value) {
						slots[index].value = value;
						dirty = true;
					}
				},
			];
		},
		useCallback: (callback) => callback,
		useMemo: (callback) => callback(),
		useLayoutEffect(callback, deps) {
			const index = cursor++;
			const previous = slots[index];
			if (!previous || deps.some((dep, offset) => dep !== previous.deps[offset]))
				pending.push(() => {
					previous?.cleanup?.();
					slots[index] = { deps, cleanup: callback() };
				});
		},
	};
	const load = createTsSandbox({
		stubs: { react, "./useResize": { LIST_WIDTH_MIN: 208 }, "./useConversationPanel": { CONVERSATION_WIDTH_MIN: 320 }, "./useWorkspacePanels": { DRAWER_WIDTH_MIN: 240, DRAWER_WIDTH_MIN_PINNED: 260 } },
		globals: {
			HTMLElement: Element,
			ResizeObserver: class {
				constructor(callback) {
					this.callback = callback;
					this.disconnected = false;
					observers.push(this);
				}
				observe(target) {
					this.target = target;
				}
				disconnect() {
					this.disconnected = true;
				}
			},
		},
	});
	const { useWorkbenchPanelLayout } = load("src/renderer/src/hooks/useWorkbenchPanelLayout.ts");
	const options = {
		groupRef: {
			current: {
				getLayout: () => layout,
				setLayout: (next) => {
					layout = { ...next };
					layouts.push(layout);
				},
			},
		},
		elementRef: { current: element },
		enabled: true,
		listWidth: 350,
		listCollapsed: false,
		conversationWidth: 580,
		drawerWidth: 400,
		drawerOpen: false,
		drawerPinned: false,
	};
	return {
		options,
		element,
		layouts,
		observers,
		render(patch = {}) {
			Object.assign(options, patch);
			let result;
			do {
				dirty = false;
				cursor = 0;
				result = useWorkbenchPanelLayout(options);
				while (pending.length) pending.shift()();
			} while (dirty);
			return result;
		},
		unmount() {
			for (const slot of slots) slot?.cleanup?.();
		},
	};
}

test("tool opening updates all four panels once in the layout phase and protects sidebar widths", () => {
	const state = harness();
	state.render();
	const before = state.layouts.length;
	state.render({ drawerOpen: true });
	assert.equal(state.layouts.length, before + 1);
	const layout = state.layouts.at(-1);
	assert.equal(Math.round(layout.list * 16), 350);
	assert.equal(Math.round(layout.conversation * 16), 580);
	assert.equal(Math.round(layout.drawer * 16), 400);
});

test("window measurement reserves hard floors without replacing saved preferences", () => {
	const state = harness();
	state.render({ drawerOpen: true, drawerLayoutWidth: 400 });
	state.element.clientWidth = 1406;
	state.observers.at(-1).callback();
	const result = state.render();
	const layout = state.layouts.at(-1);
	assert.equal(Math.round(layout.list * 14), 350);
	assert.equal(Math.round(layout.conversation * 14), 450);
	assert.equal(Math.round(layout.drawer * 14), 400);
	assert.equal(result.fileMinSize, 200);
	assert.equal(state.options.drawerWidth, 400);
});

test("measurement observers are replaced on visibility changes and disconnected on unmount", () => {
	const state = harness();
	state.render();
	const original = state.observers[0];
	state.render({ drawerOpen: true });
	assert.equal(original.disconnected, true);
	assert.equal(state.observers.at(-1).target, state.element);
	state.unmount();
	assert.equal(
		state.observers.every((observer) => observer.disconnected),
		true,
	);
});

test("compact shells do not register workbench observers or mutate layouts", () => {
	const state = harness();
	state.render({ enabled: false });
	assert.equal(state.observers.length, 0);
	assert.equal(state.layouts.length, 0);
});
