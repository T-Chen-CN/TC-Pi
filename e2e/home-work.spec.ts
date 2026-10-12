import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./mock-pi-fixture";
import { ipcChannels } from "../src/shared/ipc";
import { buildAggregatedView, intermediateFromRecords } from "../src/main/usageStats/usageStatsAggregator";

const root = mkdtempSync(join(tmpdir(), "pideck-home-work-"));
const alpha = join(root, "alpha");
const beta = join(root, "beta");
mkdirSync(alpha);
mkdirSync(beta);

test.describe("home work entries", () => {
	test.use({
		seedProjects: async ({}, use) =>
			use([
				{ id: "home-alpha", name: "Alpha", path: alpha },
				{ id: "home-beta", name: "Beta", path: beta },
			]),
		seedSettings: { language: "zh-CN", theme: "light" },
		seedPiConfigFiles: { "models.json": JSON.stringify({ providers: { "home-provider": { apiKey: "fixture-home-secret", models: [{ id: "home-model" }] } } }) },
	});

	test("usage and provider details expand on demand while idle agents stay outside the task list", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		const sessionId = await window.evaluate(async () => {
			const record = await window.piDesktop!.sessions.createDraft({ projectId: "home-alpha", title: "Idle session" });
			const result = await window.piDesktop!.sessions.activateRuntime(record.id);
			if (!result.ok) throw new Error(JSON.stringify(result.error));
			return record.id;
		});
		const usage = buildAggregatedView(intermediateFromRecords([{ ts: Date.now(), sid: sessionId, cwd: alpha, model: "home-provider/home-model", input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: 1.25, costKnown: true }]), new Date());
		await app.evaluate(
			({ ipcMain }, payload) => {
				for (const channel of [payload.channels.usageStatsDetect, payload.channels.usageStatsRefresh, payload.channels.usageStatsGet]) ipcMain.removeHandler(channel);
				ipcMain.handle(payload.channels.usageStatsDetect, () => ({ installed: true, piInstalled: true, logPath: null, recordCount: 1, firstRecordAt: payload.usage.window.since, lastRecordAt: payload.usage.window.to }));
				ipcMain.handle(payload.channels.usageStatsRefresh, () => ({ fullRescan: true, parsedRecords: 1, skippedLines: 0 }));
				ipcMain.handle(payload.channels.usageStatsGet, () => payload.usage);
			},
			{ channels: ipcChannels, usage },
		);
		const home = window.getByTestId("home-overview");
		await home.getByRole("button", { name: "刷新", exact: true }).click();
		await expect(home.getByTestId("home-usage-summary")).toContainText("$1.25");
		await expect(home.getByTestId("home-running")).toHaveCount(0);
		await expect(home.getByTestId("home-usage-trend")).toHaveCount(0);
		const usageTrigger = home.getByRole("button", { name: "查看用量详情", exact: true });
		await usageTrigger.click();
		await expect(home.getByTestId("home-usage-trend")).toBeVisible();
		await expect(home.getByTestId("home-usage-details")).toContainText("150 / $1.25");
		await usageTrigger.click();
		await expect(home.getByTestId("home-usage-trend")).toBeHidden();
		await home.getByRole("button", { name: "查看供应商详情", exact: true }).click();
		await expect(home.getByTestId("home-providers").getByText("home-model", { exact: true })).toBeVisible();
		await expect(home).not.toContainText("fixture-home-secret");
	});

	test("quick actions resume the latest activity and create a new session in its workspace", async ({ window }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		const home = window.getByTestId("home-overview");
		await expect(home.getByRole("button", { name: "继续上次工作", exact: true })).toBeDisabled();
		await window.evaluate(async () => {
			const first = await window.piDesktop!.sessions.createDraft({ projectId: "home-alpha", title: "Earlier work" });
			await window.piDesktop!.sessions.createDraft({ projectId: "home-beta", title: "Newer work" });
			await window.piDesktop!.sessions.updateRecord(first.id, { title: "Recently resumed work" });
		});
		await expect(home.getByTestId("home-recent-sessions").getByRole("button").first()).toContainText("Recently resumed work");
		await home.getByRole("button", { name: "继续上次工作", exact: true }).click();
		await expect(home).toBeHidden();
		await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar")).toContainText("Recently resumed work");
		await window.getByTestId("sidebar-navigation").getByRole("button", { name: "主界面", exact: true }).click();
		const before = await window.evaluate(() => window.piDesktop!.sessions.listCatalog("home-alpha", { scan: false }));
		await home.getByTestId("home-quick-start").getByRole("button", { name: "新建会话", exact: true }).click();
		await expect(home).toBeHidden();
		await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.sessions.listCatalog("home-alpha", { scan: false })).length)).toBe(before.length + 1);
	});

	test("home keeps work entries before summaries with collapsed provider details in both themes", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await window.evaluate(async () => {
			await window.piDesktop!.sessions.createDraft({ projectId: "home-alpha", title: "Review changes" });
			await window.piDesktop!.sessions.createDraft({ projectId: "home-beta", title: "Continue development" });
		});
		const home = window.getByTestId("home-overview");
		await expect(home.getByTestId("home-recent-sessions").getByRole("button")).toHaveCount(2);
		await expect(home.getByTestId("home-attention")).toHaveCount(0);
		await expect(home.getByTestId("home-running")).toHaveCount(0);
		const providerTrigger = home.getByRole("button", { name: "查看供应商详情", exact: true });
		await expect(providerTrigger).toHaveAttribute("aria-expanded", "false");
		const workTop = await home.getByTestId("home-workspaces").evaluate((element) => element.getBoundingClientRect().top);
		const usageTop = await home.getByTestId("home-usage-summary").evaluate((element) => element.getBoundingClientRect().top);
		expect(workTop).toBeLessThan(usageTop);
		await window.screenshot({ path: "test-results/home-work-light.png" });
		await providerTrigger.click();
		await expect(providerTrigger).toHaveAttribute("aria-expanded", "true");
		await providerTrigger.click();
		await window.getByRole("button", { name: /^主题：.*（点击切换）$/ }).click();
		await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
		await home.evaluate((element) => {
			element.scrollTop = 0;
		});
		await window.screenshot({ path: "test-results/home-work-dark.png" });
		await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 780));
		await expect.poll(() => home.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		await expect(home.getByRole("button", { name: "继续上次工作", exact: true })).toBeVisible();
	});
});

test.describe("empty home", () => {
	test.use({ seedProjects: async ({}, use) => use([]), seedSettings: { language: "zh-CN" } });

	test("cancelling workspace selection from New session leaves the empty home unchanged", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await app.evaluate(({ dialog }) => {
			dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
		});
		const home = window.getByTestId("home-overview");
		await home.getByTestId("home-quick-start").getByRole("button", { name: "新建会话", exact: true }).click();
		await expect(home).toBeVisible();
		await expect(home.getByRole("button", { name: "继续上次工作", exact: true })).toBeDisabled();
		await expect(home.getByTestId("home-recent-sessions").getByRole("button")).toHaveCount(0);
	});
});
