import { atom } from "jotai";
import type { UsageAggregated } from "../../../shared/types";
import type { OverviewProvider, OverviewRange } from "../components/home/homeOverviewModel";
import { sessionRuntimeByIdAtom, sessionRuntimeUiByIdAtom } from "./session-atoms";

/** 首页只有一个数据 owner，用量和供应商摘要读取同一快照。 */
export const homeOverviewAtom = atom<{ loading: boolean; usage?: UsageAggregated; providers: OverviewProvider[]; defaultModel?: string; usageMissing: boolean; usageError: boolean; configError: boolean }>({ loading: true, providers: [], usageMissing: false, usageError: false, configError: false });
export const homeOverviewRangeAtom = atom<OverviewRange>("today");

/** 只统计当前 runtime 的待答请求，拒绝前一代进程留下的提示。 */
export const homePendingRequestsAtom = atom((get) => {
	const runtimes = get(sessionRuntimeByIdAtom);
	const ui = get(sessionRuntimeUiByIdAtom);
	const counts: Record<string, number> = {};
	for (const [sessionId, state] of Object.entries(ui)) {
		const runtime = runtimes[sessionId];
		if (runtime?.agentId !== state.agentId || runtime.runtimeGeneration !== state.runtimeGeneration) continue;
		counts[sessionId] = Object.values(state.requests).filter((request) => request.status === "pending").length;
	}
	return counts;
});
