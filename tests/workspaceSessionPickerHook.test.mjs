import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 从浮层公开动作验证范围、生命周期与异步选择，不启动 Electron 或 pi。 */
function harness(run) {
	const slots = [];
	let cursor = 0;
	const effects = [];
	const calls = [];
	const react = {
		useRef(value) {
			return (slots[cursor++] ??= { current: value });
		},
		useState(value) {
			const index = cursor++;
			const state = (slots[index] ??= { value });
			return [
				state.value,
				(next) => {
					state.value = typeof next === "function" ? next(state.value) : next;
				},
			];
		},
		useCallback(fn) {
			return fn;
		},
		useEffect(fn, deps) {
			const index = cursor++;
			if (slots[index] && deps.every((value, i) => Object.is(value, slots[index].deps[i]))) return;
			effects.push(() => {
				slots[index]?.cleanup?.();
				slots[index] = { deps, cleanup: fn() };
			});
		},
	};
	const { useWorkspaceSessionPicker } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceSessionPicker.ts", { stubs: { react } });
	const actions = {
		ensureCatalogsLoaded: (ids) => calls.push(["load", ...ids]),
		open: async (...args) => {
			calls.push(["open", ...args]);
			return run(...args);
		},
	};
	return {
		render(projectId = "alpha") {
			cursor = 0;
			const result = useWorkspaceSessionPicker(projectId, actions);
			effects.splice(0).forEach((fn) => fn());
			return result;
		},
		unmount() {
			slots.forEach((slot) => slot?.cleanup?.());
		},
		calls,
	};
}

test("picker starts closed and lazily loads only the current workspace", () => {
	const h = harness(() => true);
	assert.equal(h.render().open, false);
	h.render().setOpen(true);
	assert.equal(h.render().open, true);
	assert.deepEqual(h.calls, [["load", "alpha"]]);
	h.render().setOpen(false);
	assert.equal(h.render().open, false);
});

test("workspace changes close the picker and returning does not reopen it", () => {
	const h = harness(() => true);
	h.render().setOpen(true);
	assert.equal(h.render("beta").open, false);
	assert.equal(h.render("alpha").open, false);
});

test("successful selection opens a permanent tab and closes the picker", async () => {
	const h = harness(() => true);
	h.render().setOpen(true);
	assert.equal(await h.render().select("alpha", "session-a"), true);
	assert.equal(h.render().open, false);
	assert.deepEqual(h.calls.at(-1), ["open", "alpha", "session-a", "permanent"]);
});

test("rejected or failed selections retain the picker", async () => {
	const h = harness(() => false);
	h.render().setOpen(true);
	assert.equal(await h.render().select("alpha", "session-a"), false);
	assert.equal(h.render().open, true);
	const failing = harness(() => {
		throw new Error("catalog unavailable");
	});
	failing.render().setOpen(true);
	await assert.rejects(failing.render().select("alpha", "session-a"), /catalog unavailable/);
	assert.equal(failing.render().open, true);
});

test("a foreign workspace row cannot change selection", async () => {
	const h = harness(() => true);
	h.render().setOpen(true);
	assert.equal(await h.render().select("beta", "session-b"), false);
	assert.deepEqual(h.calls, [["load", "alpha"]]);
	assert.equal(h.render().open, true);
});

test("a late selection cannot close a newly opened picker", async () => {
	let resolve;
	const h = harness(
		() =>
			new Promise((answer) => {
				resolve = answer;
			}),
	);
	h.render().setOpen(true);
	const selecting = h.render().select("alpha", "session-a");
	h.render().setOpen(false);
	h.render().setOpen(true);
	resolve(true);
	await selecting;
	assert.equal(h.render().open, true);
});

test("old workspace selection cannot close the destination picker", async () => {
	let resolve;
	const h = harness(
		() =>
			new Promise((answer) => {
				resolve = answer;
			}),
	);
	h.render().setOpen(true);
	const selecting = h.render().select("alpha", "session-a");
	h.render("beta").setOpen(true);
	resolve(true);
	await selecting;
	assert.equal(h.render("beta").open, true);
});

test("selection completed after unmount cannot mutate picker state", async () => {
	let resolve;
	const h = harness(
		() =>
			new Promise((answer) => {
				resolve = answer;
			}),
	);
	h.render().setOpen(true);
	const selecting = h.render().select("alpha", "session-a");
	h.unmount();
	resolve(true);
	await selecting;
	assert.equal(h.render().open, true);
});
