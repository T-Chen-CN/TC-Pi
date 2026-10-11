import { test, expect } from "./mock-pi-fixture";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armStartupOverlayDismissal, settleStartupOverlays } from "./startupOverlays";

const root = mkdtempSync(join(tmpdir(), "pideck-session-picker-"));
const alpha = join(root, "alpha");
const beta = join(root, "beta");
mkdirSync(alpha);
mkdirSync(beta);
test.use({
	seedProjects: async ({}, use) =>
		use([
			{ id: "picker-alpha", name: "Alpha", path: alpha },
			{ id: "picker-beta", name: "Beta", path: beta },
		]),
	seedSettings: { language: "zh-CN", sessionTabOpenMode: "preview", standbyRuntimeEnabled: false },
});
test.beforeEach(async ({ window }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) {
		await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Alpha", exact: true }).click();
	await settleStartupOverlays(window);
});

test("session picker occupies the tab actions and overlays content without moving chrome", async ({ window }) => {
	const right = window.getByTestId("conversation-region");
	const bar = right.locator(".session-tabs-bar");
	const trigger = bar.locator(".session-tabs-actions").getByRole("button", { name: "选择会话", exact: true });
	await expect(trigger).toBeVisible();
	const before = await bar.boundingBox();
	await trigger.click();
	const picker = window.getByTestId("workspace-session-picker");
	await expect(picker).toBeVisible();
	await expect(picker).toContainText("当前工作区还没有会话");
	await expect(picker.getByRole("button", { name: "新建会话", exact: true })).toHaveCount(0);
	await expect
		.poll(async () => {
			const bounds = await picker.boundingBox();
			return Boolean(before && bounds && bounds.y >= before.y + before.height);
		})
		.toBe(true);
	expect(await bar.boundingBox()).toEqual(before);
	await window.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await trigger.click();
	await expect(picker).toBeHidden();
	await trigger.click();
	await window.getByTestId("file-workbench-empty").click();
	await expect(picker).toBeHidden();
	await trigger.click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Beta", exact: true }).click();
	await expect(picker).toBeHidden();
	await trigger.click();
	await expect(picker).toContainText("当前工作区还没有会话");
	await window.getByRole("button", { name: "独立聊天", exact: true }).click();
	await expect(picker).toBeHidden();
});

test("session picker scrolls and retains pin and menu actions before a permanent selection", async ({ window }) => {
	const right = window.getByTestId("conversation-region");
	const trigger = right.locator(".session-tabs-bar").getByRole("button", { name: "选择会话", exact: true });
	const sessions = await window.evaluate(async () => {
		const records = [];
		for (let i = 0; i < 24; i++) records.push(await window.piDesktop!.sessions.createDraft({ projectId: "picker-alpha", title: `Picker conversation ${i}` }));
		return records;
	});
	// First-catalog reconciliation selects a draft and focuses its composer. Seed before opening the picker.
	await expect(right.locator(".session-tabs-bar").getByRole("tab")).toBeVisible();
	await settleStartupOverlays(window);
	await trigger.click();
	const picker = window.getByTestId("workspace-session-picker");
	const list = picker.getByTestId("workspace-session-list");
	await expect(list.getByTestId("workspace-session-row")).toHaveCount(24);
	expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	const row = list.getByTestId("workspace-session-row").first();
	await row.hover();
	await row.getByRole("button", { name: "置顶会话", exact: true }).click();
	await expect(picker).toBeVisible();
	await expect(row.getByRole("button", { name: "取消置顶", exact: true })).toBeVisible();
	await row.getByRole("button", { name: "会话菜单", exact: true }).click();
	await expect(window.getByRole("menu")).toBeVisible();
	await expect(picker).toBeVisible();
	await window.keyboard.press("Escape");
	await expect(window.getByRole("menu")).toBeHidden();
	await expect(picker).toBeVisible();
	const selectedId = await row.getAttribute("data-session-id");
	await row.getByRole("button", { name: /Picker conversation/ }).click();
	await expect(picker).toBeHidden();
	const tab = right.locator(`.session-tabs-bar [data-session-id="${selectedId}"]`);
	await expect(tab).toBeVisible();
	await expect(tab).not.toHaveClass(/\bitalic\b/);
	expect(sessions.some((session) => session.id === selectedId)).toBe(true);
	await trigger.click();
	await picker.getByRole("button", { name: "管理与恢复会话", exact: true }).click();
	await expect(picker).toBeHidden();
	await expect(window.getByRole("dialog")).toBeVisible();
});
