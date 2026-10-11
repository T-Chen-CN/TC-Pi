import type { SessionRecord } from "../../../shared/types";
import { splitLayoutSessionIds, type SessionSplitLayout } from "./sessionSplitEdge";

/** 全局登记只保存现场；当前工作区是会话 chrome 的唯一可见范围。 */
export function projectSessionTabs(tabs: readonly string[], records: Readonly<Record<string, SessionRecord>>, projectId: string | undefined): string[] {
	return tabs.filter((id) => projectId !== undefined && records[id]?.projectId === projectId);
}

/** 修改本工作区标签不会关闭其他工作区保存的标签。 */
export function mergeProjectSessionTabs(all: string[], next: readonly string[], records: Readonly<Record<string, SessionRecord>>, projectId: string | undefined): string[] {
	const scoped = projectSessionTabs(all, records, projectId);
	if (all.every((id) => records[id]) && scoped.length === next.length && scoped.every((id, index) => id === next[index])) return all;
	return [...all.filter((id) => records[id] && records[id].projectId !== projectId), ...next];
}

/** 旧数据或跨工作区拖放产生的混合分屏不能投影到当前工作区。 */
export function projectSplitLayout(layout: SessionSplitLayout | null, records: Readonly<Record<string, SessionRecord>>, projectId: string | undefined): SessionSplitLayout | null {
	return layout && projectId && splitLayoutSessionIds(layout).every((id) => records[id]?.projectId === projectId) ? layout : null;
}
