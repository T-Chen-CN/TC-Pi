import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./mock-pi-fixture";
import { armStartupOverlayDismissal } from "./startupOverlays";

const root = mkdtempSync(join(tmpdir(), "pideck-seed-explorer-"));
mkdirSync(join(root, "documents"));
writeFileSync(join(root, "documents", "sample.txt"), "disclosure preview\n");
test.use({ seedProjects: [{ id: "explorer-disclosure", name: "Explorer", path: root }], seedSettings: { language: "zh-CN", theme: "light" } });

/** 在隔离窗口中验证整块收起及文件树状态保留，不操作用户正在使用的工作区。 */
test("file management expands inline and preserves the file tree and document preview", async ({ window }) => {
	if (process.env.PIDECK_EXPLORER_RENDERER_URL) {
		await window.goto(process.env.PIDECK_EXPLORER_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 30_000 });
	const explorer = window.getByTestId("workspace-file-explorer");
	const toggle = explorer.getByRole("button", { name: "文件管理", exact: true });
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(explorer.getByTestId("pi-config-file-tree")).toBeHidden();
	// 键盘与鼠标使用同一个入口；无工作区时同样可展开。
	await toggle.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(explorer.getByTestId("pi-config-file-tree")).toBeVisible();
	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Explorer", exact: true }).click();
	await explorer.getByRole("button", { name: "documents", exact: true }).click();
	await explorer.getByText("sample.txt", { exact: true }).click();
	const editor = window.getByTestId("file-region").locator(".cm-content:visible");
	await expect(editor).toContainText("disclosure preview");
	const widths = () => window.locator(".shell-panel-list, [data-testid='conversation-region']").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width)));
	const before = await widths();
	await toggle.click();
	await expect(explorer.getByText("sample.txt", { exact: true })).toBeHidden();
	await expect(explorer.getByRole("button", { name: "刷新", exact: true })).toBeHidden();
	await expect(editor).toContainText("disclosure preview");
	expect(await widths()).toEqual(before);
	await toggle.click();
	await expect(explorer.getByText("sample.txt", { exact: true })).toBeVisible();
	await expect(explorer.getByRole("button", { name: "刷新", exact: true })).toBeVisible();
	await expect(editor).toContainText("disclosure preview");
	expect(await widths()).toEqual(before);
	// Closing the central document preserves the file tree and fixed conversation column.
	await window.getByTestId("file-region").locator(".file-diff-header-actions").getByRole("button", { name: "关闭", exact: true }).click();
	await expect(editor).toHaveCount(0);
	await expect(explorer.getByText("sample.txt", { exact: true })).toBeVisible();
	expect(await widths()).toEqual(before);
});
