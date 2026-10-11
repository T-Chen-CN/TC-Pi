import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const mapping = loadTsCommonJs("src/main/config/piProviderConfig.ts");

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
