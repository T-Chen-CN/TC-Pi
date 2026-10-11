import { test, expect } from "./mock-pi-fixture";
import { armStartupOverlayDismissal } from "./startupOverlays";

test.use({ seedSettings: { language: "zh-CN", announcementNotificationEnabled: true, standbyRuntimeEnabled: false } });

test.beforeEach(async ({ window }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) {
		await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
});

test("dock contains four icons and search works from click and shortcut", async ({ window, app }) => {
	const dock = window.getByTestId("sidebar-dock");
	const buttons = dock.getByRole("button");
	await expect(buttons).toHaveCount(4);
	await expect(buttons.nth(0)).toHaveAttribute("aria-label", /设置/);
	await expect(buttons.nth(1)).toHaveAttribute("aria-label", "搜索会话");
	await expect(buttons.nth(2)).toHaveAttribute("aria-label", "定时任务");
	await expect(buttons.nth(3)).toHaveAttribute("aria-label", /主题/);
	await expect(window.getByRole("button", { name: "搜索会话", exact: true })).toHaveCount(1);
	await expect(window.getByRole("button", { name: "定时任务", exact: true })).toHaveCount(1);
	for (const i of [1, 2]) expect(await buttons.nth(i).innerText()).toBe("");
	await buttons.nth(1).hover();
	await expect(window.getByRole("tooltip")).toContainText("搜索会话");
	await expect(window.getByRole("tooltip")).toContainText(/Ctrl\+F|⌘F/);
	await buttons.nth(1).click();
	const input = window.getByPlaceholder("搜索会话", { exact: true });
	await expect(input).toBeVisible();
	await expect(input).toBeFocused();
	await window.keyboard.press("Escape");
	await expect(input).toBeHidden();
	await expect(window.locator('[role="dialog"][aria-label="Search"]')).toHaveCount(0);
	await buttons.nth(1).focus();
	await expect(buttons.nth(1)).toBeFocused();
	// App-wide shortcuts are matched by Electron before-input-event, beyond CDP DOM keyboard events.
	await app.evaluate(({ BrowserWindow }) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents;
		contents.sendInputEvent({ type: "keyDown", keyCode: "F", modifiers: [process.platform === "darwin" ? "meta" : "control"] });
		contents.sendInputEvent({ type: "keyUp", keyCode: "F", modifiers: [process.platform === "darwin" ? "meta" : "control"] });
	});
	await expect(input).toBeVisible();
	await window.keyboard.press("Escape");
});

test("task icon opens existing management and removed features are absent from the desktop API", async ({ window }) => {
	const dock = window.getByTestId("sidebar-dock");
	await dock.getByRole("button", { name: "定时任务", exact: true }).click();
	await expect(window.getByRole("dialog", { name: "定时任务", exact: true })).toBeVisible();
	await window.keyboard.press("Escape");
	await expect(window.getByRole("dialog", { name: "定时任务", exact: true })).toBeHidden();
	await expect(window.getByRole("button", { name: /公告|问题反馈/ })).toHaveCount(0);
	const retiredApi = await window.evaluate(() => {
		const api = window.piDesktop!;
		return ["announcements" in api, "feedbackEnvironment" in api.app, "getFeedbackProjectContext" in api.app];
	});
	expect(retiredApi).toEqual([false, false, false]);
	const mode = await window.locator("html").getAttribute("data-theme");
	await dock.getByRole("button").last().click();
	await expect(window.locator("html")).not.toHaveAttribute("data-theme", mode ?? "");
	await dock.getByRole("button").first().click();
	await expect(window.getByRole("dialog")).toBeVisible();
	await expect(window.getByText("公告通知", { exact: true })).toHaveCount(0);
});

test("all four dock icons fit the narrow sidebar without wrapping", async ({ window }) => {
	const splitter = window.getByRole("separator").first();
	const bounds = await splitter.boundingBox();
	if (!bounds) throw new Error("Sidebar splitter is missing");
	await window.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await window.mouse.down();
	await window.mouse.move(224, bounds.y + bounds.height / 2, { steps: 12 });
	await window.mouse.up();
	const dock = window.getByTestId("sidebar-dock");
	await expect.poll(() => dock.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(260);
	await expect
		.poll(() =>
			dock.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				const buttons = Array.from(element.querySelectorAll("button")).map((button) => button.getBoundingClientRect());
				return buttons.length === 4 && buttons.every((button) => button.left >= rect.left && button.right <= rect.right && Math.abs(button.top - buttons[0].top) < 1);
			}),
		)
		.toBe(true);
});
