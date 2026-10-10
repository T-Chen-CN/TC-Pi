import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const mapping = loadTsCommonJs("src/main/config/providerMigration.ts");

test("credentialRefFor uses explicit env then derived ROUTE_API_KEY", () => {
	assert.equal(mapping.credentialRefFor({ apiKeyEnv: "MY_KEY" }, "weishiair"), "MY_KEY");
	assert.equal(mapping.credentialRefFor({}, "opencode-go"), "OPENCODE_GO_API_KEY");
});

test("legacy provider route names get valid unique credential refs", () => {
	const first = mapping.credentialRefFor({}, "输入");
	const second = mapping.credentialRefFor({}, "供应商");
	assert.match(first, /^PIDECK_[0-9A-F]{8}_API_KEY$/);
	assert.match(second, /^[A-Za-z_][A-Za-z0-9_]*$/);
	assert.notEqual(first, second);
});
test("pi custom gateway maps into llm-pi-ai with catalog fields only", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "weishiair",
		baseUrl: "https://api.weishiair.de/v1",
		api: "openai-completions",
		apiKey: "sk-test",
		headers: { "User-Agent": "pideck" },
		models: [
			{
				id: "grok-4.6",
				name: "grok-4.6",
				contextWindow: 128000,
				input: ["text", "image"],
				reasoning: true,
				thinkingLevelMap: { xhigh: "xhigh", max: "max" },
				cost: { input: 1 },
			},
		],
	});
	assert.equal(dsh.namespace, "llm-pi-ai");
	assert.equal(dsh.profile.baseURL, "https://api.weishiair.de/v1");
	assert.equal(dsh.profile.apiKeyEnv, "WEISHIAIR_API_KEY");
	assert.equal(dsh.profile.models?.length, 1);
	assert.equal(dsh.profile.models?.[0]?.id, "grok-4.6");
	assert.equal(dsh.profile.models?.[0]?.name, "grok-4.6");
	assert.equal(dsh.profile.models?.[0]?.contextWindow, 128000);
	assert.deepEqual(dsh.profile.models?.[0]?.input, ["text", "image"]);
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile.models?.[0]?.reasoningEfforts)), { xhigh: "xhigh", max: "max" });
	assert.equal(dsh.profile.models?.[0]?.cost, undefined);
});

test("dsh custom model round-trips input and reasoningEfforts into Pi metadata", () => {
	const pi = mapping.dshToPiSnapshot({
		name: "组",
		namespace: "llm-pi-ai",
		profile: {
			api: "openai-responses",
			models: [
				{
					id: "gpt-5.6-terra",
					input: ["text", "image"],
					reasoningEfforts: { xhigh: "xhigh", max: "max" },
				},
			],
		},
	});
	assert.deepEqual(JSON.parse(JSON.stringify(pi.models)), [
		{
			id: "gpt-5.6-terra",
			input: ["text", "image"],
			reasoning: true,
			thinkingLevelMap: { xhigh: "xhigh", max: "max" },
		},
	]);
});

// 回归：pi 的 thinkingLevelMap null 表恒等（发档位名本身），DSH 校验除 off 外每档必须
// 给非空 wire 值（settings-rejected: "needs the wire value dispatch should send"）。
// 迁移必须把非 off 档的 null 展开为档位名，否则 settings.update 被 DSH 拒。
test("pi null thinkingLevelMap entries expand to identity wire values for DSH", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "tr",
		baseUrl: "https://x/v1",
		apiKey: "sk-test",
		models: [
			{
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				contextWindow: 1000000,
				maxTokens: 384000,
				reasoning: true,
				input: ["text"],
				thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high" },
			},
		],
	});
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile.models?.[0]?.reasoningEfforts)), {
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
	});
});

test("off null stays null; off-only map becomes false (DSH rejects off-only efforts)", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "tr",
		baseUrl: "https://x/v1",
		apiKey: "sk-test",
		models: [
			{ id: "m1", reasoning: true, thinkingLevelMap: { off: null, xhigh: null, max: "max" } },
			{ id: "m2", reasoning: true, thinkingLevelMap: { off: "none" } },
			{ id: "m3", reasoning: true, thinkingLevelMap: { off: null } },
		],
	});
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile.models?.[0]?.reasoningEfforts)), {
		off: null,
		xhigh: "xhigh",
		max: "max",
	});
	// 只有 off 档（无思考级别）：按 DSH 官方指引 set false 声明为非思考模型，
	// 否则 settings.update 报 settings-rejected("reasoningEfforts offers no level beyond off")。
	assert.equal(dsh.profile.models?.[1]?.reasoningEfforts, false);
	assert.equal(dsh.profile.models?.[2]?.reasoningEfforts, false);
});

test("official DeepSeek keeps the composition defaults when Pi only supplies its built-in catalog", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "deepseek",
		baseUrl: "https://api.deepseek.com",
		api: "openai-completions",
		apiKey: "sk-ds",
		models: [{ id: "deepseek-v4-flash", input: ["text"] }],
		catalogOnly: true,
	});
	assert.equal(dsh.namespace, "llm-deepseek");
	// DSH's direct adapter already owns its endpoint, credential reference and catalog.
	// Migrating an auth.json-only Pi builtin must not materialize a user settings override.
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile)), {});
	const merged = mapping.mergeDshProviderIntoSettings({ "ui-onboarding": { welcomeNoticeVersion: "keep-me" } }, dsh);
	assert.equal(merged["llm-deepseek"], undefined);
	assert.equal(merged["ui-onboarding"].welcomeNoticeVersion, "keep-me");
});

test("explicit official DeepSeek model overrides use the direct-adapter schema", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "deepseek",
		baseUrl: "https://api.deepseek.com/v1",
		api: "openai-completions",
		models: [
			{
				id: "private-vision",
				name: "Private Vision",
				contextWindow: 512000,
				maxTokens: 64000,
				input: ["text", "image"],
				reasoning: true,
				thinkingLevelMap: { high: "high" },
			},
		],
	});
	assert.equal(dsh.namespace, "llm-deepseek");
	assert.equal(dsh.profile.api, undefined);
	assert.equal(dsh.profile.apiKeyEnv, undefined);
	assert.equal(dsh.profile.baseURL, undefined);
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile.models)), [
		{
			id: "private-vision",
			name: "Private Vision",
			contextWindow: 512000,
			maxTokens: 64000,
			inputModalities: ["text", "image"],
		},
	]);
});

test("dsh settings yaml parse + merge keeps sibling namespaces", () => {
	const parsed = mapping.parseDshSettingsDocument({
		"ui-onboarding": { welcomeNoticeVersion: "1" },
		"llm-pi-ai": {
			providers: {
				weishiair: { baseURL: "https://api.weishiair.de/v1", models: [{ id: "grok-4.6" }] },
			},
		},
	});
	assert.equal(parsed.piAi.weishiair.baseURL, "https://api.weishiair.de/v1");
	const next = mapping.mergeDshProviderIntoSettings(
		{ "ui-onboarding": { welcomeNoticeVersion: "1" }, "llm-pi-ai": { providers: { old: {} } } },
		{
			name: "weishiair",
			namespace: "llm-pi-ai",
			profile: { baseURL: "https://api.weishiair.de/v1", apiKeyEnv: "WEISHIAIR_API_KEY" },
		},
	);
	assert.equal(next["ui-onboarding"].welcomeNoticeVersion, "1");
	assert.ok(next["llm-pi-ai"].providers.old);
	assert.equal(next["llm-pi-ai"].providers.weishiair.baseURL, "https://api.weishiair.de/v1");
});

test("mergePiProvider writes the api key inline into models.json (ModelsTab-compatible)", () => {
	const merged = mapping.mergePiProvider(
		{ providers: {} },
		{},
		{
			name: "weishiair",
			baseUrl: "https://api.weishiair.de/v1",
			api: "openai-completions",
			apiKey: "sk-test",
			models: [{ id: "grok-4.6" }],
		},
	);
	// 密钥内联进 models.json：PiDeck 的 ModelsTab 只读/写 provider.apiKey，
	// 若只写 auth.json 会让迁移后的 key 在 Models 页显示为空。
	assert.equal(merged.models.providers.weishiair.apiKey, "sk-test");
	assert.equal(merged.auth.weishiair, undefined);
});

test("unsafe provider names are rejected", () => {
	assert.equal(mapping.isSafeProviderName("../etc"), false);
	assert.equal(mapping.isSafeProviderName("weishiair"), true);
});

test("pi→DSH 迁移携带 compat 白名单（DeepSeek 中转站的 400 修复项）", () => {
	const dsh = mapping.piToDshSnapshot({
		name: "ai88",
		baseUrl: "https://88api.ai/v1",
		api: "openai-completions",
		compat: {
			supportsDeveloperRole: false,
			requiresReasoningContentOnAssistantMessages: true,
			// 下面两个键不在 dsh-llm-pi-ai 的 compat 提供清单里：写进 settings.yaml 会被
			// dsh 的 COMPLETIONS_COMPAT_GATE 判为 "not offered" → 整条 settings.update 被拒
			thinkingFormat: "deepseek",
			openRouterRouting: { only: ["x"] },
		},
		models: [{ id: "deepseek-v4.1-flash" }],
	});
	assert.equal(dsh.namespace, "llm-pi-ai");
	assert.deepEqual(JSON.parse(JSON.stringify(dsh.profile.compat)), {
		supportsDeveloperRole: false,
		requiresReasoningContentOnAssistantMessages: true,
	});
});

test("pi→DSH 迁移：anthropic 协议与非法值不写 compat", () => {
	// anthropic-messages 的 compat 由 dsh 各适配器自己决定，pi 侧的取值不能直接搬
	const anthropic = mapping.piToDshSnapshot({
		name: "claude-relay",
		api: "anthropic-messages",
		compat: { supportsDeveloperRole: false, requiresReasoningContentOnAssistantMessages: true },
		models: [],
	});
	assert.equal(anthropic.profile.compat, undefined);
	// 手改坏的类型（字符串/数字）不收窄，宁可不写也不把非法值甩给 dsh schema
	const garbage = mapping.piToDshSnapshot({
		name: "g",
		api: "openai-completions",
		compat: { supportsDeveloperRole: "false", requiresReasoningContentOnAssistantMessages: 1 },
		models: [],
	});
	assert.equal(garbage.profile.compat, undefined);
});

test("DSH→pi 迁移：llm-pi-ai 的 compat 回填，官方直连适配器不搬", () => {
	const pi = mapping.dshToPiSnapshot({
		name: "ai88",
		namespace: "llm-pi-ai",
		profile: {
			compat: {
				supportsDeveloperRole: false,
				requiresReasoningContentOnAssistantMessages: true,
				chatTemplateKwargs: { x: 1 },
			},
		},
	});
	assert.deepEqual(JSON.parse(JSON.stringify(pi.compat)), {
		supportsDeveloperRole: false,
		requiresReasoningContentOnAssistantMessages: true,
	});
	// llm-deepseek 是 schema 严格的直连适配器，compat 不进 pi 侧
	const official = mapping.dshToPiSnapshot({
		name: "deepseek",
		namespace: "llm-deepseek",
		profile: { compat: { supportsDeveloperRole: false } },
	});
	assert.equal(official.compat, undefined);
});

test("mergePiProvider compat：只覆盖白名单键，保留 pi 侧其它 compat；未携带时保留原值", () => {
	const base = {
		providers: {
			ai88: { models: [{ id: "m" }], compat: { thinkingFormat: "deepseek", supportsDeveloperRole: true } },
		},
	};
	const merged = mapping.mergePiProvider(
		base,
		{},
		{
			name: "ai88",
			baseUrl: "https://88api.ai/v1",
			api: "openai-completions",
			compat: { supportsDeveloperRole: false, requiresReasoningContentOnAssistantMessages: true },
			models: [{ id: "m" }],
		},
	);
	assert.deepEqual(JSON.parse(JSON.stringify(merged.models.providers.ai88.compat)), {
		thinkingFormat: "deepseek",
		supportsDeveloperRole: false,
		requiresReasoningContentOnAssistantMessages: true,
	});
	// 对方未携带 compat（如 llm-deepseek 源）时不能把已有 compat 抹掉
	const untouched = mapping.mergePiProvider(
		base,
		{},
		{
			name: "ai88",
			api: "openai-completions",
			models: [{ id: "m" }],
		},
	);
	assert.deepEqual(JSON.parse(JSON.stringify(untouched.models.providers.ai88.compat)), {
		thinkingFormat: "deepseek",
		supportsDeveloperRole: true,
	});
});

test("pi↔DSH 往返：手写的 supportsStrictMode 不随迁移丢失（白名单外，回写时以原 compat 打底）", () => {
	const piProvider = {
		name: "ai88",
		baseUrl: "https://88api.ai/v1",
		api: "openai-completions",
		compat: { supportsDeveloperRole: false, supportsStrictMode: false },
		models: [{ id: "m" }],
	};
	// pi→DSH：DSH 协议没提供这个键，带过去会让整条 settings.update 被拒，所以不收窄进 profile
	const dsh = mapping.piToDshSnapshot(piProvider);
	assert.ok(!("supportsStrictMode" in (dsh.profile.compat ?? {})));
	// DSH→pi 回写：合并以原 compat 为底，用户关掉的开关必须留存，
	// 否则一次配置迁移就把「修中转站漏工具调用」的开关静默打开了。
	const back = mapping.dshToPiSnapshot({ name: "ai88", namespace: "llm-pi-ai", profile: dsh.profile });
	const merged = mapping.mergePiProvider(
		{
			providers: {
				ai88: { models: [{ id: "m" }], compat: { supportsDeveloperRole: true, supportsStrictMode: false } },
			},
		},
		{},
		back,
	);
	assert.equal(merged.models.providers.ai88.compat.supportsStrictMode, false);
});

test("parseDshSettingsDocument 保留 compat，且丢弃未收窄字段", () => {
	const parsed = mapping.parseDshSettingsDocument({
		"llm-pi-ai": {
			providers: {
				ai88: {
					baseURL: "https://88api.ai/v1",
					compat: {
						supportsDeveloperRole: false,
						requiresReasoningContentOnAssistantMessages: true,
						openRouterRouting: { only: ["x"] },
					},
				},
			},
		},
	});
	assert.deepEqual(JSON.parse(JSON.stringify(parsed.piAi.ai88.compat)), {
		supportsDeveloperRole: false,
		requiresReasoningContentOnAssistantMessages: true,
	});
});

test("piBuiltinSnapshotFromCatalog builds a Pi snapshot from the catalog view", () => {
	const catalog = {
		byProviderId: new Map([
			[
				"openrouter",
				new Map([
					["stealth/ox-alpha", { id: "stealth/ox-alpha", name: "Ox Alpha", contextWindow: 1048576, api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", input: ["text", "image"], reasoning: true }],
					["deepseek/deepseek-chat", { id: "deepseek/deepseek-chat" }],
				]),
			],
		]),
	};
	const snapshot = mapping.piBuiltinSnapshotFromCatalog("openrouter", "  sk-or-1  ", catalog);
	assert.ok(snapshot);
	assert.equal(snapshot.name, "openrouter");
	assert.equal(snapshot.baseUrl, "https://openrouter.ai/api/v1");
	assert.equal(snapshot.api, "openai-completions");
	assert.equal(snapshot.apiKey, "sk-or-1");
	assert.equal(snapshot.models.length, 2);
	assert.equal(snapshot.models[0].id, "stealth/ox-alpha");
	assert.equal(snapshot.models[0].contextWindow, 1048576);
	assert.deepEqual(snapshot.models[0].input, ["text", "image"]);
});

test("piBuiltinSnapshotFromCatalog returns undefined when the catalog has no models", () => {
	const catalog = { byProviderId: new Map([["openrouter", new Map()]]) };
	assert.equal(mapping.piBuiltinSnapshotFromCatalog("openrouter", "sk", catalog), undefined);
	assert.equal(mapping.piBuiltinSnapshotFromCatalog("unknown", "sk", catalog), undefined);
});

test("mergeCredentialDocument writes dsh-credentials-local v1 layout (version:1 + refs)", () => {
	// 空文档 → v1
	const fromEmpty = mapping.mergeCredentialDocument("", "DEEPSEEK_API_KEY", "sk-abc");
	const parsedEmpty = JSON.parse(JSON.stringify(mapping.loadYamlObject(fromEmpty)));
	assert.equal(parsedEmpty.version, 1);
	assert.equal(parsedEmpty.refs.DEEPSEEK_API_KEY, "sk-abc");

	// 旧扁平布局 → 迁入 refs 层，输出 v1
	const fromFlat = mapping.mergeCredentialDocument(["DEEPSEEK_API_KEY: sk-old", "WBX_API_KEY: sk-wbx", ""].join("\n"), "WBX_API_KEY", "sk-wbx-new");
	const parsedFlat = JSON.parse(JSON.stringify(mapping.loadYamlObject(fromFlat)));
	assert.equal(parsedFlat.version, 1);
	assert.equal(parsedFlat.refs.DEEPSEEK_API_KEY, "sk-old");
	assert.equal(parsedFlat.refs.WBX_API_KEY, "sk-wbx-new");

	// 已是 v1 → 只改 refs 层，保留 records
	const fromV1 = mapping.mergeCredentialDocument(["version: 1", "refs:", "  A_KEY: sk-a", "records:", "  r: x", ""].join("\n"), "A_KEY", "sk-a-new");
	const parsedV1 = JSON.parse(JSON.stringify(mapping.loadYamlObject(fromV1)));
	assert.equal(parsedV1.version, 1);
	assert.equal(parsedV1.refs.A_KEY, "sk-a-new");
	assert.equal(parsedV1.records.r, "x");
});
test("resolvePiApiKey 优先内联 key，其次 auth.key，OAuth 凭据兜底读 access", () => {
	// 内联 apiKey 优先
	assert.equal(mapping.resolvePiApiKey({ apiKey: "inline-key" }, undefined), "inline-key");
	// auth.key 次之
	assert.equal(mapping.resolvePiApiKey({}, { type: "api_key", key: "auth-key" }), "auth-key");
	// OAuth 凭据（type:oauth）没有 key 时兜底 access（Codex/xAI/Copilot 消费者订阅用量查询用）
	assert.equal(mapping.resolvePiApiKey({}, { type: "oauth", access: "oauth-access", refresh: "r", expires: 1 }), "oauth-access");
	// 非 oauth 类型没有 access 不误读
	assert.equal(mapping.resolvePiApiKey({}, { type: "api_key", key: "k" }), "k");
	// oauth 凭据缺 access 返回 undefined
	assert.equal(mapping.resolvePiApiKey({}, { type: "oauth", refresh: "r", expires: 1 }), undefined);
	// 无任何凭据返回 undefined
	assert.equal(mapping.resolvePiApiKey(undefined, undefined), undefined);
});
