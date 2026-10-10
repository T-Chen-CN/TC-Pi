import { test, expect } from "./fixtures";

test.use({ seedSettings: { defaultAgentBackend: "dsh", acpEnabled: true, petEnabled: true, floatingBallEnabled: true, cuaEnabled: true, language: "zh-CN" } });

test("removed features stay disabled after loading legacy settings", async ({ window }) => {
	await expect(window.locator(".wechat-shell")).toBeVisible();
	const result = await window.evaluate(async () => {
		const api = window.piDesktop!;
		return { settings: await api.settings.get(), namespaces: Object.keys(api) };
	});
	expect(result.settings.defaultAgentBackend).toBe("pi");
	for (const key of ["acpEnabled", "petEnabled", "floatingBallEnabled", "cuaEnabled"] as const) expect(result.settings[key]).toBe(false);
	for (const name of ["pet", "feishu", "cua", "floatingBall", "miniOverlay", "imagegen", "promptStore", "skillStore", "skillHub", "yaoPrompts"]) expect(result.namespaces).not.toContain(name);
	const environment = window.getByRole("dialog", { name: "Pi 环境检测" });
	await expect(environment).toBeVisible();
	await environment.getByRole("button", { name: "关闭" }).click();
	await window.getByRole("button", { name: /^设置(?:（有新版本可用）)?$/ }).click();
	await expect(window.locator(".settings-modal")).toBeVisible();
	const tabs = await window.locator(".settings-modal [role=tab]").allTextContents();
	for (const label of ["飞书", "桌面宠物", "视觉桥", "生图", "ACP"]) expect(tabs.join(" ")).not.toContain(label);
});
