import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./mock-pi-fixture";

const projectRoot = mkdtempSync(join(tmpdir(), "tc-pi-config-workbench-"));
writeFileSync(join(projectRoot, "project.txt"), "workspace-document-marker");
test.afterAll(() => rmSync(projectRoot, { recursive: true, force: true }));
test.use({
	seedProjects: [{ id: "config-workspace", name: "Config workspace", path: projectRoot }],
	seedSettings: { language: "zh-CN", theme: "light" },
	seedPiConfigFiles: {
		"settings.json": '{"marker":"global-config-marker"}',
		"AGENTS.md": "# global rules\n",
		"auth.json": "{}",
		"prompts/config-prompt.md": "# config prompt\n",
		"sessions/history-hidden.json": "{}",
	},
});

test("home previews global configuration, keeps its context, and returns to the overview", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 30_000 });
	const explorer = window.getByTestId("workspace-file-explorer");
	await expect(explorer.getByText("Pi Agent 配置", { exact: true })).toBeVisible();
	await expect(explorer.getByText("auth.json", { exact: true })).toHaveCount(0);
	await expect(explorer.getByText("sessions", { exact: true })).toHaveCount(0);
	await explorer.getByText("settings.json", { exact: true }).click();
	const editor = window.getByTestId("file-region").locator(".cm-content:visible");
	await expect(editor).toContainText("global-config-marker");
	await expect(explorer.getByTestId("pi-config-file-tree")).toBeVisible();
	await window.getByRole("button", { name: "主界面", exact: true }).click();
	await expect(window.getByTestId("file-region").getByText("使用总览", { exact: true })).toBeVisible();
	await explorer.getByText("settings.json", { exact: true }).click();
	await expect(editor).toContainText("global-config-marker");
});

test("workspace and independent chat restore their own document and file tree scopes", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 30_000 });
	const explorer = window.getByTestId("workspace-file-explorer");
	await explorer.getByText("settings.json", { exact: true }).click();
	const editor = window.getByTestId("file-region").locator(".cm-content:visible");
	await expect(editor).toContainText("global-config-marker");
	await editor.click();
	await window.keyboard.press("ControlOrMeta+a");
	await window.keyboard.insertText('{"marker":"global-config-draft"}');
	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Config workspace", exact: true }).click();
	await expect(explorer.getByTestId("pi-config-file-tree")).toHaveCount(0);
	await explorer.getByText("project.txt", { exact: true }).click();
	await expect(editor).toContainText("workspace-document-marker");
	await window.getByRole("button", { name: "独立聊天", exact: true }).click();
	await expect(explorer.getByText("Pi Agent 配置", { exact: true })).toBeVisible();
	await expect(editor).toContainText("global-config-draft");
	await editor.click();
	await window.keyboard.press("ControlOrMeta+s");
	const configRoot = await window.evaluate(() => window.piDesktop.config.getConfigDir());
	await expect.poll(() => readFileSync(join(configRoot, "settings.json"), "utf8")).toBe('{"marker":"global-config-draft"}');
	// 工作区列表是保留展开状态的内联区域，切到独立聊天不会自动折叠它。
	if (!(await window.getByTestId("workspace-inline-list").isVisible())) await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Config workspace", exact: true }).click();
	await expect(editor).toContainText("workspace-document-marker");
});

test("global resource folders expand, search, and rename through the same file controls", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 30_000 });
	const explorer = window.getByTestId("workspace-file-explorer");
	await explorer.getByRole("button", { name: "prompts", exact: true }).click();
	const file = explorer.getByText("config-prompt.md", { exact: true });
	await expect(file).toBeVisible();
	await file.click({ button: "right" });
	await window.getByRole("menuitem", { name: "重命名", exact: true }).click();
	const dialog = window.getByRole("dialog");
	await dialog.locator("input").fill("renamed-config.md");
	await dialog.getByRole("button", { name: "确认", exact: true }).click();
	await expect(explorer.getByText("renamed-config.md", { exact: true })).toBeVisible();
	await explorer.getByRole("button", { name: /^按名称搜索文件/ }).click();
	await explorer.locator("input").fill("renamed-config");
	await expect(explorer.getByText("renamed-config.md", { exact: true })).toBeVisible();
});
