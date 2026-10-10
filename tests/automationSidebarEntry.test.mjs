import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 工作区布局：定时任务保留在文件树下面的次级入口、搜索之后。
const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");

test("automation entry stays visible below file navigation and search, before the dock", () => {
	assert.match(sidebar, /import \{ AutomationDockButton \} from "\.\.\/automation\/AutomationDockButton";/);
	const navigationIndex = sidebar.indexOf("<WorkspaceNavigation");
	const filesIndex = sidebar.indexOf("{props.workspaceFiles}");
	const searchIndex = sidebar.indexOf('aria-label={t("app.searchSessions")}');
	const automationIndex = sidebar.indexOf("<AutomationDockButton />");
	const dockIndex = sidebar.indexOf("<Dock size={32}");
	assert.ok(navigationIndex > -1 && filesIndex > navigationIndex, "workspace navigation must precede the file explorer");
	assert.ok(searchIndex > filesIndex, "secondary search must stay below the file explorer");
	assert.ok(automationIndex > searchIndex && automationIndex < dockIndex, "automation remains a direct secondary entry");
});

test("dock no longer hosts the automation entry", () => {
	const dockIndex = sidebar.indexOf("<Dock size={32}");
	assert.ok(dockIndex > -1, "dock section missing");
	assert.doesNotMatch(sidebar.slice(dockIndex), /AutomationDockButton/);
});

test("automation management is a modal, not a workbench-covering surface", () => {
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");
	const sessionActions = readFileSync("src/renderer/src/hooks/useSessionActions.ts", "utf8");

	// 定时任务以模态弹框呈现：App 挂 AutomationModal，不再有覆盖会话区的 utility surface
	assert.match(app, /<AutomationModal/);
	assert.doesNotMatch(app, /<AutomationWorkspace/);
	assert.doesNotMatch(app, /utility=\{\{\s*active:/);
	assert.doesNotMatch(app, /workspaceSurface/);
	// 会话选择回调已回归普通选中链路，不再需要 surface 让步钩子
	assert.doesNotMatch(sessionActions, /onWorkspaceSelection/);
});

test("automation dock button keeps active-run indicator and opens the modal", () => {
	const source = readFileSync("src/renderer/src/components/automation/AutomationDockButton.tsx", "utf8");
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");
	assert.match(source, /openAutomationModalAtom/);
	assert.doesNotMatch(source, /openAutomationWorkspaceAtom/);
	assert.doesNotMatch(source, /workspaceSurface/);
	assert.match(source, /automationActiveRunsAtom/);
	assert.match(source, /t\("automation\.title"\)/);
	assert.match(app, /<AutomationModal/);
	assert.doesNotMatch(app, /workspaceSurface\.isAutomationWorkspace/);
});
