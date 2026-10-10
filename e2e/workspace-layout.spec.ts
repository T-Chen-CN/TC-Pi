import { test, expect } from "./mock-pi-fixture";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ipcChannels } from "../src/shared/ipc";
import { buildAggregatedView, intermediateFromRecords } from "../src/main/usageStats/usageStatsAggregator";

const root = mkdtempSync(join(tmpdir(), "pideck-seed-layout-"));
const alpha = join(root, "alpha");
const beta = join(root, "beta");
mkdirSync(alpha);
mkdirSync(beta);
writeFileSync(join(alpha, "layout-check.txt"), "workspace alpha file\n");
writeFileSync(join(beta, "beta-check.txt"), "workspace beta file\n");
test.use({
	seedProjects: async ({}, use) =>
		use([
			{ id: "layout-alpha", name: "Alpha", path: alpha },
			{ id: "layout-beta", name: "Beta", path: beta },
		]),
	seedSettings: { language: "zh-CN", sessionSortMode: "updatedAt", sessionTabOpenMode: "preview" },
});

test("inline workspace/session navigation, persistent file tree and home overview", async ({ window, app }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const sidebar = window.locator(".chat-list-pane");
	await expect(window.getByTestId("home-overview")).toBeVisible();
	await expect(window.getByTestId("home-providers")).toBeVisible();
	for (const name of ["主界面", "添加工作区", "选择工作区", "选择会话"]) await expect(sidebar.getByRole("button", { name, exact: true })).toBeVisible();
	await sidebar.getByRole("button", { name: "选择工作区", exact: true }).click();
	const workspaces = window.getByTestId("workspace-inline-list");
	await expect(workspaces).toBeVisible();
	await expect(window.locator("[role=dialog]:visible")).toHaveCount(0);
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(window.getByTestId("home-overview")).toHaveCount(0);
	// 总览期间保留工作台挂载：恢复后无文件内容时，编辑器半栏不能留空。
	await expect.poll(async () => (await window.locator(".workbench-content-pane").boundingBox())?.width ?? 0).toBeLessThan(2);
	const explorer = window.getByTestId("workspace-file-explorer");
	await expect(explorer.getByText("layout-check.txt", { exact: true })).toBeVisible();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	const sessions = window.getByTestId("workspace-session-list");
	await expect(sessions).toContainText("当前工作区还没有会话");
	const ids = await window.evaluate(async () => {
		const first = await window.piDesktop!.sessions.createDraft({ projectId: "layout-alpha", title: "First session" });
		const second = await window.piDesktop!.sessions.createDraft({ projectId: "layout-alpha", title: "Second session" });
		return [first.id, second.id];
	});
	await workspaces.getByRole("button", { name: "Beta", exact: true }).click();
	await expect(explorer.getByText("beta-check.txt", { exact: true })).toBeVisible();
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toBeVisible();
	await window.evaluate(async (id) => window.piDesktop!.sessions.updateRecord(id, { title: "First session" }), ids[0]);
	const rowIds = () => sessions.getByTestId("workspace-session-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-session-id")));
	await expect.poll(rowIds).toEqual([ids[1], ids[0]]);
	const firstRow = sessions.locator(`[data-session-id="${ids[0]}"]`);
	await firstRow.hover();
	await firstRow.getByRole("button", { name: "置顶会话", exact: true }).click();
	await expect.poll(rowIds).toEqual([ids[0], ids[1]]);
	await firstRow.getByRole("button", { name: "取消置顶", exact: true }).click();
	await expect.poll(rowIds).toEqual([ids[1], ids[0]]);
	await workspaces.getByRole("button", { name: "Beta", exact: true }).dragTo(workspaces.getByRole("button", { name: "Alpha", exact: true }), { targetPosition: { x: 8, y: 2 } });
	await expect.poll(() => workspaces.locator("[data-project-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-project-id")))).toEqual(["layout-beta", "layout-alpha"]);
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).dragTo(workspaces.getByRole("button", { name: "Beta", exact: true }), { targetPosition: { x: 8, y: 2 } });
	await expect.poll(() => workspaces.locator("[data-project-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-project-id")))).toEqual(["layout-alpha", "layout-beta"]);
	await workspaces.locator('[data-project-id="layout-alpha"]').getByRole("button", { name: "工作区菜单", exact: true }).click();
	await expect(window.getByRole("menuitem", { name: /筛选|匿名|临时对话|会话排序/ })).toHaveCount(0);
	await window.keyboard.press("Escape");
	expect(await window.evaluate(() => Object.keys(window.piDesktop!.sessions).includes("createAnonymous"))).toBe(false);
	await sessions.getByRole("button", { name: /First session/ }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toHaveAttribute("aria-pressed", "true");
	const activated = await window.evaluate(async (id) => window.piDesktop!.sessions.activateRuntime(id), ids[0]);
	expect(activated.ok, JSON.stringify(activated)).toBe(true);
	const liveBefore = await window.evaluate(async () => window.piDesktop!.sessions.listRuntimes());
	expect(liveBefore.some((runtime) => runtime.sessionId === ids[0] && runtime.agentId)).toBe(true);
	await expect.poll(rowIds).toEqual([ids[1], ids[0]]);
	await sidebar.getByRole("button", { name: "主界面", exact: true }).click();
	await expect(window.getByTestId("home-overview")).toBeVisible();
	const liveAfter = await window.evaluate(async () => window.piDesktop!.sessions.listRuntimes());
	expect(liveAfter.find((runtime) => runtime.sessionId === ids[0])?.agentId).toBe(liveBefore.find((runtime) => runtime.sessionId === ids[0])?.agentId);
	await expect(explorer.getByText("layout-check.txt", { exact: true })).toBeVisible();
	// Windows Electron 的 home 不随 USERPROFILE 重定向；统计边界注入聚合样本，避免写入真实用户日志。
	const isolatedHome = await app.evaluate(() => process.env.USERPROFILE ?? process.env.HOME);
	expect(isolatedHome).toContain("pideck-mockpi-");
	if (!isolatedHome) throw new Error("isolated profile missing");
	const agentDir = join(isolatedHome, ".pi", "agent");
	const usage = buildAggregatedView(intermediateFromRecords([{ ts: Date.now(), sid: ids[0], cwd: alpha, model: "layout-provider/layout-model", input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: 1.25, costKnown: true }]), new Date());
	await app.evaluate(
		({ ipcMain }, payload) => {
			for (const channel of [payload.channels.usageStatsDetect, payload.channels.usageStatsRefresh, payload.channels.usageStatsGet]) ipcMain.removeHandler(channel);
			ipcMain.handle(payload.channels.usageStatsDetect, () => ({ installed: true, piInstalled: true, logPath: null, recordCount: 1, firstRecordAt: payload.usage.window.since, lastRecordAt: payload.usage.window.to }));
			ipcMain.handle(payload.channels.usageStatsRefresh, () => ({ fullRescan: true, parsedRecords: 1, skippedLines: 0 }));
			ipcMain.handle(payload.channels.usageStatsGet, () => payload.usage);
		},
		{ channels: ipcChannels, usage },
	);
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "layout-provider": { apiKey: "fixture-key", models: [{ id: "layout-model" }] } } }));
	await window.getByTestId("home-overview").getByRole("button", { name: "刷新", exact: true }).click();
	await expect(window.getByTestId("home-providers")).toContainText("layout-provider");
	await expect(window.getByTestId("home-providers")).toContainText("已配置认证");
	await expect(window.getByTestId("home-overview")).toContainText("150 / $1.25");
	await expect(window.getByTestId("home-overview")).not.toContainText("fixture-key");
	await expect.poll(() => window.getByTestId("home-usage-bar").evaluateAll((bars) => Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().height)))).toBeGreaterThan(30);
	const trend = window.getByTestId("home-usage-trend");
	for (const range of ["周", "月", "日"]) {
		await trend.getByRole("button", { name: range, exact: true }).click();
		await expect(trend.getByTestId("home-usage-bar")).toHaveCount(1);
		await expect(trend.getByRole("button", { name: range, exact: true })).toHaveAttribute("aria-pressed", "true");
	}
	await window.screenshot({ path: "test-results/workspace-home-light.png" });
	await workspaces.getByRole("button", { name: "Beta", exact: true }).click();
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toHaveAttribute("aria-pressed", "true");
	await expect(sessions.getByRole("button", { name: /Second session/ })).toBeVisible();
	await explorer.getByText("layout-check.txt", { exact: true }).click();
	await expect(window.locator(".chat-pane")).toContainText("layout-check.txt");
	await sidebar.getByRole("button", { name: "主界面", exact: true }).click();
	await sidebar.getByRole("button", { name: "选择工作区", exact: true }).click();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(workspaces).toHaveCount(0);
	await expect(sessions).toHaveCount(0);
	await expect(explorer).toBeVisible();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions).toBeVisible();
	await window.evaluate(async () => {
		await window.piDesktop!.settings.update({ theme: "dark" });
	});
	await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(window.locator("#boot-overlay")).toHaveCount(0);
	await expect(window.getByTestId("home-overview")).toBeVisible();
	await expect(window.getByTestId("home-providers")).toBeVisible();
	await window.screenshot({ path: "test-results/workspace-home-dark.png" });
	expect(ids).toHaveLength(2);
});

test("home recent sessions retain the newest twelve and ignore the removed activity history", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const expected = await window.evaluate(async () => {
		const sessions = [];
		for (let index = 1; index <= 13; index++) sessions.push(await window.piDesktop!.sessions.createDraft({ projectId: "layout-alpha", title: `Home recent ${String(index).padStart(2, "0")}` }));
		// 旧使用记录特意只指向最早一条：清理后它不能决定首页最近会话的排序或范围。
		localStorage.setItem("pideck:recent-agent-activity:v2", JSON.stringify([{ sessionId: sessions[0].id, projectId: "layout-alpha", at: Date.now() }]));
		return sessions
			.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
			.slice(0, 12)
			.map((session) => session.title);
	});
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.locator(".chat-list-pane").getByRole("button", { name: "主界面", exact: true }).click();
	const home = window.getByTestId("home-overview");
	const recent = home.locator("section").filter({ has: window.getByRole("heading", { name: "最近会话", exact: true }) });
	await expect(recent.getByRole("button")).toHaveCount(12);
	for (const [index, title] of expected.entries()) await expect(recent.getByRole("button").nth(index)).toContainText(title);
	await expect(recent.getByRole("button", { name: /加载更多|收起/ })).toHaveCount(0);
	await recent.getByRole("button").first().click();
	await expect(home).toBeHidden();
	await expect(window.locator(".chat-list-pane").getByRole("button", { name: "选择会话", exact: true })).toContainText(expected[0]);
});

test.describe("empty workspace navigation", () => {
	test.use({ seedProjects: async ({}, use) => use([]) });
	test("independent chat creates a saved conversation without a folder picker", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await app.evaluate(({ dialog }) => {
			dialog.showOpenDialog = async () => {
				throw new Error("independent chat must not select a folder");
			};
		});
		await window.getByRole("button", { name: "独立聊天", exact: true }).click();
		const sessions = window.getByTestId("workspace-session-list");
		await expect(sessions).toBeVisible();
		await sessions.getByRole("button", { name: "新建会话", exact: true }).click();
		await expect(sessions.getByTestId("workspace-session-row")).toHaveCount(1);
		const chatSessions = await window.evaluate(async () => {
			const chat = (await window.piDesktop!.projects.list()).find((project) => project.kind === "chat");
			if (!chat) throw new Error("builtin chat project missing");
			return window.piDesktop!.sessions.listCatalog(chat.id);
		});
		expect(chatSessions).toHaveLength(1);
		expect(chatSessions[0].noSession).toBeUndefined();
		await expect(window.getByTestId("workspace-file-explorer")).toContainText("无需工作目录");
	});
	test("workspace selection falls back to the native folder picker, and cancel keeps the home page", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await app.evaluate(({ dialog }) => {
			dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
		});
		await window.getByRole("button", { name: "选择工作区", exact: true }).click();
		await expect(window.getByTestId("home-overview")).toBeVisible();
		await expect(window.getByTestId("workspace-inline-list")).toHaveCount(0);
		await app.evaluate(({ dialog }, folder) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
		}, beta);
		await window.getByRole("button", { name: "选择工作区", exact: true }).click();
		await expect(window.getByTestId("workspace-file-explorer").getByText("beta-check.txt", { exact: true })).toBeVisible();
		await expect(window.getByTestId("home-overview")).toHaveCount(0);
		await window.getByRole("button", { name: "选择会话", exact: true }).click();
		await expect(window.getByTestId("workspace-session-list")).toContainText("当前工作区还没有会话");
		await app.evaluate(({ dialog }, folder) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
		}, alpha);
		await window.getByRole("button", { name: "添加工作区", exact: true }).click();
		await expect(window.getByTestId("workspace-file-explorer").getByText("layout-check.txt", { exact: true })).toBeVisible();
	});
});

test.describe("workspace maintenance", () => {
	const repo = join(root, "worktree-root");
	const missing = join(root, "missing-folder");
	mkdirSync(repo);
	writeFileSync(join(repo, "tracked.txt"), "worktree acceptance\n");
	writeFileSync(join(repo, ".gitignore"), ".pi/\n");
	for (const args of [
		["init", "-b", "main"],
		["config", "user.name", "PiDeck test"],
		["config", "user.email", "test@example.invalid"],
		["add", "tracked.txt", ".gitignore"],
		["commit", "-m", "seed"],
	])
		execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	test.use({
		seedProjects: async ({}, use) =>
			use([
				{ id: "layout-git", name: "Git workspace", path: repo },
				{ id: "layout-missing", name: "Missing workspace", path: missing },
			]),
	});
	test("refresh shows unavailable directories and discovers/creates Git worktrees", async ({ window }) => {
		test.setTimeout(90_000);
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await window.getByRole("button", { name: "选择工作区", exact: true }).click();
		const projects = window.getByTestId("workspace-inline-list");
		await projects.getByRole("button", { name: "刷新所有项目", exact: true }).click();
		await expect(projects.locator('[data-project-id="layout-missing"]')).toContainText("目录不存在");
		await window.evaluate(async () => window.piDesktop!.projects.toggleWorktreeEnabled("layout-git"));
		execFileSync("git", ["worktree", "add", "-b", "external-branch", join(root, "external-branch")], { cwd: repo, stdio: "pipe" });
		await projects.getByRole("button", { name: "刷新所有项目", exact: true }).click();
		await expect(projects.getByRole("button", { name: "external-branch", exact: true })).toBeVisible();
		await expect(projects.locator('[data-project-id="layout-git"]')).toContainText("main");
		await projects.getByRole("button", { name: "新建工作区", exact: true }).click();
		const dialog = window.getByRole("dialog", { name: "新工作区名称" });
		await dialog.getByPlaceholder("输入分支或工作区名称").fill("acceptance-worktree");
		await dialog.getByRole("button", { name: "新建工作区", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(projects.getByRole("button", { name: "acceptance-worktree", exact: true })).toBeVisible();
		await projects.getByRole("button", { name: "acceptance-worktree", exact: true }).click();
		await expect(window.getByTestId("workspace-file-explorer").getByText("tracked.txt", { exact: true })).toBeVisible();
		await window.screenshot({ path: "test-results/workspace-worktrees.png" });
	});
});
