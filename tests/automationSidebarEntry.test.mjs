import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");

test("search and automation occupy the middle two dock items below the file explorer", () => {
	const files = sidebar.indexOf("{props.workspaceFiles}");
	const dock = sidebar.indexOf("<Dock size={32}");
	const search = sidebar.indexOf('aria-label={t("app.searchSessions")}');
	const automation = sidebar.indexOf("<AutomationDockButton />");
	assert.ok(files < dock && dock < search && search < automation);
	assert.equal((sidebar.match(/aria-label=\{t\("app.searchSessions"\)\}/g) ?? []).length, 1);
	assert.equal((sidebar.match(/<AutomationDockButton\s*\/>/g) ?? []).length, 1);
	// The positioning anchor has no keyboard or accessibility entry; its portal remains interactive.
	assert.match(sidebar, /<div\s+aria-hidden="true"\s+inert\s+className="pointer-events-none fixed/);
});

test("automation uses an icon-only accessible button and styled tooltip", () => {
	const source = readFileSync("src/renderer/src/components/automation/AutomationDockButton.tsx", "utf8");
	assert.match(source, /<Button[\s\S]*?aria-label=\{label\}/);
	assert.match(source, /<ListTodo\b/);
	assert.match(source, /<TooltipContent[\s\S]*?\{label\}/);
	assert.doesNotMatch(source, /title=\{label\}|<span[^>]*>\{t\("automation.title"\)\}/);
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
