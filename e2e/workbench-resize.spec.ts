import { test, expect } from "./mock-pi-fixture";
import { armStartupOverlayDismissal } from "./startupOverlays";

test.use({ seedSettings: { language: "zh-CN", theme: "light", zoomFactor: 1, sidebarWidth: 300, drawerWidth: 240 } });

test.beforeEach(async ({ window, app }) => {
	if (process.env.PIDECK_WORKSPACE_RENDERER_URL) await window.goto(process.env.PIDECK_WORKSPACE_RENDERER_URL);
	await armStartupOverlayDismissal(window);
	await window.evaluate(() => {
		localStorage.setItem("pid:list-width", "300");
		localStorage.setItem("pid:conversation-width", "440");
		localStorage.setItem("pid:drawer-width", "240");
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
	await expect.poll(() => window.locator(".shell-panel-list").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(300);
	await window.getByTestId("conversation-region").locator(".header-drawer-toggle").click();
	await expect(window.locator(".detail-drawer")).toHaveAttribute("data-open", "true");
	await expect.poll(() => window.locator(".shell-panel-list").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(300);
});

/** Measure visible CSS pixels so Electron zoom cannot hide an incorrect budget. */
const widths = (window: import("@playwright/test").Page) => window.evaluate(() => [".shell-panel-list", '[data-testid="file-region"]', '[data-testid="conversation-region"]', ".shell-panel-drawer"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().width));

test("tools consume documents before conversation, stop at both floors and reverse without a jump", async ({ window }) => {
	const before = await widths(window);
	expect(before[1]).toBeGreaterThan(260);
	const handle = window.locator(".splitter-right");
	const rect = await handle.boundingBox();
	if (!rect) throw new Error("tool separator missing");
	const x = rect.x + rect.width / 2;
	const y = rect.y + 300;
	await window.mouse.move(x, y);
	await window.mouse.down();
	await window.mouse.move(x - 60, y, { steps: 6 });
	const first = await widths(window);
	expect(first[0]).toBeCloseTo(before[0], 0);
	expect(first[2]).toBeCloseTo(before[2], 0);
	expect(first[1]).toBeCloseTo(before[1] - 60, 0);
	await window.mouse.move(x - (before[1] - 200) - 50, y, { steps: 10 });
	const second = await widths(window);
	expect(second[0]).toBeCloseTo(before[0], 0);
	expect(second[1]).toBeCloseTo(200, 0);
	expect(second[2]).toBeCloseTo(before[2] - 50, 0);
	await window.mouse.move(x - 1000, y, { steps: 10 });
	const limit = await widths(window);
	expect(limit[0]).toBeCloseTo(300, 0);
	expect(limit[1]).toBeCloseTo(200, 0);
	expect(limit[2]).toBeCloseTo(320, 0);
	await window.mouse.move(x, y, { steps: 12 });
	await window.mouse.up();
	await expect.poll(async () => (await widths(window)).map(Math.round)).toEqual(before.map(Math.round));
	expect(await window.evaluate(() => [localStorage.getItem("pid:list-width"), localStorage.getItem("pid:conversation-width")])).toEqual(["300", "440"]);
});

test("conversation resize cannot borrow from list or tools and only saves its own preference", async ({ window }) => {
	const before = await widths(window);
	const handle = window.locator(".shell-panel-group > [data-separator]").nth(1);
	const rect = await handle.boundingBox();
	if (!rect) throw new Error("conversation separator missing");
	await window.mouse.move(rect.x + rect.width / 2, rect.y + 300);
	await window.mouse.down();
	await window.mouse.move(rect.x - 1000, rect.y + 300, { steps: 16 });
	await window.mouse.up();
	const after = await widths(window);
	expect(after[0]).toBeCloseTo(before[0], 0);
	expect(after[3]).toBeCloseTo(before[3], 0);
	expect(after[1]).toBeCloseTo(200, 0);
	expect(await window.evaluate(() => localStorage.getItem("pid:list-width"))).toBe("300");
});

test("left separator alone changes sidebar width; tool keyboard and toggles preserve it", async ({ window }) => {
	const left = window.locator(".splitter-left");
	const rect = await left.boundingBox();
	if (!rect) throw new Error("left separator missing");
	await window.mouse.move(rect.x + rect.width / 2, rect.y + 300);
	await window.mouse.down();
	await window.mouse.move(rect.x + rect.width / 2 + 40, rect.y + 300, { steps: 8 });
	await window.mouse.up();
	await expect.poll(async () => Math.round((await widths(window))[0])).toBe(340);
	expect(await window.evaluate(() => localStorage.getItem("pid:list-width"))).toBe("340");
	const tool = window.locator(".splitter-right");
	await tool.focus();
	await window.keyboard.press("Home");
	const limited = await widths(window);
	expect(limited[0]).toBeCloseTo(340, 0);
	expect(limited[1]).toBeCloseTo(200, 0);
	expect(limited[2]).toBeCloseTo(320, 0);
	expect(await window.evaluate(() => localStorage.getItem("pid:conversation-width"))).toBe("440");
	await window.keyboard.press("End");
	await expect.poll(async () => Math.round((await widths(window))[2])).toBe(440);
	for (let i = 0; i < 4; i++) {
		await window.getByTestId("conversation-region").locator(".header-drawer-toggle").click();
		await expect.poll(async () => Math.round((await widths(window))[0])).toBe(340);
	}
	await window.reload();
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(async () => Math.round((await widths(window))[0])).toBe(340);
});

test("a narrow viewport retains sidebar width and both reading floors", async ({ window, app }) => {
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(880, 900));
	await expect.poll(async () => Math.round((await widths(window))[0])).toBe(300);
	await expect.poll(async () => (await widths(window)).slice(1, 3).map(Math.round)).toEqual([200, 320]);
	const overflow = await window.locator(".shell-panel-group").evaluate((el) => {
		const parent = el.parentElement!;
		return { scrolls: parent.scrollWidth > parent.clientWidth, mode: getComputedStyle(parent).overflowX };
	});
	expect(overflow).toEqual({ scrolls: true, mode: "auto" });
	expect(await window.evaluate(() => localStorage.getItem("pid:list-width"))).toBe("300");
});
