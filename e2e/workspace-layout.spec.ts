import { test, expect } from "./mock-pi-fixture";
import { armStartupOverlayDismissal } from "./startupOverlays";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
	seedSettings: { language: "zh-CN", theme: "light", sessionSortMode: "updatedAt", sessionTabOpenMode: "preview" },
});

// 使用隔离 Electron profile 验收开发服务，不触碰用户窗口。
test.beforeEach(async ({ window }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) {
		await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
});

test("global navigation stays in the left sidebar without a full-width title row", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const sidebar = window.locator(".shell-panel-list");
	const right = window.getByTestId("conversation-region");
	await expect(sidebar.getByRole("button", { name: "主界面", exact: true })).toBeVisible();
	await expect(sidebar.getByRole("button", { name: "独立聊天", exact: true })).toBeVisible();
	await expect(right.getByRole("button", { name: "独立聊天", exact: true })).toHaveCount(0);
	await expect(right.getByRole("button", { name: "选择工作区", exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "选择工作区", exact: true })).toHaveCount(1);
	const chatBottom = await sidebar.getByRole("button", { name: "独立聊天", exact: true }).evaluate((element) => element.getBoundingClientRect().bottom);
	const projectTop = await sidebar.getByRole("button", { name: "选择工作区", exact: true }).evaluate((element) => element.getBoundingClientRect().top);
	expect(projectTop).toBeGreaterThanOrEqual(chatBottom);
	await expect(window.locator(".simple-navigation-bar")).toHaveCount(0);
	await expect.poll(() => window.getByTestId("file-region").evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);
	await expect(sidebar.getByRole("button", { name: "后退", exact: true })).toBeVisible();
	await expect(sidebar.getByRole("button", { name: "前进", exact: true })).toBeVisible();
	// 品牌局部留白不能挤占中央文件区，也不能被旧标题栏固定高度覆盖。
	await expect
		.poll(() =>
			sidebar.locator(".list-toolbar").evaluate((toolbar) => {
				const brand = toolbar.querySelector(".brand-lockup");
				if (!brand) return false;
				const outer = toolbar.getBoundingClientRect();
				const inner = brand.getBoundingClientRect();
				return inner.top - outer.top >= 8 && outer.bottom - inner.bottom >= 8;
			}),
		)
		.toBe(true);
	await expect
		.poll(() =>
			sidebar.locator(".list-toolbar").evaluate((toolbar) => {
				const toggle = toolbar.querySelector(".list-toggle-native");
				return Boolean(toggle && toggle.getBoundingClientRect().right <= toolbar.getBoundingClientRect().right + 1);
			}),
		)
		.toBe(true);
	await sidebar.getByRole("button", { name: "折叠列表", exact: true }).click();
	const rail = window.getByTestId("sidebar-restore-rail");
	await expect(rail).toBeVisible();
	await expect(window.getByRole("button", { name: "展开列表", exact: true })).toHaveCount(1);
	await rail.getByRole("button", { name: "展开列表", exact: true }).click();
	await expect(rail).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "独立聊天", exact: true })).toBeVisible();
	await sidebar.getByRole("button", { name: "独立聊天", exact: true }).click();
	await expect(window.getByTestId("workspace-session-list")).toBeHidden();
	await right.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(window.getByTestId("workspace-session-list")).toBeVisible();
	await expect(window.getByTestId("home-overview")).toHaveCount(0);
	await sidebar.getByRole("button", { name: "主界面", exact: true }).click();
	await expect(window.getByTestId("home-overview")).toBeVisible();
	await expect(right).toBeVisible();
	// 控件仍贴窗口右上角；拖拽热区与按钮点击区必须分开。
	await expect.poll(() => sidebar.locator(".list-toolbar").evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"))).toBe("drag");
	await expect.poll(() => sidebar.locator(".list-toggle-native").evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"))).toBe("no-drag");
	await window.getByRole("button", { name: "窗口置顶", exact: true }).click();
	await expect.poll(() => window.evaluate(() => window.piDesktop!.app.isWindowAlwaysOnTop())).toBe(true);
	await window.getByRole("button", { name: "取消置顶", exact: true }).click();
	await expect.poll(() => window.evaluate(() => window.piDesktop!.app.isWindowAlwaysOnTop())).toBe(false);
	await window.screenshot({ path: "test-results/sidebar-global-navigation.png" });
});

test("inline workspaces and session picker preserve the file tree and home overview", async ({ window, app }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const sidebar = window.getByTestId("conversation-region");
	await expect(window.locator(".sidebar").getByRole("button", { name: "选择会话", exact: true })).toHaveCount(0);
	await expect(window.getByTestId("home-overview")).toBeVisible();
	await expect(window.getByTestId("home-providers")).toBeVisible();
	for (const name of ["添加工作区", "选择工作区"]) await expect(window.getByTestId("sidebar-navigation").getByRole("button", { name, exact: true })).toBeVisible();
	await expect(sidebar.getByRole("button", { name: "选择会话", exact: true })).toBeVisible();
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	const workspaces = window.getByTestId("workspace-inline-list");
	await expect(workspaces).toBeVisible();
	await expect(window.getByTestId("sidebar-navigation").getByTestId("workspace-inline-list")).toBeVisible();
	await expect(sidebar.getByTestId("workspace-inline-list")).toHaveCount(0);
	await expect(window.locator("[role=dialog]:visible")).toHaveCount(0);
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(window.getByTestId("home-overview")).toHaveCount(0);
	// 总览期间保留工作台挂载：恢复后无文件内容时，编辑器半栏不能留空。
	await expect(window.getByTestId("file-workbench-empty")).toBeVisible();
	await expect(window.getByTestId("conversation-region")).toBeVisible();
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
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
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
	await window.keyboard.press("Escape");
	await workspaces.getByRole("button", { name: "Beta", exact: true }).dragTo(workspaces.getByRole("button", { name: "Alpha", exact: true }), { targetPosition: { x: 8, y: 2 } });
	await expect.poll(() => workspaces.locator("[data-project-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-project-id")))).toEqual(["layout-beta", "layout-alpha"]);
	await workspaces.getByRole("button", { name: "Alpha", exact: true }).dragTo(workspaces.getByRole("button", { name: "Beta", exact: true }), { targetPosition: { x: 8, y: 2 } });
	await expect.poll(() => workspaces.locator("[data-project-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-project-id")))).toEqual(["layout-alpha", "layout-beta"]);
	await workspaces.locator('[data-project-id="layout-alpha"]').getByRole("button", { name: "工作区菜单", exact: true }).click();
	await expect(window.getByRole("menuitem", { name: /筛选|匿名|临时对话|会话排序/ })).toHaveCount(0);
	await window.keyboard.press("Escape");
	expect(await window.evaluate(() => Object.keys(window.piDesktop!.sessions).includes("createAnonymous"))).toBe(false);
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await sessions.getByRole("button", { name: /First session/ }).click();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toHaveAttribute("aria-pressed", "true");
	await sessions.getByRole("button", { name: /Second session/ }).click();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /Second session/ })).toHaveAttribute("aria-pressed", "true");
	const globalNavigation = window.getByTestId("sidebar-navigation");
	await globalNavigation.getByRole("button", { name: "后退", exact: true }).click();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toHaveAttribute("aria-pressed", "true");
	await globalNavigation.getByRole("button", { name: "前进", exact: true }).click();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /Second session/ })).toHaveAttribute("aria-pressed", "true");
	await sessions.getByRole("button", { name: /First session/ }).click();
	const activated = await window.evaluate(async (id) => window.piDesktop!.sessions.activateRuntime(id), ids[0]);
	expect(activated.ok, JSON.stringify(activated)).toBe(true);
	const liveBefore = await window.evaluate(async () => window.piDesktop!.sessions.listRuntimes());
	expect(liveBefore.some((runtime) => runtime.sessionId === ids[0] && runtime.agentId)).toBe(true);
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect.poll(rowIds).toEqual([ids[1], ids[0]]);
	await window.getByRole("button", { name: "主界面", exact: true }).click();
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
	await window.getByTestId("home-overview").getByRole("button", { name: "查看用量详情", exact: true }).click();
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
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions.getByRole("button", { name: /First session/ })).toHaveAttribute("aria-pressed", "true");
	await expect(sessions.getByRole("button", { name: /Second session/ })).toBeVisible();
	await explorer.getByText("layout-check.txt", { exact: true }).click();
	await expect(window.getByTestId("file-region")).toContainText("layout-check.txt");
	await window.getByRole("button", { name: "主界面", exact: true }).click();
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	await expect(workspaces).toHaveCount(0);
	await expect(sessions).toBeHidden();
	await expect(explorer).toBeVisible();
	await sidebar.getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(sessions).toBeVisible();
	// 走界面主题入口：直接调用 IPC 只会落盘，不会执行 renderer 的 onSettingsApplied。
	await window.keyboard.press("Escape");
	await window.getByRole("button", { name: /^主题：.*（点击切换）$/ }).click();
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
			.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
			.slice(0, 12)
			.map((session) => session.title);
	});
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.getByRole("button", { name: "主界面", exact: true }).click();
	const home = window.getByTestId("home-overview");
	const recent = home.locator("section").filter({ has: window.getByRole("heading", { name: "最近会话", exact: true }) });
	await expect(recent.getByRole("button")).toHaveCount(12);
	for (const [index, title] of expected.entries()) await expect(recent.getByRole("button").nth(index)).toContainText(title);
	await expect(recent.getByRole("button", { name: /加载更多|收起/ })).toHaveCount(0);
	await recent.getByRole("button").first().click();
	await expect(home).toBeHidden();
	await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar [data-session-id]").first()).toContainText(expected[0]);
});

test("file workspace, conversation and tools keep independent content and editor history", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const right = window.getByTestId("conversation-region");
	const nav = window.getByTestId("conversation-navigation");
	const files = window.getByTestId("file-region");
	const explorer = window.getByTestId("workspace-file-explorer");
	await expect(window.locator(".detail-drawer")).not.toHaveAttribute("data-open", "true");
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	const projects = window.getByTestId("workspace-inline-list");
	await projects.getByRole("button", { name: "Alpha", exact: true }).click();
	await right.locator(".session-tabs-bar").getByRole("button", { name: "新建会话", exact: true }).click();
	const composer = right.locator(".composer .rich-input");
	await expect(composer).toHaveAttribute("contenteditable", "true");
	await composer.fill("draft remains on the right");
	await explorer.getByText("layout-check.txt", { exact: true }).click();
	const editor = files.locator(".cm-content:visible");
	await expect(editor).toContainText("workspace alpha file");
	await editor.evaluate((element) => {
		element.setAttribute("data-acceptance-instance", "alpha-editor");
	});
	await editor.click();
	await window.keyboard.press("Control+End");
	await window.keyboard.insertText("accepted file edit");
	await expect(editor).toContainText("accepted file edit");
	await projects.getByRole("button", { name: "Beta", exact: true }).click();
	await expect(files.getByTestId("file-workbench-empty")).toBeVisible();
	await explorer.getByText("beta-check.txt", { exact: true }).click();
	await expect(editor).toContainText("workspace beta file");
	await projects.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(editor).toContainText("accepted file edit");
	await expect(editor).toHaveAttribute("data-acceptance-instance", "alpha-editor");
	await expect(composer).toContainText("draft remains on the right");
	await expect.poll(() => right.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(420);
	// 默认窄会话栏也必须给模型控件留下可点选的空间，不能被发送按钮压成几像素。
	await expect
		.poll(() =>
			right.locator(".composer-bottom-center").evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				const buttons = [...element.querySelectorAll("button")];
				return (
					buttons.length > 0 &&
					buttons.every((button) => {
						const rect = button.getBoundingClientRect();
						return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
					})
				);
			}),
		)
		.toBe(true);
	await right.locator(".session-tabs-bar").getByRole("button", { name: "更多操作", exact: true }).click();
	await window.getByRole("menuitem", { name: "终端", exact: true }).click();
	await expect(files.locator(".terminal-dock")).toBeVisible();
	await expect(right.locator(".terminal-dock")).toHaveCount(0);
	await expect(editor).toHaveAttribute("data-acceptance-instance", "alpha-editor");
	// 工具栏只调配横向空间，选择控件和会话标签不能随开合上下跳动。
	const chromePositions = () =>
		Promise.all([window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }), nav.getByRole("button", { name: "选择会话", exact: true }), right.locator(".session-tabs-bar")].map((locator) => locator.evaluate((element) => Math.round(element.getBoundingClientRect().top))));
	const closedChromePositions = await chromePositions();
	await right.locator(".header-drawer-toggle").click();
	await expect(window.locator(".detail-drawer")).toHaveAttribute("data-open", "true");
	await expect.poll(chromePositions).toEqual(closedChromePositions);
	await expect(composer).toBeVisible();
	await expect(editor).toHaveAttribute("data-acceptance-instance", "alpha-editor");
	await window.screenshot({ path: "test-results/workbench-tools-open.png" });
	await right.locator(".header-drawer-toggle").click();
	await expect(window.locator(".detail-drawer")).not.toHaveAttribute("data-open", "true");
	await expect.poll(chromePositions).toEqual(closedChromePositions);
	await expect.poll(() => right.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(420);
	await window.getByRole("button", { name: "主界面", exact: true }).click();
	await expect(files.getByTestId("home-overview")).toBeVisible();
	await expect(composer).toBeVisible();
	await expect(composer).toContainText("draft remains on the right");
	await projects.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(editor).toHaveAttribute("data-acceptance-instance", "alpha-editor");
	await editor.click();
	await window.keyboard.press("Control+z");
	await expect(editor).not.toContainText("accepted file edit");
	await window.screenshot({ path: "test-results/file-first-workbench.png" });
	await files.getByRole("button", { name: "关闭标签页 layout-check.txt", exact: true }).click();
	await expect(files.getByTestId("file-workbench-empty")).toBeVisible();
	await expect(composer).toBeVisible();
});

test("tool toggles take width only from documents, with no transient sidebar or conversation resize", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.evaluate(async () => {
		await window.piDesktop!.settings.update({ sidebarWidth: 350, drawerWidth: 400 });
		localStorage.setItem("pid:list-width", "350");
		localStorage.setItem("pid:drawer-width", "400");
		localStorage.setItem("pid:conversation-width", "580");
	});
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const right = window.getByTestId("conversation-region");
	const widths = () => window.evaluate(() => [".shell-panel-list", '[data-testid="conversation-region"]', '[data-testid="file-region"]', ".shell-panel-drawer"].map((selector) => Math.round(document.querySelector(selector)!.getBoundingClientRect().width)));
	await expect.poll(async () => (await widths()).slice(0, 2)).toEqual([350, 580]);
	const closed = await widths();
	for (const open of [true, false, true, false]) {
		// 逐帧验收，避免延后一帧的补偿把实际宽度跳动藏在最终坐标断言后面。
		const sampling = window.evaluate(
			() =>
				new Promise<number[][]>((resolve) => {
					const samples: number[][] = [];
					const sample = () => {
						samples.push([".shell-panel-list", '[data-testid="conversation-region"]'].map((selector) => document.querySelector(selector)!.getBoundingClientRect().width));
						if (samples.length === 30) resolve(samples);
						else requestAnimationFrame(sample);
					};
					requestAnimationFrame(sample);
				}),
		);
		await right.locator(".header-drawer-toggle").click();
		await expect(window.locator(".detail-drawer")).toHaveAttribute("data-open", String(open));
		const samples = await sampling;
		expect(
			samples.every(([list, conversation]) => Math.abs(list - closed[0]) <= 1 && Math.abs(conversation - closed[1]) <= 1),
			JSON.stringify(samples),
		).toBe(true);
		const current = await widths();
		expect(current.slice(0, 2)).toEqual(closed.slice(0, 2));
		if (open) expect(current[2]).toBeLessThan(closed[2]);
		else expect(current[2]).toBe(closed[2]);
	}
	expect(await window.evaluate(() => [localStorage.getItem("pid:list-width"), localStorage.getItem("pid:conversation-width"), localStorage.getItem("pid:drawer-width")])).toEqual(["350", "580", "400"]);
});

test("empty chat composer shows its full hint without an inner scrollbar", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const right = window.getByTestId("conversation-region");
	const input = right.locator(".rich-input");
	await expect(input).toHaveClass(/is-editor-empty/);
	await expect.poll(() => input.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
	const hint = right.getByTestId("composer-placeholder");
	await expect(hint).toHaveText((await input.getAttribute("data-placeholder")) ?? "");
	await expect(hint).toBeVisible();
	await expect
		.poll(() =>
			right.locator(".tiptap-composer-host").evaluate((host) => {
				const input = host.querySelector(".rich-input");
				const hint = host.querySelector('[data-testid="composer-placeholder"]');
				if (!input || !hint) return false;
				return hint.getBoundingClientRect().bottom <= input.getBoundingClientRect().bottom + 1;
			}),
		)
		.toBe(true);
	await window.screenshot({ path: "test-results/composer-placeholder-fixed.png" });
	await input.fill("A short draft");
	await expect(hint).toHaveCount(0);
	await expect(input).toContainText("A short draft");
	await input.fill(Array.from({ length: 40 }, (_, index) => `Long message line ${index + 1}`).join("\n"));
	await expect.poll(() => input.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(20);
	await input.fill("");
	await expect(hint).toBeVisible();
	await expect.poll(() => input.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
	// 从持久化偏好恢复最窄宽度，隔离 Electron 原生拖拽命中时序；仍断言实际呈现宽度。
	await window.evaluate(() => localStorage.setItem("pid:conversation-width", "320"));
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => right.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(320);
	await expect(hint).toBeVisible();
	await expect.poll(() => input.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
	await window.keyboard.press("Escape");
	await window.getByRole("button", { name: /^主题：.*（点击切换）$/ }).click();
	await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
	await window.screenshot({ path: "test-results/composer-placeholder-narrow-dark.png" });
});

test("a failed save keeps the file tab and latest edits when closing", async ({ window, app }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Alpha", exact: true }).click();
	await window.getByTestId("workspace-file-explorer").getByText("layout-check.txt", { exact: true }).click();
	const files = window.getByTestId("file-region");
	const editor = files.locator(".cm-content:visible");
	await expect(editor).toContainText("workspace alpha file");
	const original = readFileSync(join(alpha, "layout-check.txt"), "utf8");
	await app.evaluate(({ ipcMain }, channel) => {
		ipcMain.removeHandler(channel);
		ipcMain.handle(channel, () => {
			throw new Error("fixture write denied");
		});
	}, ipcChannels.filesWriteContent);
	await editor.click();
	await window.keyboard.press("Control+End");
	await window.keyboard.insertText("unsaved acceptance");
	await files.getByRole("button", { name: "关闭标签页 layout-check.txt", exact: true }).click();
	await expect(files.getByRole("tab", { name: "layout-check.txt", exact: true })).toBeVisible();
	await expect(editor).toContainText("unsaved acceptance");
	await expect(files).toContainText("fixture write denied");
	expect(readFileSync(join(alpha, "layout-check.txt"), "utf8")).toBe(original);
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
		await expect(sessions).toBeHidden();
		await window.getByTestId("conversation-region").locator(".session-tabs-bar").getByRole("button", { name: "新建会话", exact: true }).click();
		await window.getByTestId("conversation-region").getByRole("button", { name: "选择会话", exact: true }).click();
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
		// worktree 提示是常驻通知；按真实用户动作关闭后继续操作右上导航。
		await window.locator("[data-sonner-toast]").getByRole("button", { name: "关闭", exact: true }).first().click();
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
