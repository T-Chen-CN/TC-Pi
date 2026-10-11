import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const drawerSurface = readFileSync("src/renderer/src/components/workspace/DrawerSurface.tsx", "utf8");
const drawerPorts = readFileSync("src/renderer/src/hooks/useDrawerPorts.ts", "utf8");
const fileEditorHook = readFileSync("src/renderer/src/hooks/useFileEditor.ts", "utf8");
const zhCN = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const enUS = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("drawer rail no longer exposes the editor as a panel entry", () => {
	// 编辑器阅读面已迁分屏（SessionTabsBar + WorkbenchContent），右侧抽屉不再有 editor 面板
	assert.doesNotMatch(app, /id:\s*"editor"/);
	assert.doesNotMatch(app, /active:\s*drawer === "editor"/);
	assert.doesNotMatch(app, /handleToolDrawerAction\("editor"\)/);
});

test("drawer surface and ports no longer carry the editor panel", () => {
	assert.doesNotMatch(drawerSurface, /drawer === "editor"/);
	assert.doesNotMatch(drawerSurface, /DrawerEditorPort/);
	assert.doesNotMatch(drawerSurface, /t\("editor\.emptyTitle"\)/);
	assert.doesNotMatch(drawerPorts, /DrawerEditorPort/);
	assert.doesNotMatch(drawerPorts, /input\.editorMode/);
});

test("closing a file uses its save barrier without changing conversation or tools", () => {
	assert.match(fileEditorHook, /workspaceEditors\s*\.closeTab\(tabId\)/);
	const state = readFileSync("src/renderer/src/hooks/useWorkspaceEditorState.ts", "utf8");
	assert.match(state, /await guard\(\)/);
	assert.match(state, /tabs\.filter\(\(tab\) => tab\.id !== id\)/);
	assert.doesNotMatch(state, /setDrawer|selectSession/);
});

test("editor drawer empty-state copy is removed from both locales", () => {
	for (const key of ['"editor.fileEditor"', '"editor.emptyTitle"', '"editor.emptyHint"', '"editor.emptyOpenFiles"']) {
		assert.ok(!zhCN.includes(key), `zh-CN should not keep ${key}`);
		assert.ok(!enUS.includes(key), `en-US should not keep ${key}`);
	}
});
