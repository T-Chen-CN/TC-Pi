import { expect, type Page } from "@playwright/test";
import { test as fixture } from "./fixtures";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const base = resolve(".cache/simple-navigation-e2e");
mkdirSync(base, { recursive: true });
const projectDir = mkdtempSync(join(base, "simple-project-"));
writeFileSync(join(projectDir, "hello.ts"), "export const hello = 1;\n");
fixture.afterAll(() => rmSync(projectDir, { recursive: true, force: true }));
fixture.use({ seedProjects: [{ id: "simple-project", name: "simple-project", path: projectDir }], seedSettings: { navigationMode: "simple", sidebarExpandedProjectIds: ["simple-project"], piEnvironmentChecked: true, dshHomeDir: join(projectDir, ".dsh"), checkUpdateOnStartup: false } });

async function switchMode(window: Page, label: string) {
	await window.getByRole("button", { name: /^设置/ }).first().click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();
	await modal.getByRole("tab", { name: "外观设置", exact: true }).click();
	await modal.locator("#settings-section-appearance-navigation-mode").getByRole("combobox").click();
	await window.getByRole("option", { name: label, exact: true }).click();
	await modal.getByRole("button", { name: "保存", exact: true }).click();
	await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.settings.get()).navigationMode)).toBe(label === "简洁模式" ? "simple" : "tabs");
	// 设置保存提示位于右上角，可能暂时遮住关闭图标；使用 Dialog 的键盘关闭入口。
	await window.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
}

fixture("sidebar navigation: central file tabs, expand/restore, switch modes without remounting editor", async ({ window }, testInfo) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect(window.locator(".simple-navigation-bar")).toHaveCount(0);
	await expect(window.locator(".list-toolbar .list-toggle-native")).toBeVisible();
	await expect(window.getByTestId("sidebar-navigation").getByRole("button", { name: "主界面", exact: true })).toBeVisible();
	await expect(window.getByRole("tab", { name: "项目", exact: true })).toHaveCount(0);
	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "simple-project", exact: true }).click();
	const row = window.getByTestId("workspace-file-explorer").getByText("hello.ts", { exact: true });
	await expect(row).toBeVisible();
	await row.click();
	const files = window.getByTestId("file-region");
	const editor = files.locator(".cm-content:visible");
	await expect(editor).toBeVisible();
	await expect(files.locator(".simple-file-tabs").getByRole("tab", { name: "hello.ts" })).toBeVisible();
	await expect(window.locator(".simple-session-header").getByRole("tab", { name: "hello.ts" })).toHaveCount(0);
	await editor.evaluate((element) => {
		element.setAttribute("data-instance-proof", "original");
	});
	// 会话常驻右侧；折叠只收左侧文件树，不卸载中央编辑器。
	await window.locator(".list-toolbar .list-toggle-native").click();
	await expect(window.getByTestId("sidebar-restore-rail")).toBeVisible();
	await expect(window.getByTestId("conversation-region")).toBeVisible();
	await expect(editor).toHaveAttribute("data-instance-proof", "original");
	await window.getByTestId("sidebar-restore-rail").getByRole("button", { name: "展开列表", exact: true }).click();
	await editor.click();
	await window.keyboard.press("ControlOrMeta+End");
	await window.keyboard.insertText("// preserved edit");
	await switchMode(window, "标签模式");
	await expect(window.locator(".simple-navigation-bar")).toHaveCount(0);
	// 两种视觉模式共用左栏全局入口，不能重新引入整页顶部导航行。
	await expect(window.locator(".list-toolbar .list-toggle-native")).toBeVisible();
	await expect(editor).toHaveAttribute("data-instance-proof", "original");
	await expect(editor).toContainText("preserved edit");
	await switchMode(window, "简洁模式");
	await expect(window.locator(".simple-navigation-bar")).toHaveCount(0);
	await expect(window.locator(".list-toolbar .list-toggle-native")).toBeVisible();
	await expect(editor).toHaveAttribute("data-instance-proof", "original");
	await editor.click();
	await window.keyboard.press("ControlOrMeta+z");
	await expect(editor).not.toContainText("preserved edit");
	const geometry = await window.evaluate(() => {
		const top = document.querySelector('[data-testid="file-region"]')!.getBoundingClientRect();
		const controls = document.querySelector(".window-controls")!.getBoundingClientRect();
		return { fileTop: top.top, controlsHeight: controls.height, controlsTop: controls.top };
	});
	expect(geometry).toEqual({ fileTop: 0, controlsHeight: 40, controlsTop: 0 });
	await window.screenshot({ path: testInfo.outputPath("simple-mode.png") });
	await files.getByRole("button", { name: "关闭标签页 hello.ts", exact: true }).click();
	await expect(editor).toHaveCount(0);
	await expect(files.getByTestId("file-workbench-empty")).toBeVisible();
	await expect(window.getByTestId("conversation-region")).toBeVisible();
});
