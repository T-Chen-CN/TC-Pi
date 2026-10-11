import { test, expect } from "./mock-pi-fixture";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { armStartupOverlayDismissal } from "./startupOverlays";

const root = mkdtempSync(join(tmpdir(), "pideck-window-tools-"));
const alpha = join(root, "alpha");
const beta = join(root, "beta");
mkdirSync(alpha);
mkdirSync(beta);
writeFileSync(join(alpha, "alpha-only.txt"), "alpha");
writeFileSync(join(beta, "beta-only.txt"), "beta");
test.use({
	seedProjects: async ({}, use) =>
		use([
			{ id: "tools-alpha", name: "Alpha", path: alpha },
			{ id: "tools-beta", name: "Beta", path: beta },
		]),
	seedSettings: { language: "zh-CN", zoomFactor: 1, sidebarWidth: 300, drawerWidth: 240 },
});
test.beforeEach(async ({ window, app }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
	await armStartupOverlayDismissal(window);
	await window.evaluate(() => {
		localStorage.setItem("pid:conversation-width", "440");
		localStorage.setItem("pid:project-drawer:tools-alpha", JSON.stringify({ panel: "git", pinnedPanels: ["files", "git"], drawerPinned: true }));
		localStorage.setItem("pid:project-drawer:tools-beta", JSON.stringify({ panel: null, pinnedPanels: ["browser"] }));
	});
	await window.reload();
	await armStartupOverlayDismissal(window);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await app.evaluate(({ BrowserWindow }) => {
		const win = BrowserWindow.getAllWindows()[0];
		win.unmaximize();
		win.webContents.setZoomFactor(1);
		win.setContentSize(1340, 900);
	});
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	await switchWorkspace(window, "Alpha");
});

/** Content changes establish that the real workspace switch has completed. */
async function switchWorkspace(window: Page, name: "Alpha" | "Beta") {
	await window.getByTestId("workspace-inline-list").getByRole("button", { name, exact: true }).click();
	await expect(window.getByTestId("workspace-file-explorer").getByText(`${name.toLowerCase()}-only.txt`, { exact: true })).toBeVisible();
}

const widths = (window: Page) => window.evaluate(() => [".shell-panel-list", '[data-testid="file-region"]', '[data-testid="conversation-region"]', ".shell-panel-drawer"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().width));

test("workspace switching preserves open tools and every actual column width even after borrowing conversation space", async ({ window }) => {
	const toggle = window.getByTestId("conversation-region").locator(".header-drawer-toggle");
	const drawer = window.locator(".detail-drawer");
	await expect(drawer).toHaveAttribute("data-open", "false");
	await toggle.click();
	await expect(drawer).toHaveAttribute("data-open", "true");
	await window.locator(".splitter-right").focus();
	await window.keyboard.press("Home");
	await expect.poll(async () => (await widths(window)).slice(1, 3).map(Math.round)).toEqual([200, 320]);
	const before = await widths(window);
	await window.evaluate(() => {
		const samples: number[][] = [];
		const end = performance.now() + 4_000;
		function sample() {
			samples.push([".shell-panel-list", '[data-testid="file-region"]', '[data-testid="conversation-region"]', ".shell-panel-drawer"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().width));
			if (performance.now() < end) requestAnimationFrame(sample);
		}
		Object.assign(window, { __windowToolSamples: samples });
		requestAnimationFrame(sample);
	});
	const visits: Array<"Alpha" | "Beta"> = ["Beta", "Alpha", "Beta", "Alpha"];
	for (const name of visits) {
		await switchWorkspace(window, name);
		await expect(drawer).toHaveAttribute("data-open", "true");
		await expect(window.getByTestId("drawer-rail-git")).toHaveAttribute("aria-selected", "true");
		await expect.poll(async () => (await widths(window)).map(Math.round)).toEqual(before.map(Math.round));
	}
	const samples = await window.evaluate(() => {
		const value: unknown = Reflect.get(window, "__windowToolSamples");
		if (!Array.isArray(value)) throw new Error("width samples missing");
		return value.map((row: unknown) => {
			if (!Array.isArray(row)) throw new Error("invalid width sample");
			return row.filter((item: unknown): item is number => typeof item === "number");
		});
	});
	expect(samples.length).toBeGreaterThan(1);
	for (const sample of samples) for (let i = 0; i < sample.length; i++) expect(Math.abs(sample[i] - before[i])).toBeLessThan(1);
	await window.getByRole("button", { name: "独立聊天", exact: true }).click();
	await expect(drawer).toHaveAttribute("data-open", "true");
	await expect.poll(async () => (await widths(window)).map(Math.round)).toEqual(before.map(Math.round));
});

test("tool choice and tabs survive switches while closed tools stay closed and reload starts hidden", async ({ window }) => {
	const drawer = window.locator(".detail-drawer");
	const toggle = window.getByTestId("conversation-region").locator(".header-drawer-toggle");
	await toggle.click();
	await window.getByRole("button", { name: "添加常驻面板", exact: true }).click();
	await window.getByRole("menuitemcheckbox", { name: "内置浏览器", exact: true }).click();
	await window.keyboard.press("Escape");
	await window.getByTestId("drawer-rail-browser").click();
	await expect(window.getByTestId("drawer-rail-browser")).toHaveAttribute("aria-selected", "true");
	await switchWorkspace(window, "Beta");
	await expect(drawer).toHaveAttribute("data-open", "true");
	await expect(window.getByTestId("drawer-rail-browser")).toHaveAttribute("aria-selected", "true");
	await toggle.click();
	await expect(drawer).toHaveAttribute("data-open", "false");
	const visits: Array<"Alpha" | "Beta"> = ["Alpha", "Beta", "Alpha"];
	for (const name of visits) {
		await switchWorkspace(window, name);
		await expect(drawer).toHaveAttribute("data-open", "false");
	}
	await toggle.click();
	await expect(window.getByTestId("drawer-rail-browser")).toBeVisible();
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect(drawer).toHaveAttribute("data-open", "false");
	await toggle.click();
	await expect(window.getByTestId("drawer-rail-browser")).toBeVisible();
});
