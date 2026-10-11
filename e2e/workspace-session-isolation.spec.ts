import { test, expect } from "./mock-pi-fixture";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { armStartupOverlayDismissal } from "./startupOverlays";

const root = mkdtempSync(join(tmpdir(), "pideck-workspace-isolation-"));
const alpha = join(root, "alpha");
const beta = join(root, "beta");
mkdirSync(alpha);
mkdirSync(beta);
test.use({
	seedProjects: async ({}, use) =>
		use([
			{ id: "isolation-alpha", name: "Alpha", path: alpha },
			{ id: "isolation-beta", name: "Beta", path: beta },
		]),
	seedSettings: { language: "zh-CN", standbyRuntimeEnabled: true },
});
test.beforeEach(async ({ window }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) {
		await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.getByTestId("sidebar-navigation").getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Alpha", exact: true }).click();
});
test.afterEach(async ({ window }, info) => {
	if (info.status !== info.expectedStatus) await info.attach("workspace-notices", { body: JSON.stringify(await window.evaluate(() => window.piDesktop!.noticeHistory.get())), contentType: "application/json" });
});

/** 创建并从实际会话列表打开，保持 Tab 和选择链路与用户操作一致。 */
async function openDraft(window: Page, projectId: string, title: string) {
	const session = await window.evaluate(async ({ projectId, title }) => window.piDesktop!.sessions.createDraft({ projectId, title }), { projectId, title });
	const select = window.getByTestId("conversation-region").getByRole("button", { name: "选择会话", exact: true });
	if (!(await window.getByTestId("workspace-session-list").isVisible())) await select.click();
	await window
		.getByTestId("workspace-session-list")
		.getByRole("button", { name: new RegExp(title) })
		.click();
	return session;
}

test("workspace tabs and drafts are isolated and restored when switching back", async ({ window }) => {
	const first = await openDraft(window, "isolation-alpha", "Alpha conversation");
	const right = window.getByTestId("conversation-region");
	const tabs = right.locator(".session-tabs-bar [data-session-id]");
	const composer = right.locator(".composer .rich-input");
	await composer.fill("alpha unsent draft");
	await expect(tabs).toHaveCount(1);
	await expect(tabs).toHaveAttribute("data-session-id", first.id);
	const projects = window.getByTestId("workspace-inline-list");
	await projects.getByRole("button", { name: "Beta", exact: true }).click();
	await expect(tabs).toHaveCount(0);
	const second = await openDraft(window, "isolation-beta", "Beta conversation");
	await composer.fill("beta unsent draft");
	await expect(tabs).toHaveCount(1);
	await expect(tabs).toHaveAttribute("data-session-id", second.id);
	await projects.getByRole("button", { name: "Alpha", exact: true }).click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs).toHaveAttribute("data-session-id", first.id);
	await expect(composer).toContainText("alpha unsent draft");
	await window.getByRole("button", { name: "独立聊天", exact: true }).click();
	await expect(tabs).toHaveCount(0);
	await window.getByTestId("conversation-region").getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(window.getByTestId("workspace-session-list")).not.toContainText("Alpha conversation");
	await projects.getByRole("button", { name: "Beta", exact: true }).click();
	await expect(tabs).toHaveAttribute("data-session-id", second.id);
	await expect(composer).toContainText("beta unsent draft");
});

test("tab plus creates directly in the current workspace and independent chat without a picker", async ({ window }) => {
	const chat = await window.evaluate(async () => (await window.piDesktop!.projects.list()).find((project) => project.kind === "chat"));
	if (!chat) throw new Error("builtin chat project missing");
	const scopeIds = ["isolation-alpha", "isolation-beta", chat.id];
	const right = window.getByTestId("conversation-region");
	const tabs = right.locator(".session-tabs-bar [data-session-id]");
	const plus = right.locator(".session-tabs-bar").getByRole("button", { name: "新建会话", exact: true });
	for (const projectId of scopeIds) {
		if (projectId === chat.id) await window.getByRole("button", { name: "独立聊天", exact: true }).click();
		else if (projectId === "isolation-beta") await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Beta", exact: true }).click();
		const before = await window.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await window.piDesktop!.sessions.listCatalog(id, { scan: false })).length)), scopeIds);
		await plus.click();
		await expect(tabs).toHaveCount(1);
		await expect(window.getByRole("menu")).toHaveCount(0);
		const selectedId = await tabs.getAttribute("data-session-id");
		const after = await window.evaluate(async (ids) => Promise.all(ids.map((id) => window.piDesktop!.sessions.listCatalog(id, { scan: false }))), scopeIds);
		for (const [index, id] of scopeIds.entries()) {
			expect(after[index]).toHaveLength(before[index] + (id === projectId ? 1 : 0));
			if (id === projectId) expect(after[index].some((record) => record.id === selectedId && record.projectId === projectId)).toBe(true);
		}
	}
});

test("idle Agents stop silently before the workspace changes", async ({ window }) => {
	const session = await openDraft(window, "isolation-alpha", "Idle conversation");
	const runtime = await window.evaluate(async (id) => window.piDesktop!.sessions.activateRuntime(id), session.id);
	expect(runtime.ok).toBe(true);
	await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.sessions.listRuntimes()).filter((agent) => agent.projectId === "isolation-alpha").length)).toBeGreaterThan(0);
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Beta", exact: true }).click();
	await expect(window.getByRole("alertdialog")).toHaveCount(0);
	await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.sessions.listRuntimes()).filter((agent) => agent.projectId === "isolation-alpha").length)).toBe(0);
	await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar [data-session-id]")).toHaveCount(0);
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "Alpha", exact: true }).click();
	await window.getByTestId("conversation-region").getByRole("button", { name: "选择会话", exact: true }).click();
	await expect(window.getByTestId("workspace-session-list")).toContainText("Idle conversation");
	await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar [data-session-id]")).toHaveAttribute("data-session-id", session.id);
});

test("busy workspace confirms termination and cancellation preserves the running Agent", async ({ window }) => {
	const session = await openDraft(window, "isolation-alpha", "Busy conversation");
	const sent = await window.evaluate(async (id) => window.piDesktop!.sessions.sendPrompt({ sessionId: id, requestId: crypto.randomUUID(), message: "SLOW TOOLMANY 80 workspace switch" }), session.id);
	expect(sent.accepted).toBe(true);
	const target = window.getByTestId("workspace-inline-list").getByRole("button", { name: "Beta", exact: true });
	await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.sessions.listRuntimes()).some((agent) => agent.projectId === "isolation-alpha" && agent.status === "running"))).toBe(true);
	await target.click();
	const dialog = window.getByRole("alertdialog");
	await expect(dialog).toContainText("切换工作区");
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar [data-session-id]")).toHaveAttribute("data-session-id", session.id);
	expect(await window.evaluate(async () => (await window.piDesktop!.sessions.listRuntimes()).some((agent) => agent.projectId === "isolation-alpha" && agent.status === "running"))).toBe(true);
	await target.click();
	await dialog.getByRole("button", { name: "终止并切换", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect.poll(() => window.evaluate(async () => (await window.piDesktop!.sessions.listRuntimes()).filter((agent) => agent.projectId === "isolation-alpha").length)).toBe(0);
	await expect(window.getByTestId("conversation-region").locator(".session-tabs-bar [data-session-id]")).toHaveCount(0);
});
