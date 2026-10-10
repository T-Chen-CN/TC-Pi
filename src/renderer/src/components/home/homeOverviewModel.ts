import type { DayTotals, UsageAggregated, UsageProjectRow, ProviderSlice } from "../../../../shared/types";

export type OverviewRange = "all" | "today" | "week" | "month";
export type OverviewProvider = { id: string; authenticated: boolean; models: string[] };

/** 从按天聚合结果投影时间范围，不读取原始日志、不累加重复会话数。 */
export function overviewUsage(data: UsageAggregated, range: OverviewRange, now = new Date()) {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	if (range === "week") start.setDate(start.getDate() - 6);
	if (range === "month") start.setDate(start.getDate() - 29);
	const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
	const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const daily = data.daily.filter((row) => range === "all" || (row.day >= key && row.day <= end));
	const totals: DayTotals = { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, sessions: [] };
	const sessions = new Set<string>();
	const projects = new Map<string, UsageProjectRow>();
	const providers = new Map<string, ProviderSlice>();
	for (const row of daily) {
		for (const field of ["tokens", "input", "output", "cacheRead", "cacheWrite", "cost", "turns"] as const) totals[field] += row.totals[field];
		row.totals.sessions.forEach((id) => sessions.add(id));
		for (const slice of row.byProject) {
			const previous = projects.get(slice.project) ?? { project: slice.project, tokens: 0, cost: 0, turns: 0 };
			projects.set(slice.project, { project: slice.project, tokens: previous.tokens + slice.tokens, cost: previous.cost + slice.cost, turns: previous.turns + slice.turns });
		}
		for (const slice of row.byProvider) {
			const previous = providers.get(slice.provider) ?? { provider: slice.provider, tokens: 0, cost: 0, turns: 0 };
			providers.set(slice.provider, { provider: slice.provider, tokens: previous.tokens + slice.tokens, cost: previous.cost + slice.cost, turns: previous.turns + slice.turns });
		}
	}
	totals.sessions = [...sessions];
	return { totals, daily, projects: [...projects.values()].sort((a, b) => b.tokens - a.tokens), providers: [...providers.values()].sort((a, b) => b.tokens - a.tokens), costKnown: data.costKnown };
}

/** 只提取可展示的配置元数据；任何密钥、令牌和原文都不进入总览状态。 */
export function overviewProviders(models: Record<string, unknown>, auth: Record<string, unknown>): OverviewProvider[] {
	return [...new Set([...Object.keys(models), ...Object.keys(auth)])].sort().map((id) => {
		const provider = models[id];
		const configured = isRecord(provider) && Array.isArray(provider.models) ? provider.models : [];
		const credential = auth[id];
		const configuredKey = isRecord(provider) && typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0;
		const configuredAuth = typeof credential === "string" ? credential.trim().length > 0 : isRecord(credential) && ["key", "apiKey", "access", "accessToken", "refresh", "refreshToken"].some((key) => typeof credential[key] === "string" && credential[key].length > 0);
		return { id, models: configured.flatMap((model: unknown) => (isRecord(model) && typeof model.id === "string" ? [model.id] : [])), authenticated: configuredKey || configuredAuth };
	});
}

/** Windows 路径大小写和分隔符等价，Unix 路径保持大小写语义。 */
export function overviewProjectPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
