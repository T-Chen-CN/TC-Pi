import { test, expect } from "./mock-pi-fixture";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Git 面板端到端（#113 3.4-14）：真实临时 git 仓库 + mock pi 环境，
 * 覆盖 状态(status) → 行内 diff → 暂存 → 提交 的完整链路，
 * 并在仓库侧用 git log 复核提交真实落盘。
 */

// 仓库路径避开 isEphemeralProjectPath 过滤名单（pideck-git-e2e 会被启动时清掉）
const repoDir = join(tmpdir(), "pideck-seed-git-repo");

function git(args: string) {
	return execSync(`git ${args}`, { cwd: repoDir, encoding: "utf8" }).trim();
}

// 仓库在模块加载时就绪（fixture 启动 app 前执行），用固定路径便于用例内直接变更文件
rmSync(repoDir, { recursive: true, force: true });
mkdirSync(repoDir, { recursive: true });
git("init -b main");
git("config user.email e2e@pideck.local");
git("config user.name pideck-e2e");
writeFileSync(join(repoDir, "a.txt"), "hello\n");
// 模拟 Agent 会在项目内生成会话；这些运行时产物不属于 Git 用例的待提交文件。
writeFileSync(join(repoDir, ".gitignore"), ".pi/\n");
git("add .");
git("commit -m init");
git("checkout -b feature/graph");
writeFileSync(join(repoDir, "feature.txt"), "branch\n");
git("add feature.txt");
git('commit -m "feature: graph branch"');
git("tag graph-v1");
git("checkout main");
writeFileSync(join(repoDir, "main.txt"), "main\n");
git("add main.txt");
git('commit -m "main: parallel change"');
git('merge --no-ff feature/graph -m "merge: graph branch"');

test.use({
	seedProjects: [{ id: "e2e-git-repo", name: "GitE2E", path: repoDir }],
});

test("git panel: status -> diff -> stage -> commit", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "GitE2E", exact: true }).click();
	await window.getByRole("button", { name: "选择会话", exact: true }).click();
	await window.getByTestId("workspace-session-list").getByRole("button", { name: "新建会话", exact: true }).click();
	await expect(window.locator(".composer .rich-input")).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });

	// 先展开抽屉（rail 只在抽屉打开期间渲染），再切到 Git tab
	await window.locator(".header-drawer-toggle").first().click();
	await expect(window.locator(".detail-drawer")).toHaveAttribute("data-open", "true", { timeout: 5000 });
	await expect(window.locator('[data-testid="drawer-rail-git"]')).toBeVisible();
	// GitPanel 新组件（bg-background）与旧 GitDrawerHost 都带 .git-panel class，
	// 用 .bg-background 精确定位新面板（detail-drawer git tab 渲染的是它）。
	const panel = window.locator(".git-panel.bg-background");
	await expect(panel).toBeVisible({ timeout: 15_000 });
	// 分支标签反映真实仓库状态
	await expect(panel.locator(".git-branch-label")).toHaveText("main", { timeout: 15_000 });
	const graph = panel.locator('[id$="-graph"]');
	await expect(graph.getByRole("button", { name: /merge: graph branch/ })).toBeVisible();
	await expect(graph.locator('[data-ref-kind="branch"]', { hasText: "feature/graph" })).toBeVisible();
	await expect(graph.locator('[data-ref-kind="tag"]', { hasText: "graph-v1" })).toBeVisible();
	await expect(graph.locator(".git-graph-hash").first()).toHaveText(git("rev-parse --short=7 HEAD"));
	// Clicking a commit exposes its real changed files and the existing read-only diff viewer.
	await graph.getByRole("button", { name: /feature: graph branch/ }).click();
	await expect(graph.getByRole("button", { name: /查看 feature.txt 的提交差异/ })).toBeVisible();

	// 制造一处工作区改动并刷新状态
	appendFileSync(join(repoDir, "a.txt"), "changed by e2e\n");
	// 刷新按钮在 changes 面板 PaneHeader 的 changeToolbar 里（aria-label="刷新"），
	// 旧的 #git-pane-changes id 已改为 useId 动态 id（git-pane-:rN:-changes），无法硬编码。
	await panel.getByRole("button", { name: "刷新" }).first().click();
	const changedFile = panel.locator(".git-resource-name", { hasText: "a.txt" }).first();
	await expect(changedFile).toBeVisible({ timeout: 15_000 });
	await expect(graph.locator(".git-working-tree-row")).toContainText("未提交变动");
	await graph
		.locator(".git-working-tree-row")
		.getByRole("button", { name: /未提交变动/ })
		.click();
	await expect(graph.locator(".git-working-tree-row .git-resource-name")).toHaveText("a.txt");
	await expect(graph.locator(".git-working-tree-row svg").first()).toBeVisible();
	await expect(graph.locator('path[stroke-dasharray="3 3"]').first()).toHaveAttribute("stroke-width", "1.6");
	await panel.screenshot({ path: "test-results/git-graph-preview.png" });

	// 行内 diff：点击文件名打开工作区 diff 查看器，确认内容后关闭
	await panel.locator(".git-resource-open", { hasText: "a.txt" }).first().click();
	const diffHeader = window.locator(".file-diff-header");
	await expect(diffHeader).toBeVisible({ timeout: 10_000 });
	// 文件名已移到外置 chrome Tab 栏（chromeTabsExternal，tab 文本 “a.txt (更改)”），
	// FileDiffViewer 内嵌 .file-diff-tab 只在非外置（showInlineTabs）时渲染。
	await expect(window.locator('[role="tab"]', { hasText: "a.txt" })).toBeVisible({ timeout: 10_000 });
	// 关闭按钮已从 .file-diff-close class 改为 aria-label="关闭"（FileDiffViewer header 区）
	await window.locator(".file-diff-header-actions").getByRole("button", { name: "关闭" }).click();
	await expect(diffHeader).toBeHidden();

	// 全部暂存 → 提交
	await panel.getByRole("button", { name: "全部暂存" }).click();
	await expect(panel.locator(".git-scm-input")).toBeEnabled({ timeout: 10_000 });
	await panel.locator(".git-scm-input").fill("e2e: update a.txt");
	await panel.locator(".git-commit-btn").click();

	// 提交后面板回到「没有待提交的更改」
	await expect(panel.locator(".git-status-msg").first()).toContainText("没有待提交的更改", { timeout: 15_000 });
	await expect(graph.locator(".git-working-tree-row")).toHaveCount(0);
	await expect(graph.getByRole("button", { name: /e2e: update a.txt/ })).toBeVisible({ timeout: 15_000 });
	// A commit made outside the UI must also arrive through the repository watcher.
	appendFileSync(join(repoDir, "a.txt"), "external commit\n");
	git("add a.txt");
	git('commit -m "external: graph refresh"');
	await expect(graph.getByRole("button", { name: /external: graph refresh/ })).toBeVisible({ timeout: 15_000 });
	await window.evaluate(() => {
		document.documentElement.dataset.theme = "dark";
	});
	const laneColors = await graph.locator("svg path").evaluateAll((paths) => [...new Set(paths.map((path) => getComputedStyle(path).stroke))]);
	expect(laneColors.length).toBeGreaterThan(1);
	expect(laneColors).not.toContain("rgb(250, 250, 250)");
	await panel.screenshot({ path: "test-results/git-graph-dark-preview.png" });

	// 仓库侧复核：提交真实存在且为最新一条
	const log = git("log --oneline -2");
	expect(log.split("\n")[1]).toContain("e2e: update a.txt");
});
