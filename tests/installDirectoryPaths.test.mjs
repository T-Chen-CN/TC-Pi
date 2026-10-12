import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { resolveInstallPaths, installRuntimeEnvironment } = loadTsCommonJs("src/main/storage/installPaths.ts");
const { getWslAgentDir, managedWslEnvironment } = loadTsCommonJs("src/main/storage/piPaths.ts");

test("installed Windows application keeps every managed path beside its executable", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "D:\\Apps\\TC-Pi\\TC-Pi.exe", appPath: "D:\\Apps\\TC-Pi\\resources\\app.asar", platform: "win32" });
	assert.equal(paths.root, "D:\\Apps\\TC-Pi");
	assert.equal(paths.desktop, "D:\\Apps\\TC-Pi\\data\\desktop");
	assert.equal(paths.piAgent, "D:\\Apps\\TC-Pi\\data\\pi");
	assert.equal(paths.runtimes, "D:\\Apps\\TC-Pi\\runtimes");
	for (const value of Object.values(paths)) assert.ok(value === paths.root || value.startsWith(paths.root + "\\"));
});

test("portable root uses the original executable location rather than its extraction directory", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "C:\\Temp\\extract\\TC-Pi.exe", appPath: "C:\\Temp\\extract\\resources\\app.asar", platform: "win32", portableDir: "E:\\TC-Pi" });
	assert.equal(paths.root, "E:\\TC-Pi");
});

test("development profiles are project-local and isolated by branch", () => {
	const base = { isPackaged: false, exePath: "C:\\node_modules\\electron\\electron.exe", appPath: "F:\\Project", platform: "win32" };
	const a = resolveInstallPaths({ ...base, devProfile: "feature-a" });
	const b = resolveInstallPaths({ ...base, devProfile: "feature-b" });
	assert.ok(a.root.startsWith("F:\\Project\\.tc-pi-dev\\"));
	assert.notEqual(a.desktop, b.desktop);
	assert.notEqual(a.piAgent, b.piAgent);
});

test("unsafe development profile cannot escape the project", () => {
	assert.throws(() => resolveInstallPaths({ isPackaged: false, exePath: "/node/electron", appPath: "/project", devProfile: "../outside", platform: "linux" }));
});

test("child environment overrides inherited global Pi and package-manager storage paths", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "/apps/tc-pi/tc-pi", appPath: "/apps/tc-pi/resources/app.asar", platform: "linux" });
	const env = installRuntimeEnvironment(paths, { HOME: "/home/me", PI_CODING_AGENT_DIR: "/old/pi", PI_MANAGED_INSTALL_ROOT: "/old/install", PI_PACKAGE_DIR: "/old/package", npm_config_cache: "/old/npm" });
	assert.equal(env.PI_CODING_AGENT_DIR, paths.piAgent);
	assert.equal(env.npm_config_cache, paths.npmCache);
	assert.equal(env.TEMP, paths.temp);
	assert.equal(env.HOME, "/home/me");
	assert.equal(env.TC_PI_INSTALL_ROOT, paths.root);
	assert.equal(paths.root, "/apps/tc-pi");
	assert.equal(env.npm_config_prefix, "/apps/tc-pi/runtimes/pi-global");
	assert.equal(env.PI_MANAGED_INSTALL_ROOT, undefined);
	assert.equal(env.PI_PACKAGE_DIR, undefined);
});

test("macOS mutable data lives beside the signed application bundle", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "/Users/me/Apps/TC-Pi.app/Contents/MacOS/TC-Pi", appPath: "/Users/me/Apps/TC-Pi.app/Contents/Resources/app.asar", platform: "darwin" });
	assert.equal(paths.root, "/Users/me/Apps/TC-Pi");
	assert.equal(paths.desktop, "/Users/me/Apps/TC-Pi/data/desktop");
});

test("Linux AppImage data uses its original location rather than its mount directory", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "/tmp/.mount-tc-pi/AppRun", appPath: "/tmp/.mount-tc-pi/resources/app.asar", appImage: "/home/me/apps/TC-Pi.AppImage", platform: "linux" });
	assert.equal(paths.root, "/home/me/apps");
});

test("WSL shares private storage paths but keeps its npm prefix separate from Windows", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "D:\\Apps\\TC-Pi\\TC-Pi.exe", appPath: "unused", platform: "win32" });
	const env = managedWslEnvironment(installRuntimeEnvironment(paths, { PATH: "C:\\Windows\\System32", HOME: "/home/me" }), "My Distro");
	assert.equal(env.PI_CODING_AGENT_DIR, getWslAgentDir("My Distro", paths.data));
	assert.ok(env.npm_config_prefix.includes("wsl"));
	assert.ok(env.npm_config_prefix.startsWith(paths.runtimes));
	assert.ok(env.WSLENV.includes("PI_CODING_AGENT_DIR/p"));
	assert.ok(env.WSLENV.includes("GIT_CONFIG_GLOBAL/p"));
	assert.equal(env.HOME, "/home/me");
	assert.throws(() => getWslAgentDir("../escape", paths.data));
	assert.throws(() => getWslAgentDir("..", paths.data));
});

test("native child PATH prefers owned Node, Pi and Git while retaining external project tools", () => {
	const paths = resolveInstallPaths({ isPackaged: true, exePath: "D:\\Apps\\TC-Pi\\TC-Pi.exe", appPath: "unused", platform: "win32" });
	const env = installRuntimeEnvironment(paths, { PATH: "D:\\ProjectTools", HOME: "C:\\Users\\me" });
	assert.ok(env.PATH.startsWith("D:\\Apps\\TC-Pi\\runtimes\\node;"));
	assert.ok(env.PATH.includes("D:\\Apps\\TC-Pi\\runtimes\\git\\cmd;"));
	assert.ok(env.PATH.endsWith("D:\\ProjectTools"));
	assert.equal(env.Path, env.PATH);
});
