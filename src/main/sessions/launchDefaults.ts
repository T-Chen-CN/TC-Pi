import type { ResolveLaunchDefaultsInput, ResolvedLaunchDefaults } from "../../shared/types";
import { createSessionModelPreference } from "../../shared/modelDisplayName";
import { modelThinkingLevelOf, parseModelThinkingLevels } from "../../shared/modelThinkingLevels";

export function resolveLaunchDefaultOptions(input: {
	backend?: ResolveLaunchDefaultsInput["backend"];
	settings: unknown;
	models: unknown;
	/** pi 全局目录快照（getCachedModelList：models.json + auth 官方供应商 + models-store 缓存）。
	 *  可选：缓存冷时缺省，存在性校验退回仅 models.json 的旧行为。 */
	catalogModels?: unknown;
	/** 桌面端记录的「用户最后一次使用的模型」（userData/settings.json 的 lastUsedModel）。 */
	lastUsedModel?: unknown;
	/** 渲染层欢迎页（引导页）偏好模型；仅在无显式默认时参与回退。 */
	welcomeModel?: unknown;
}): ResolvedLaunchDefaults {
	const defaults: ResolvedLaunchDefaults = {};
	{
		// 显式默认只解析一次：defaultModelConfigured 仅作「是否存在有效显式默认」的诊断标记
		// 返回（供文案/排查用）；渲染层展示不再拿它当闸门——展示与创建统一按点选优先。
		const explicit = strictModelPair(input.settings, input.models, input.catalogModels);
		if (explicit) defaults.defaultModelConfigured = true;
		// 仅在解析成功时落键：空结果必须是真 {}，调用方才能用 presence 判断是否预选
		// 优先级：引导页点选 > 显式默认 > enabledModels（pi 模型切换列表）> 上次使用 > 空。
		const model = welcomeModelOfModelsConfig(input.welcomeModel, input.models, input.catalogModels) ?? explicit ?? enabledModelsOfModelsConfig(input.settings, input.models, input.catalogModels) ?? lastUsedModelOfModelsConfig(input.lastUsedModel, input.models, input.catalogModels);
		if (model) defaults.model = model;
		// 每模型默认档位表整表回传：引导页改选模型后仍能按「当前展示的模型」查到同一档位。
		const modelThinkingLevels = parseModelThinkingLevels(input.settings);
		if (modelThinkingLevels) defaults.modelThinkingLevels = modelThinkingLevels;
	}
	// 每模型默认优先于全局默认：显式选择（input.thinkingLevel）在调用方，已在此之前判定；
	// 这里只补「没传显式档位」时的缺省，与 createDraft 的最终模型保持一致。
	const thinkingLevel = (defaults.model ? modelThinkingLevelOf(input.settings, defaults.model.provider, defaults.model.modelId) : undefined) ?? optionalString(input.settings, "defaultThinkingLevel");
	if (thinkingLevel) defaults.thinkingLevel = thinkingLevel;
	return defaults;
}

/**
 * settings.defaultProvider/defaultModel 同时为字符串、且两者确实存在于 models.json
 * 才算有效配对（避免半配置进入回退歧义；避免默认指向已删除的供应商/模型）。
 */
function strictModelPair(settings: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	const provider = optionalString(settings, "defaultProvider");
	const modelId = optionalString(settings, "defaultModel");
	if (!provider || !modelId) return undefined;
	return modelPreferenceFromSources(models, catalogModels, provider, modelId);
}

/** 显式传入的 model（如欢迎页偏好）是否存在：不存在视为无效，调用方应回退解析默认。 */
export function isModelInModelsConfig(models: unknown, model: { provider: string; modelId: string }, catalogModels?: unknown): boolean {
	return modelPreferenceFromSources(models, catalogModels, model.provider, model.modelId) !== undefined;
}

/** lastUsedModel（桌面端记录）同样必须仍存在（models.json ∪ pi 目录），删除后自动失效回退。 */
function lastUsedModelOfModelsConfig(lastUsed: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(lastUsed)) return undefined;
	const provider = lastUsed.provider;
	const modelId = lastUsed.modelId;
	if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
	if (!provider || !modelId) return undefined;
	return modelPreferenceFromSources(models, catalogModels, provider, modelId);
}

/** 模型偏好存在性解析：models.json 优先（名称快照与选择器展示一致），pi 目录兜底。 */
function modelPreferenceFromSources(models: unknown, catalogModels: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	return modelPreferenceFromModelsConfig(models, provider, modelId) ?? modelPreferenceFromCatalogList(catalogModels, provider, modelId);
}

/** pi 目录（AvailableModel[] 扁平列表）里的模型偏好；目录形状不可信，逐项收窄。 */
function modelPreferenceFromCatalogList(catalogModels: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	if (!Array.isArray(catalogModels)) return undefined;
	for (const entry of catalogModels) {
		if (!isRecord(entry)) continue;
		if (entry.provider !== provider || entry.id !== modelId) continue;
		return createSessionModelPreference(provider, modelId, typeof entry.name === "string" ? entry.name : undefined);
	}
	return undefined;
}

function modelPreferenceFromModelsConfig(models: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	if (!isRecord(models)) return undefined;
	const providers = models.providers;
	if (!isRecord(providers)) return undefined;
	const providerEntry = providers[provider];
	if (!isRecord(providerEntry) || !Array.isArray(providerEntry.models)) return undefined;
	const model = providerEntry.models.find((candidate) => isRecord(candidate) && candidate.id === modelId);
	if (!isRecord(model)) return undefined;
	return createSessionModelPreference(provider, modelId, model.name);
}

/** 模型是否存在于 models.json（provider 键 + models 数组 id 精确匹配）。 */
function modelExistsInModelsConfig(models: unknown, provider: string, modelId: string): boolean {
	if (!isRecord(models)) return false;
	const providers = models.providers;
	if (!isRecord(providers)) return false;
	const providerEntry = providers[provider];
	if (!isRecord(providerEntry) || !Array.isArray(providerEntry.models)) return false;
	return providerEntry.models.some((model) => isRecord(model) && model.id === modelId);
}

/** 欢迎页偏好模型：必须形如 { provider, modelId } 且仍存在（models.json ∪ pi 目录），否则视为无偏好。 */
function welcomeModelOfModelsConfig(welcome: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(welcome)) return undefined;
	const provider = welcome.provider;
	const modelId = welcome.modelId;
	if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
	if (!provider || !modelId) return undefined;
	if (!modelExistsInModelsConfig(models, provider, modelId) && !modelPreferenceFromCatalogList(catalogModels, provider, modelId)) return undefined;
	// 引导页已在用户点选的瞬间保存名称快照。这里只做存在性校验，不能再次以当前
	// models.json 的别名覆盖它，否则用户配置在两次操作之间更新会让底栏跳变。
	return createSessionModelPreference(provider, modelId, welcome.modelName);
}

/** settings.enabledModels（pi 的 Ctrl+P 模型切换列表，glob 模式，格式同 --models）：
 *  顺序取第一个能在 models.json 中匹配到实际模型的 pattern，返回匹配的模型。
 *  pattern 含 / 视为 provider/modelId（两段各自 glob 匹配），否则按 modelId 匹配任意 provider。 */
function enabledModelsOfModelsConfig(settings: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(settings)) return undefined;
	const enabled = settings.enabledModels;
	if (!Array.isArray(enabled)) return undefined;
	for (const pattern of enabled) {
		if (typeof pattern !== "string" || !pattern) continue;
		const matched = matchEnabledModelPattern(pattern, models, catalogModels);
		if (matched) return matched;
	}
	return undefined;
}

/** 一个 enabledModels pattern 匹配 models.json 中的第一个模型（models.json 顺序优先，pi 目录兜底）。 */
function matchEnabledModelPattern(pattern: string, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	// pattern 含 / 时对应 provider/modelId（两段分别 glob）；bare pattern 只匹配 modelId
	const [patternProvider, patternModelId] = pattern.includes("/") ? pattern.split("/") : [undefined, pattern];
	const localMatch = matchEnabledModelPatternInModelsConfig(patternProvider, patternModelId, models);
	if (localMatch) return localMatch;
	if (!Array.isArray(catalogModels)) return undefined;
	for (const entry of catalogModels) {
		if (!isRecord(entry)) continue;
		const { provider: entryProvider, id: entryId } = entry;
		if (typeof entryProvider !== "string" || typeof entryId !== "string" || !entryProvider || !entryId) continue;
		if (patternProvider && !globMatch(patternProvider, entryProvider)) continue;
		if (globMatch(patternModelId, entryId)) {
			return createSessionModelPreference(entryProvider, entryId, typeof entry.name === "string" ? entry.name : undefined);
		}
	}
	return undefined;
}

function matchEnabledModelPatternInModelsConfig(patternProvider: string | undefined, patternModelId: string, models: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(models)) return undefined;
	const providers = models.providers;
	if (!isRecord(providers)) return undefined;
	for (const [providerName, provider] of Object.entries(providers)) {
		if (patternProvider && !globMatch(patternProvider, providerName)) continue;
		if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
		for (const model of provider.models) {
			if (!isRecord(model) || typeof model.id !== "string") continue;
			if (globMatch(patternModelId, model.id)) {
				return createSessionModelPreference(providerName, model.id, model.name);
			}
		}
	}
	return undefined;
}

/** 极简 glob 匹配（支持 * 与 ?；* 不跨越 /，与 minimatch 单段语义一致）。 */
function globMatch(pattern: string, value: string): boolean {
	// 逐字符构建正则：* → [^/]*，? → [^/]，其余转义字面量
	let regex = "^";
	for (const char of pattern) {
		if (char === "*") regex += "[^/]*";
		else if (char === "?") regex += "[^/]";
		else regex += char.replace(/[.+^${}()[\]\\|]/g, "\\$&");
	}
	regex += "$";
	return new RegExp(regex).test(value);
}

function optionalString(source: unknown, key: string): string | undefined {
	if (!isRecord(source)) return undefined;
	const value = source[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
