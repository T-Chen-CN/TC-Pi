/**
 * Provider 用量查询 hook：atoms（provider-usage-atoms）之上的取数副作用层。
 *
 * 自动查询纪律：
 * - 是否查询由每个 provider 徽章里的开关决定（usage-probes.json 的 enabled）：
 *   显式 false → 不查；显式 true / 内置识别 / 已配模板 → 查；
 * - 状态表尚未回来时不抢发（等状态表），状态表已就绪但该 provider 不在表里 → 按开处理
 *   （与历史行为一致，避免用量面板/选择器对表外 provider 永远不查）；
 * - 新鲜期 = 主进程返回的 intervalMinutes（默认 5 分钟）；
 * - interval = 0：该 provider 不轮询，且已查过的条目不自动重查；
 * - 手动刷新（useProviderUsageRefresh）对 Pi 直接发请求，不看新鲜期。
 *
 * 查询只写 atoms（组件卸载后写入也无害：缓存本就是跨组件共享的），无 cancelled 需求。
 */
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ProviderUsageResult, UsageProbeBackend, UsageProbeProviderState, UsageProbeStatesResult } from "../../../shared/types/providerUsage";
import { desktopApi } from "../desktopApi";
import {
	beginProviderUsageAtom,
	markProviderUsageStatesStatusAtom,
	mergeProviderUsageStatesAtom,
	providerUsageEntryAtomFamily,
	providerUsageRecordsReadAtom,
	providerUsageStateAtomFamily,
	providerUsageStatesReadAtom,
	providerUsageStatesStatusAtom,
	resolveProviderUsageAtom,
	type ProviderUsageEntry,
} from "../atoms/provider-usage-atoms";
import { USAGE_PROBE_DEFAULT_INTERVAL_MINUTES, shouldAutoFetchProviderUsage } from "./providerUsageAutoQuery";
import { selectWarmupProviders, warmupDelayMs } from "./providerUsageWarmup";

export {
	USAGE_PROBE_DEFAULT_INTERVAL_MINUTES,
	providerUsageEntryStale,
} from "./providerUsageAutoQuery";

/**
 * Pi 缓存使用 provider；旧后端只保留隔离的缓存身份，不再发起查询。
 */
export function usageCacheKey(provider: string, backend: UsageProbeBackend): string {
	return provider;
}

/** provider → 正在进行的请求；模块级一处，避免多组件同时挂载重复弹请求。 */
const inFlight = new Map<string, Promise<void>>();

/**
 * 发起一次查询并写入 atoms（in-flight 去重；结果无论成败都 resolve 进缓存）。
 * @param provider 原始 provider 名（主进程按它解析端点/配置）
 * @param cacheKey 渲染层缓存 key；旧后端在发起请求前拒绝。
 */
function startFetch(provider: string, cacheKey: string, resolve: (key: string, result: ProviderUsageResult) => void, backend: UsageProbeBackend = "pi"): void {
	if (backend !== "pi") return;
	if (inFlight.has(cacheKey)) return;
	const promise = desktopApi.config
		.fetchUsage(provider, backend)
		.then((result) => resolve(cacheKey, result))
		.catch(() => {
			// 网络异常/IPC 失败：写一条结构化失败结果，与主进程返回失败同路径展示。
			resolve(cacheKey, { success: false, error: "fetch failed", at: Date.now() });
		})
		.finally(() => {
			inFlight.delete(cacheKey);
		});
	inFlight.set(cacheKey, promise);
}

/** 订阅单个 provider 的用量查询状态（徽章只读展示用）：未加载到 = undefined。 */
export function useProviderUsageState(provider: string | undefined, backend: UsageProbeBackend = "pi"): UsageProbeProviderState | undefined {
	const cacheKey = provider ? usageCacheKey(provider, backend) : "";
	return useAtomValue(providerUsageStateAtomFamily(cacheKey));
}

/** 状态表模块级去重：同一 (backend, provider 列表签名) 只发一次 IPC，多张卡片共享结果。 */
const statesInFlight = new Map<string, Promise<UsageProbeStatesResult>>();

/** Pi 供应商用量查询；旧后端只读缓存，不触发后台请求。 */
export function useProviderUsageStatesLoader(providers: string[], backend: UsageProbeBackend = "pi"): void {
	const merge = useSetAtom(mergeProviderUsageStatesAtom);
	const markStatus = useSetAtom(markProviderUsageStatesStatusAtom);
	// 用字符串签名做依赖：调用方每次渲染传新数组也不会重跑 effect。
	const providerKey = providers.join("\n");
	useEffect(() => {
		if (backend !== "pi") return;
		// pi 链路一律请求「全量」（主进程按 models.json + auth.json + 已配置项枚举）：
		// 签名与 backend 同名，多张卡片/多个消费点共享同一次 IPC，不会按卡片扇出。
		const list: string[] = [];
		const signature = "pi";
		let cancelled = false;
		markStatus(backend, "loading");
		const pending = statesInFlight.get(signature) ?? desktopApi.config.listUsageProbeStates({ providers: list, backend }).catch(() => ({ providers: {}, errors: [] }));
		statesInFlight.set(signature, pending);
		void pending.then((result) => {
			// 卸载后仍写 atoms 无害（状态是跨组件共享的），但标记状态要避免覆盖后一次加载。
			if (!cancelled) markStatus(backend, "ready");
			const entries: Record<string, UsageProbeProviderState> = {};
			for (const [name, state] of Object.entries(result.providers)) {
				entries[usageCacheKey(name, backend)] = state;
			}
			merge(entries);
		});
		return () => {
			cancelled = true;
		};
	}, [providerKey, backend, merge, markStatus]);
}

export function useRefreshProviderUsageState(): (provider: string, backend?: UsageProbeBackend) => Promise<void> {
	const merge = useSetAtom(mergeProviderUsageStatesAtom);
	return useCallback(
		async (provider: string, backend: UsageProbeBackend = "pi") => {
			if (!provider || backend !== "pi") return;
			const result = await desktopApi.config.listUsageProbeStates({ providers: [provider], backend }).catch(() => ({ providers: {}, errors: [] }));
			const entries: Record<string, UsageProbeProviderState> = {};
			for (const [name, state] of Object.entries(result.providers)) {
				entries[usageCacheKey(name, backend)] = state;
			}
			merge(entries);
		},
		[merge],
	);
}

/** Pi 供应商用量查询；旧后端只读缓存，不触发后台请求。 */
export function useProviderUsageEntry(provider: string | undefined, backend: UsageProbeBackend = "pi"): ProviderUsageEntry {
	const cacheKey = provider ? usageCacheKey(provider, backend) : undefined;
	// 自己拉状态：调用方（卡片/圆球/选择器）不必各自记着先加载状态表。
	useProviderUsageStatesLoader(provider ? [provider] : [], backend);
	const entry = useAtomValue(providerUsageEntryAtomFamily(cacheKey ?? ""));
	const state = useAtomValue(providerUsageStateAtomFamily(cacheKey ?? ""));
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);
	// provider 级开关：未显式开启（状态未到或 enabled=false）一律不自动查。
	const queryEnabled = state?.enabled === true;
	// 生效间隔：已查到结果用配置值（0 = 该 provider 不轮询）；未查到用状态表/默认值。
	const intervalMinutes = entry.result?.intervalMinutes ?? state?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES;
	useEffect(() => {
		if (!provider || !cacheKey || !queryEnabled) return;
		// 走新鲜期（从未查过或已过 interval 才发）。
		if (
			shouldAutoFetchProviderUsage({
				reason: "mount",
				entry,
				intervalMinutes,
			})
		) {
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		}
		// 依赖只用 fetchedAt 而非整个 entry：begin() 会把 status 改成 loading，
		// 若订整个对象会在首查发出后立刻重跑 effect（inFlight 能挡住 HTTP，但仍多一次 begin）。
	}, [provider, cacheKey, entry.fetchedAt, intervalMinutes, queryEnabled, begin, resolve, backend]);

	// 自动轮询：开关开 + 间隔 > 0 才排下一次刷新。
	// 在当前用量面板轮询，不后台刷新全部供应商。
	useEffect(() => {
		if (!provider || !cacheKey || !queryEnabled) return;
		if (
			!shouldAutoFetchProviderUsage({
				reason: "poll",
				entry,
				intervalMinutes,
			})
		) {
			return;
		}
		const timer = window.setTimeout(() => {
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		}, intervalMinutes * 60_000);
		return () => window.clearTimeout(timer);
	}, [provider, cacheKey, intervalMinutes, queryEnabled, begin, resolve, backend]);

	return entry;
}

/**
 * 启动预热：应用启动后把「已开启」的 provider 各查一次，让卡片一打开就有数据。
 *
 * 为什么只查已开启的：默认关（enabled ?? false），所以预热名单通常只有用户真正开过的几条；
 * 又因为串行 + 错峰（warmupDelayMs），即使多条共用一个本地网关也不会同时打过去。
 * 只跑一次：整个应用生命周期内预热一轮，之后的刷新交给轮询/手动/挂载首查。
 * 调用方：App.tsx 装配层。
 */
export function useProviderUsageStartupWarmup(): void {
	// pi 链路请求全量（主进程按 models.json + auth.json + 已配置项枚举）；
	useProviderUsageStatesLoader([], "pi");
	const states = useAtomValue(providerUsageStatesReadAtom);
	const status = useAtomValue(providerUsageStatesStatusAtom);
	const refresh = useProviderUsageRefresh();
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		const piStatus = status.pi ?? "idle";
		// Pi 状态表未就绪时等待，避免未确认供应商就发起预热查询。
		if (piStatus === "loading" || piStatus === "idle") return;
		started.current = true;
		const targets = selectWarmupProviders(states);
		const timers = targets.map((target, index) => window.setTimeout(() => refresh(target.provider, target.backend), warmupDelayMs(index)));
		return () => {
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [status.pi, states, refresh]);
}

/** 手动刷新单个 provider（详情面板刷新按钮 / 保存探针后重查）：不看开关、不走新鲜期。 */
export function useProviderUsageRefresh(): (provider: string, backend?: UsageProbeBackend) => void {
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);
	return useCallback(
		(provider: string, backend: UsageProbeBackend = "pi") => {
			if (!provider || backend !== "pi") return;
			const cacheKey = usageCacheKey(provider, backend);
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		},
		[begin, resolve],
	);
}

/** Pi 供应商用量查询；旧后端只读缓存，不触发后台请求。 */
export function useProviderUsageBatchRefresh(): (providers: string[], backend?: UsageProbeBackend) => void {
	const records = useAtomValue(providerUsageRecordsReadAtom);
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);
	return useCallback(
		(providers: string[], backend: UsageProbeBackend = "pi") => {
			for (const provider of providers) {
				if (!provider) continue;
				const cacheKey = usageCacheKey(provider, backend);
				const record = records[cacheKey] ?? null;
				const interval = record?.result?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES;
				// 走新鲜期（未查过才触发；interval=0 的已查条目不再自动重查）。
				if (
					!shouldAutoFetchProviderUsage({
						reason: "batch",
						entry: record,
						intervalMinutes: interval,
					})
				) {
					continue;
				}
				begin(cacheKey);
				startFetch(provider, cacheKey, resolve, backend);
			}
		},
		[records, begin, resolve],
	);
}
