import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const policy = loadTsCommonJs("src/renderer/src/lib/workbenchPanelLayout.ts");
const resizeWorkbenchPanels = (...args) => ({ ...policy.resizeWorkbenchPanels(...args) });
const initial = { list: 300, files: 350, conversation: 440, drawer: 240 };
const limits = { listMinimum: 208, listMaximum: 440, conversationMinimum: 320, conversationMaximum: 800, drawerMinimum: 240, drawerMaximum: 560, conversationPreferred: 440 };

test("tool expansion spends document surplus before touching conversation", () => {
	assert.deepEqual(resizeWorkbenchPanels(initial, "drawer", -60, limits), { ...initial, files: 290, drawer: 300 });
	assert.deepEqual(resizeWorkbenchPanels(initial, "drawer", -200, limits), { ...initial, files: 200, conversation: 390, drawer: 440 });
});

test("tool expansion stops at both floors without borrowing sidebar space", () => {
	assert.deepEqual(resizeWorkbenchPanels(initial, "drawer", -10000, limits), { list: 300, files: 200, conversation: 320, drawer: 510 });
});

test("tools respect their own maximum and the pinned minimum", () => {
	const wide = { ...initial, files: 600 };
	assert.deepEqual(resizeWorkbenchPanels(wide, "drawer", -10000, limits), { ...wide, files: 280, drawer: 560 });
	assert.deepEqual(resizeWorkbenchPanels({ ...initial, drawer: 260 }, "drawer", 10000, { ...limits, drawerMinimum: 260 }), { ...initial, drawer: 260 });
});

test("shrinking tools restores preferred conversation before growing documents", () => {
	const squeezed = { list: 300, files: 200, conversation: 320, drawer: 510 };
	assert.deepEqual(resizeWorkbenchPanels(squeezed, "drawer", 60, limits), { ...squeezed, conversation: 380, drawer: 450 });
	assert.deepEqual(resizeWorkbenchPanels(squeezed, "drawer", 270, limits), initial);
});

test("conversation separator exchanges only document and conversation space", () => {
	assert.deepEqual(resizeWorkbenchPanels(initial, "conversation", -10000, limits), { ...initial, files: 200, conversation: 590 });
	assert.deepEqual(resizeWorkbenchPanels(initial, "conversation", 10000, limits), { ...initial, files: 470, conversation: 320 });
});

test("only list separator can change list width and it consumes documents first", () => {
	assert.deepEqual(resizeWorkbenchPanels(initial, "list", 10000, limits), { ...initial, list: 440, files: 210 });
	const narrow = { ...initial, files: 210 };
	assert.deepEqual(resizeWorkbenchPanels(narrow, "list", 10000, limits), { ...narrow, list: 430, files: 200, conversation: 320 });
});

test("resize is based on the gesture snapshot, reversible and conserves the pixel budget", () => {
	for (const handle of ["list", "conversation", "drawer"]) {
		assert.deepEqual(resizeWorkbenchPanels(initial, handle, 0, limits), initial);
		for (const delta of [-10000, -0.25, 50, 10000]) {
			const next = resizeWorkbenchPanels(initial, handle, delta, limits);
			assert.equal(
				Object.values(next).reduce((a, b) => a + b),
				1330,
			);
			assert.ok(next.files >= 200 && next.conversation >= 320);
			if (handle !== "list") assert.equal(next.list, initial.list);
		}
	}
	assert.deepEqual(resizeWorkbenchPanels(initial, "drawer", NaN, limits), initial);
});
