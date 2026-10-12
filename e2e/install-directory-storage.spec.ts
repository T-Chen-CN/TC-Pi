import { test, expect } from "./fixtures";

test("all managed storage stays in the explicit isolated installation root", async ({ app, userDataRoot, window }) => {
	await expect(window.locator("body")).toBeVisible();
	const snapshot = await app.evaluate(({ app }) => ({
		userData: app.getPath("userData"),
		browser: app.getPath("sessionData"),
		temp: app.getPath("temp"),
		logs: app.getPath("logs"),
		pi: process.env.PI_CODING_AGENT_DIR,
		runtime: process.env.TC_PI_RUNTIME_ROOT,
		npm: process.env.npm_config_cache,
		update: process.env.TC_PI_DATA_ROOT,
	}));
	for (const value of Object.values(snapshot)) expect(value?.startsWith(userDataRoot)).toBe(true);
	expect(snapshot.browser).not.toEqual(snapshot.userData);
	expect(snapshot.pi).not.toEqual(snapshot.userData);
});
