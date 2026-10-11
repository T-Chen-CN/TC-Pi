import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadTsModule(path, fileName, requireStub) {
	const output = ts.transpileModule(readFileSync(path, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		fileName,
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		output,
		{
			module,
			exports: module.exports,
			JSON,
			Object,
			Set,
			Map,
			require: requireStub,
		},
		{ filename: fileName },
	);
	return module.exports;
}

function loadExpandedProjectsModule() {
	return loadTsModule("src/renderer/src/utils/sidebarExpandedProjects.ts", "sidebarExpandedProjects.ts", (specifier) => {
		throw new Error(`Unexpected import: ${specifier}`);
	});
}

function loadPillsModule() {
	return loadTsModule("src/renderer/src/sessionFilterPills.ts", "sessionFilterPills.ts", (specifier) => {
		throw new Error(`Unexpected import: ${specifier}`);
	});
}

function loadSharedSessionSortModule() {
	return loadTsModule("src/shared/sessionSort.ts", "sessionSort.ts", (specifier) => {
		throw new Error(`Unexpected import: ${specifier}`);
	});
}

test("sidebar expansion migration waits for authoritative settings before pruning projects", () => {
	const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
	assert.match(controller, /if \(projects\.length === 0 \|\| !options\.settingsLoaded\) return;/);
	assert.match(controller, /commitExpandedProjectIds\(pruned\)/);
});

test("Sidebar leaf remains independent from App and keeps RPC logging query local", () => {
	const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
	const content = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
	assert.doesNotMatch(controller, /App\.tsx/);
	assert.doesNotMatch(content, /from "\.\.\/\.\.\/App"/);
	assert.match(controller, /getRpcLogging/);
	assert.match(controller, /setAgentRpcLoggingById/);
	// 日志面板迁到右侧抽屉：侧栏只留打开命令，不再挂查看器组件
	assert.doesNotMatch(content, /RpcLogViewer/);
	assert.match(content, /SessionManagerModal/);
	assert.match(content, /WorktreeCreateDialog/);
});

test("workspace selection follows independent chat on the left and sessions stay on the right", () => {
	const navigation = readFileSync("src/renderer/src/components/sidebar/WorkspaceNavigation.tsx", "utf8");
	const projectNavigation = readFileSync("src/renderer/src/components/sidebar/WorkspaceProjectNavigation.tsx", "utf8");
	const globalNavigation = readFileSync("src/renderer/src/components/sidebar/SidebarNavigation.tsx", "utf8");
	assert.match(globalNavigation, /onClick=\{props\.navigation\.home\}/);
	assert.match(globalNavigation, /props\.navigation\.chat\(chat\.id\)/);
	assert.match(readFileSync("src/renderer/src/components/sidebar/AppSidebar.tsx", "utf8"), /<SidebarNavigation\s+controller=\{controller\}/);
	assert.doesNotMatch(navigation, /workspace\.independentChat|workspace\.home/);
	assert.doesNotMatch(navigation, /WorkspaceProjectList|workspace\.select|workspace\.add/);
	assert.match(readFileSync("src/renderer/src/components/sidebar/AppSidebar.tsx", "utf8"), /<SidebarNavigation\b[^>]*>\s*<WorkspaceProjectNavigation\b[\s\S]*?<\/SidebarNavigation>/);
	assert.ok(globalNavigation.indexOf("{props.children}") > globalNavigation.indexOf('t("workspace.independentChat")'));
	const content = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
	for (const key of ["workspace.add", "workspace.select"]) assert.match(projectNavigation, new RegExp(`t\\("${key.replaceAll(".", "\\.")}"\\)`));
	assert.match(navigation, /t\("workspace\.sessions"\)/);
	assert.match(readFileSync("src/renderer/src/components/sidebar/WorkspaceProjectList.tsx", "utf8"), /id="workspace-inline-list"/);
	assert.match(readFileSync("src/renderer/src/components/sidebar/WorkspaceSessionList.tsx", "utf8"), /id="workspace-session-list"/);
	assert.match(readFileSync("src/renderer/src/hooks/useWorkspaceSessionPicker.ts", "utf8"), /current\.actions\.ensureCatalogsLoaded\(\[current\.projectId\]\)/);
	assert.doesNotMatch(content, /<Tabs(?:List|Trigger)?\s/);
	assert.match(navigation, /<Popover\s+open=\{picker\.open\}/);
	assert.doesNotMatch(navigation, /<Dialog|<DropdownMenu/);
	assert.doesNotMatch(projectNavigation, /<Dialog|<DropdownMenu|<Popover/);
});

test("inline lists stay bounded and do not squeeze file tree rows", () => {
	const navigation = readFileSync("src/renderer/src/components/sidebar/WorkspaceNavigation.tsx", "utf8");
	const explorer = readFileSync("src/renderer/src/components/sidebar/WorkspaceFileExplorer.tsx", "utf8");
	const projects = readFileSync("src/renderer/src/components/sidebar/WorkspaceProjectList.tsx", "utf8");
	const sessions = readFileSync("src/renderer/src/components/sidebar/WorkspaceSessionList.tsx", "utf8");
	assert.match(projects, /max-h-\[22vh\]\s+shrink-0/);
	assert.match(navigation, /max-h-\[min\(60vh,var\(--radix-popover-content-available-height\)\)\]/);
	assert.match(sessions, /min-h-0\s+flex-1[^"]*overflow-y-auto/);
	assert.match(projects, /group\s+relative\s+flex\s+shrink-0\s+items-center/);
	assert.match(sessions, /className="shrink-0"\s+data-testid="workspace-session-row"/);
	// 展开时填满余量，收起时只占按钮高度；内容仍挂载以保留文件树状态。
	assert.match(explorer, /cn\(\s*"flex\s+min-h-0\s+flex-col\s+overflow-hidden"\s*,\s*expanded\s*\?\s*"flex-1"\s*:\s*"shrink-0"\s*\)/);
	assert.match(explorer, /hidden=\{!expanded\}\s+className=\{cn\(\s*"min-h-0\s+flex-1\s+flex-col\s+overflow-hidden"/);
	assert.match(explorer, /<FilesPanel\s+key=\{project\.id\}\s+projectId=\{project\.id\}/);
});
