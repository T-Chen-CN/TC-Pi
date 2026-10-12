import { test, expect } from "./fixtures";

/** 使用隔离的 Electron 配置验证产品名、大小写与关于入口，避免触碰真实用户数据。 */
test.describe("TC-Pi product identity", () => {
	test.use({ seedSettings: { language: "zh-CN", theme: "light", piEnvironmentChecked: true, standbyRuntimeEnabled: false } });

	test("desktop chrome and about panel retain the exact TC-Pi spelling in both themes", async ({ window, app }) => {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
		await window.emulateMedia({ reducedMotion: "reduce" });
		expect(await app.evaluate(({ app }) => app.getName())).toBe("TC-Pi");
		await expect(window).toHaveTitle(/TC-Pi/);
		const wordmark = window.locator(".brand-wordmark");
		await expect(wordmark).toHaveText("TC-Pi");
		expect(await wordmark.evaluate((element) => getComputedStyle(element).textTransform)).not.toBe("uppercase");
		await expect(window.getByTestId("home-overview")).toContainText("TC-Pi");
		await window.screenshot({ path: "release-preflight/tc-pi-light.png" });
		await window.getByRole("button", { name: "关于 TC-Pi", exact: true }).click();
		await expect(window.getByRole("button", { name: "项目主页", exact: true })).toBeVisible();
		// 长开发分支名不能把产品名挤成两行，按真实文本矩形验证最终布局。
		const aboutName = window.locator(".text-lg").getByText("TC-Pi", { exact: true });
		await expect
			.poll(() =>
				aboutName.evaluate((element) => {
					const range = document.createRange();
					range.selectNodeContents(element);
					return range.getClientRects().length;
				}),
			)
			.toBe(1);
		await window.screenshot({ path: "release-preflight/tc-pi-about.png" });
		await window.keyboard.press("Escape");
		await window.getByRole("button", { name: /^主题：.*（点击切换）$/ }).click();
		await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect(wordmark).toHaveText("TC-Pi");
		await window.screenshot({ path: "release-preflight/tc-pi-dark.png" });
	});
});
