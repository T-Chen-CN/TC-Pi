import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { resolveInstallPaths } = loadTsCommonJs("src/main/storage/installPaths.ts");
function boot(paths) {
	const calls = [],
		errors = [];
	const { initializeInstallationStorage } = loadTsCommonJs("src/main/storage/installationBootstrap.ts", {
		stubs: { electron: { app: { setPath: (name, path) => calls.push([name, path]), setAppLogsPath: (path) => calls.push(["logs", path]), exit: (code) => calls.push(["exit", code]) }, dialog: { showErrorBox: (...args) => errors.push(args) } } },
	});
	initializeInstallationStorage(paths, { desktopSources: [], piSource: join(paths.root, "nonexistent-legacy"), skipMigration: true });
	return { calls, errors };
}
test("bootstrap configures browser, temp, logs and Pi before any runtime is constructed", () => {
	const env = { ...process.env };
	try {
		const root = mkdtempSync(join(tmpdir(), "tc-pi-boot-test-"));
		const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "app.exe"), appPath: "unused" });
		const result = boot(paths);
		assert.deepEqual(result.errors, []);
		assert.ok(result.calls.some(([name, value]) => name === "sessionData" && value === paths.browser));
		assert.ok(result.calls.some(([name, value]) => name === "userData" && value === paths.desktop));
		assert.equal(process.env.PI_CODING_AGENT_DIR, paths.piAgent);
		assert.equal(process.env.npm_config_prefix, join(paths.runtimes, "pi-global"));
		const piSettings = JSON.parse(readFileSync(join(paths.piAgent, "settings.json"), "utf8"));
		assert.ok(piSettings.npmCommand.every((path) => path.startsWith(paths.runtimes)));
		assert.ok(piSettings.skills.includes(paths.agentsSkills.split("\\").join("/")));
		assert.ok(piSettings.skills.some((rule) => rule.startsWith("-") && rule.endsWith("/.agents/skills/**")));
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
		Object.assign(process.env, env);
	}
});
test("unwritable installation reports a startup error and never switches to AppData", () => {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-boot-error-"));
	const file = join(root, "not-a-directory");
	writeFileSync(file, "data");
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(file, "app.exe"), appPath: "unused" });
	const result = boot(paths);
	assert.equal(result.errors.length, 1);
	assert.deepEqual(result.calls, [["exit", 1]]);
});

test("linked data directories are rejected before anything is written outside the installation", () => {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-boot-link-")),
		outside = join(root, "outside"),
		install = join(root, "install");
	mkdirSync(outside);
	mkdirSync(install);
	symlinkSync(outside, join(install, "data"), process.platform === "win32" ? "junction" : "dir");
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(install, "app.exe"), appPath: "unused" });
	const result = boot(paths);
	assert.equal(result.errors.length, 1);
	assert.deepEqual(readdirSync(outside), []);
});
