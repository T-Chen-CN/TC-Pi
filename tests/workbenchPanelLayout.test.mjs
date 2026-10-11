import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { planWorkbenchPanelWidths, applyWorkbenchPanelWidths } = loadTsCommonJs("src/renderer/src/lib/workbenchPanelLayout.ts");

/** 完整偏好工厂，每个测试只覆盖本次行为相关的字段。 */
function preferences(patch = {}) {
	return { list: 350, conversation: 580, drawer: 400, listCollapsed: false, drawerOpen: false, listMinimum: 208, conversationMinimum: 320, drawerMinimum: 240, ...patch };
}

test("opening and closing tools move exactly their width between tools and documents", () => {
	const closed = planWorkbenchPanelWidths(1800, preferences());
	const opened = planWorkbenchPanelWidths(1800, preferences({ drawerOpen: true }));
	assert.equal(opened.list, closed.list);
	assert.equal(opened.conversation, closed.conversation);
	assert.equal(opened.drawer, 400);
	assert.equal(closed.files - opened.files, opened.drawer);
	assert.equal(closed.drawer, 0);
});

test("limited space holds documents at their floor before squeezing conversation", () => {
	const opened = planWorkbenchPanelWidths(1480, preferences({ drawerOpen: true }));
	assert.equal(opened.list, 350);
	assert.equal(opened.conversation, 530);
	assert.equal(opened.drawer, 400);
	assert.equal(opened.files, 200);
});

test("opening tools limits their saved width before borrowing any conversation surplus", () => {
	const opened = planWorkbenchPanelWidths(1480, preferences({ drawerOpen: true, preserveConversation: true }));
	assert.equal(opened.list, 350);
	assert.equal(opened.conversation, 580);
	assert.equal(opened.drawer, 350);
	assert.equal(opened.files, 200);
});

test("a narrow budget caps tools at the joint document and conversation floors", () => {
	const closed = planWorkbenchPanelWidths(1130, preferences());
	const opened = planWorkbenchPanelWidths(1130, preferences({ drawerOpen: true }));
	assert.equal(opened.list, closed.list);
	assert.equal(opened.conversation, 320);
	assert.equal(opened.drawer, 260);
	assert.equal(opened.drawerMinSize, 240);
	assert.equal(opened.fileMinSize, 200);
	assert.equal(opened.files, 200);
});

test("infeasible window budgets defer layout without violating floors or mutating preferences", () => {
	const saved = preferences();
	const closed = planWorkbenchPanelWidths(1000, saved);
	const opened = planWorkbenchPanelWidths(1000, { ...saved, drawerOpen: true });
	assert.equal(closed.list, 350);
	assert.equal(closed.conversation, 450);
	assert.equal(opened, null);
	assert.deepEqual(saved, preferences());
});

test("collapsed lists remain at zero while opening pinned tools", () => {
	const opened = planWorkbenchPanelWidths(1200, preferences({ listCollapsed: true, drawerOpen: true, drawerMinimum: 260 }));
	assert.equal(opened.list, 0);
	assert.equal(opened.conversation, 580);
	assert.equal(opened.drawer, 400);
	assert.equal(opened.drawerMinSize, 260);
});

test("atomic percentage layout preserves key order and leaves the previous layout intact", () => {
	const layout = { list: 15, files: 50, conversation: 35, drawer: 0 };
	const restored = applyWorkbenchPanelWidths(layout, 1800, planWorkbenchPanelWidths(1800, preferences({ list: 270, conversation: 420 })));
	assert.deepEqual(Object.keys(restored), Object.keys(layout));
	assert.equal(restored.list, 15);
	assert.equal(restored.drawer, 0);
	assert.equal(restored.conversation * 18, 420);
	assert.equal(restored.files + restored.conversation, 85);
	assert.deepEqual(layout, { list: 15, files: 50, conversation: 35, drawer: 0 });
});

test("unmeasurable panel groups defer layout instead of producing invalid percentages", () => {
	for (const value of [0, -1, Infinity, NaN]) assert.equal(planWorkbenchPanelWidths(value, preferences()), null);
});
