/** Pi provider snapshots, credential selection and non-destructive configuration merging. */
import type { PiAuthItem, PiModelItem, PiProviderConfig } from "./ConfigManager";

/** Pi provider configuration snapshot and non-destructive merge contract. */
export type ProviderCompatFlags = {
	supportsDeveloperRole?: boolean;
	requiresReasoningContentOnAssistantMessages?: boolean;
};

/** Pi provider configuration snapshot and non-destructive merge contract. */
function asCompatRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return { ...(value as Record<string, unknown>) };
}

export type PiProviderSnapshot = {
	name: string;
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	/** models.json 里该 provider 的 compat（已收窄为两边都认的白名单子集）。 */
	compat?: ProviderCompatFlags;
	models: PiModelItem[];
	/** Pi provider configuration snapshot and non-destructive merge contract. */
	catalogOnly?: boolean;
};

export function isSafeProviderName(name: unknown): name is string {
	return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 80 && !/[\\/]/.test(name) && !name.includes("..");
}

/** Pi provider configuration snapshot and non-destructive merge contract. */
export type PiBuiltinCatalogView = {
	byProviderId: Map<
		string,
		Map<
			string,
			{
				id: string;
				name?: string;
				contextWindow?: number;
				maxTokens?: number;
				reasoning?: boolean;
				input?: string[];
				api?: string;
				baseUrl?: string;
			}
		>
	>;
};

/** Pi provider configuration snapshot and non-destructive merge contract. */
export function piBuiltinSnapshotFromCatalog(name: string, apiKey: string | undefined, catalog: PiBuiltinCatalogView): PiProviderSnapshot | undefined {
	const inner = catalog.byProviderId.get(name);
	if (!inner || inner.size === 0) return undefined;
	const entries = [...inner.values()];
	const first = entries[0];
	if (!first) return undefined;
	const models: PiModelItem[] = [];
	for (const entry of entries) {
		const row: PiModelItem = { id: entry.id.trim() };
		if (typeof entry.name === "string" && entry.name.trim()) row.name = entry.name.trim();
		if (entry.contextWindow != null) row.contextWindow = entry.contextWindow;
		if (entry.maxTokens != null) row.maxTokens = entry.maxTokens;
		if (entry.reasoning === true) row.reasoning = true;
		if (entry.input && entry.input.length > 0) row.input = entry.input;
		models.push(row);
	}
	return {
		name: name.trim(),
		baseUrl: typeof first.baseUrl === "string" ? first.baseUrl.trim() : undefined,
		api: typeof first.api === "string" ? first.api.trim() : "openai-completions",
		apiKey: apiKey?.trim() || undefined,
		models,
		catalogOnly: true,
	};
}

export function resolvePiApiKey(provider: PiProviderConfig | undefined, auth: PiAuthItem | undefined): string | undefined {
	const inline = typeof provider?.apiKey === "string" ? provider.apiKey.trim() : "";
	if (inline) return inline;
	const fromAuth = typeof auth?.key === "string" ? auth.key.trim() : "";
	if (fromAuth) return fromAuth;
	// OAuth 凭据（type:"oauth"，Codex/xAI/Copilot 等消费者订阅）：access token 就是 pi
	// 会话里实际使用的凭据，用量/余额端点接受同一 Bearer token。放在最后兜底，避免
	// 覆盖有显式 key 的 provider；凭据不完整（无 access）时返回 undefined，由上层快速失败。
	if (auth && typeof auth === "object" && auth.type === "oauth") {
		const access = typeof auth.access === "string" ? auth.access.trim() : "";
		if (access) return access;
	}
	return undefined;
}

export function mergePiProvider(
	models: { providers: Record<string, PiProviderConfig> },
	auth: Record<string, PiAuthItem>,
	snapshot: PiProviderSnapshot,
): {
	models: { providers: Record<string, PiProviderConfig> };
	auth: Record<string, PiAuthItem>;
} {
	const existing = models.providers[snapshot.name];
	// Overlay supplied compatibility values without dropping hand-written pi options.
	const mergedCompat = snapshot.compat ? { ...asCompatRecord(existing?.compat), ...snapshot.compat } : undefined;
	const nextModels = {
		providers: {
			...models.providers,
			[snapshot.name]: {
				...(existing ?? { models: [] }),
				baseUrl: snapshot.baseUrl,
				api: snapshot.api,
				models: snapshot.models,
				...(snapshot.headers ? { headers: snapshot.headers } : {}),
				...(mergedCompat ? { compat: mergedCompat } : {}),
			},
		},
	};
	const nextAuth = { ...auth };
	if (snapshot.apiKey) {
		// 密钥内联写进 models.json，与 PiDeck 配置弹窗 ModelsTab 保持一致
		// （该编辑器只读/写 provider.apiKey，不读 auth.json）。
		// 此前迁移把 key 搬进 auth.json 并从 models.json 删除，导致迁移后
		// Models 页 key 显示为空、字段看似丢失，且编辑器再保存会把空键写回。
		nextModels.providers[snapshot.name] = {
			...nextModels.providers[snapshot.name],
			apiKey: snapshot.apiKey,
		};
	}
	return { models: nextModels, auth: nextAuth };
}
