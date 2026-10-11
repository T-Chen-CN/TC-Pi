import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 仅模拟 hook 调度；从公开 prepare/respond 入口验证确认、取消和异常。 */
function harness(run) {
	const slots = [];
	let cursor = 0;
	const effects = [];
	const calls = [];
	const notices = [];
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
	const { useWorkspaceSwitch } = loadTsCommonJs("src/renderer/src/hooks/useWorkspaceSwitch.ts", {
		stubs: {
			react,
			"../desktopApi": {
				desktopApi: {
					sessions: {
						switchWorkspace: async (input) => {
							calls.push({ ...input });
							return run(input);
						},
					},
				},
			},
			"../utils/notice": { showNotice: (text) => notices.push(text) },
			"../i18n": { t: (key) => key },
		},
	});
	return {
		render(projectId = "alpha") {
			cursor = 0;
			const result = useWorkspaceSwitch(projectId);
			effects.splice(0).forEach((fn) => fn());
			return result;
		},
		unmount() {
			slots.forEach((slot) => slot?.cleanup?.());
		},
		calls,
		notices,
	};
}
async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

test("idle workspace switches without a confirmation dialog", async () => {
	const h = harness(() => ({ status: "ready" }));
	assert.equal(await h.render().prepare("beta"), true);
	assert.equal(h.render("beta").busyCount, undefined);
	assert.deepEqual(h.calls, [{ fromProjectId: "alpha", toProjectId: "beta", terminateBusy: false }]);
});
test("busy switch cancellation keeps the source and sends no stop request", async () => {
	const h = harness(() => ({ status: "confirmation-required", busyCount: 2 }));
	const pending = h.render().prepare("beta");
	await settle();
	const dialog = h.render();
	assert.equal(dialog.busyCount, 2);
	dialog.respond(false);
	assert.equal(await pending, false);
	assert.equal(h.calls.length, 1);
	assert.equal(await h.render().prepare("alpha"), true);
	assert.equal(h.calls.length, 1);
});
test("confirmed busy switch explicitly authorizes termination", async () => {
	const h = harness((input) => (input.terminateBusy ? { status: "ready" } : { status: "confirmation-required", busyCount: 1 }));
	const pending = h.render().prepare("beta");
	await settle();
	h.render().respond(true);
	assert.equal(await pending, true);
	assert.equal(h.calls[1].terminateBusy, true);
	assert.equal(h.calls[1].fromProjectId, "alpha");
});
test("stop failure keeps selection at the source and presents an error", async () => {
	const h = harness(() => ({ status: "failed", error: "stop failed" }));
	assert.equal(await h.render().prepare("beta"), false);
	assert.equal(await h.render().prepare("alpha"), true);
	assert.equal(h.calls.length, 1);
	assert.deepEqual(h.notices, ["workspace.switchFailed"]);
});
test("a second switch is rejected while the first awaits confirmation", async () => {
	const h = harness(() => ({ status: "confirmation-required", busyCount: 1 }));
	const pending = h.render().prepare("beta");
	await settle();
	assert.equal(await h.render().prepare("chat"), false);
	assert.equal(h.calls.length, 1);
	h.render().respond(false);
	assert.equal(await pending, false);
});
test("unmount resolves a pending dialog as cancellation", async () => {
	const h = harness(() => ({ status: "confirmation-required", busyCount: 1 }));
	const pending = h.render().prepare("beta");
	await settle();
	h.unmount();
	assert.equal(await pending, false);
	assert.equal(h.calls.length, 1);
});
test("an IPC result arriving after unmount cannot open a new confirmation dialog", async () => {
	let release;
	const h = harness(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = h.render().prepare("beta");
	h.unmount();
	release({ status: "confirmation-required", busyCount: 1 });
	assert.equal(await pending, false);
	assert.equal(h.render().busyCount, undefined);
});
