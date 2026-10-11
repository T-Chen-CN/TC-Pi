import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

test("desktop API exposes no operations for retired backends or vision bridge", () => {
	let api;
	loadTsCommonJs("src/preload/index.ts", {
		stubs: {
			electron: {
				contextBridge: {
					exposeInMainWorld: (_name, value) => {
						api = value;
					},
				},
				ipcRenderer: { send() {}, invoke() {}, on() {}, removeListener() {} },
				webUtils: {},
			},
		},
	});
	assert.ok(api);
	assert.equal("acp" in api, false);
	for (const name of Object.keys(api.sessions)) assert.doesNotMatch(name, /dsh/i);
	for (const name of Object.keys(api.config)) assert.doesNotMatch(name, /vision|ProviderMigration/);
	assert.equal(typeof api.sessions.createDraft, "function");
	assert.equal(typeof api.projects.listModelsReport, "function");
});

test("retired operation channels are absent while pi and local resource contracts remain", () => {
	const { ipcChannels } = loadTsCommonJs("src/shared/ipc.ts");
	for (const channel of Object.values(ipcChannels)) assert.doesNotMatch(channel, /^(?:dsh|dsh-runtime|acp|vision|pet|floating-ball|prompt-store|skill-store|skill-hub):/);
	assert.equal(ipcChannels.sessionsCatalogCreateDraft, "sessions:catalog-create-draft");
	assert.equal(ipcChannels.promptsList, "prompts:list");
});

test("proxy policy exposes pi session controls without the retired shared host operations", () => {
	const policy = loadTsCommonJs("src/main/sessions/sessionProxyPolicy.ts");
	for (const name of ["aggregateDshProxyMode", "resolveDshHostProxyMode", "buildHostProxyEnvPatch", "applyProxyEnvPatch"]) assert.equal(name in policy, false, name);
	const settings = { piProxyEnabled: true, piProxyUrl: "http://127.0.0.1:7890", piProxyBypass: "localhost" };
	assert.equal(policy.applyPiProxyMode(settings, "off").piProxyEnabled, false);
	assert.equal(policy.buildPiProxyEnvPatch(settings).NODE_USE_ENV_PROXY, "1");
});

test("CI and source assets contain no retired desktop pet or prompt database", () => {
	assert.doesNotMatch(readFileSync(".github/workflows/ci.yml", "utf8"), /pet-linux-smoke|pet-smoke\.cjs/);
	for (const path of ["resources/xueprompts.db", "build/pets/clawd-3/spritesheet.webp", "scripts/acpLiveSmoke.mjs", "scripts/runtime-prune-rules.mjs", "tests/cua/cuaApprovalQueue.test.mjs"]) assert.equal(existsSync(path), false, path);
});

test("default E2E has no retired backend activation or Feishu UI tests", () => {
	for (const name of ["dsh-models", "dsh-provider-add", "dsh-restart", "dsh-security-plan", "dsh-title-diag", "session-manager-dsh-archive", "feishu-link"]) assert.equal(existsSync(`e2e/${name}.spec.ts`), false, name);
});

test("current session menus do not offer copy/export for retired backend records", () => {
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");
	assert.match(app, /canCopySession:\s*canRename\s*&&\s*isSupportedBackend\(record\.backend\)/);
	assert.match(app, /canExportHtml:\s*canRename\s*&&\s*isSupportedBackend\(record\.backend\)/);
	const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarComponents.tsx", "utf8");
	assert.match(sidebar, /isSupportedBackend\(props\.menu\.session\.backend\)/);
});

test("removed runtime maintenance modules stay absent and automation uses shared prompt protocol", () => {
	for (const file of ["src/main/logging/RpcLogLiveBroadcaster.ts", "scripts/dump-typert-endpoints.mjs", "scripts/pwsh-persistent-smoke.mjs", "scripts/local-package-build.mjs", "docs/pideck-cua-implementation-plan.md"]) assert.equal(existsSync(file), false, file);
	assert.doesNotMatch(readFileSync("src/main/automation/AutomationRunCoordinator.ts", "utf8"), /from\s*["'][^"']*renderer\//);
});

test("provider startup warmup only requests the supported pi configuration", async () => {
	const effects = [];
	const backends = [];
	const { useProviderUsageStartupWarmup } = loadTsCommonJs("src/renderer/src/hooks/useProviderUsage.ts", {
		stubs: {
			react: { useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn), useRef: (current) => ({ current }) },
			jotai: { useAtomValue: () => ({}), useSetAtom: () => () => {} },
			"../desktopApi": {
				desktopApi: {
					config: {
						listUsageProbeStates: async ({ backend }) => {
							backends.push(backend);
							return { providers: {}, errors: [] };
						},
					},
				},
			},
			"../atoms/provider-usage-atoms": {},
		},
	});
	useProviderUsageStartupWarmup();
	for (const effect of effects) effect();
	await Promise.resolve();
	assert.deepEqual(backends, ["pi"]);
});
