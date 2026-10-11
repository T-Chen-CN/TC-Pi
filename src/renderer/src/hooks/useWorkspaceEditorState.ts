import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";

type EditorIdentity = { id: string; dirty?: boolean; lastAccess?: number; originalContent?: string; modifiedContent?: string };
type WorkspaceEditorState<T> = { tabs: T[]; activeTabId: string | null; previewTabId: string | null };

/** 限制跨工作区缓存；只淘汰后台已保存的文件，当前文件与未保存文件不能自动卸载。 */
export function pruneWorkspaceEditors<T extends EditorIdentity>(workspaces: Record<string, WorkspaceEditorState<T>>, activeProject: string, limit = 20, textBudget = 24 * 1024 * 1024): Record<string, WorkspaceEditorState<T>> | null {
	let next = { ...workspaces };
	const bytes = (tab: T) => ((tab.originalContent?.length ?? 0) + (tab.modifiedContent?.length ?? 0)) * 2;
	while (true) {
		const all = Object.entries(next).flatMap(([project, state]) => state.tabs.map((tab) => ({ project, tab })));
		if (all.length <= limit && all.reduce((sum, { tab }) => sum + bytes(tab), 0) <= textBudget) return next;
		const oldest = all.filter(({ project, tab }) => project !== activeProject && !tab.dirty).sort((a, b) => (a.tab.lastAccess ?? 0) - (b.tab.lastAccess ?? 0))[0];
		if (!oldest) return null;
		const state = next[oldest.project];
		const tabs = state.tabs.filter((tab) => tab.id !== oldest.tab.id);
		next = { ...next, [oldest.project]: { tabs, activeTabId: state.activeTabId === oldest.tab.id ? (tabs.at(-1)?.id ?? null) : state.activeTabId, previewTabId: state.previewTabId === oldest.tab.id ? null : state.previewTabId } };
	}
}

/** 一个 owner 保存所有工作区的文件现场，当前工作区只是投影；隐藏编辑器继续保持撤销和未保存内容。 */
export function useWorkspaceEditorState<T extends EditorIdentity>(projectId: string | undefined) {
	const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceEditorState<T>>>({});
	const snapshot = useRef(workspaces);
	snapshot.current = workspaces;
	const projectRef = useRef(projectId ?? "");
	projectRef.current = projectId ?? "";
	const empty = useRef<WorkspaceEditorState<T>>({ tabs: [], activeTabId: null, previewTabId: null });
	const closeGuards = useRef(new Map<string, () => Promise<boolean>>());
	const closing = useRef(new Set<string>());
	const current = workspaces[projectId ?? ""] ?? empty.current;

	const update = useCallback(<K extends keyof WorkspaceEditorState<T>>(field: K, value: SetStateAction<WorkspaceEditorState<T>[K]>) => {
		const key = projectRef.current;
		const previous = snapshot.current[key] ?? empty.current;
		const nextValue = typeof value === "function" ? value(previous[field]) : value;
		const next = { ...snapshot.current, [key]: { ...previous, [field]: nextValue } };
		snapshot.current = next;
		setWorkspaces(next);
	}, []);
	const setTabs = useCallback((value: SetStateAction<T[]>) => {
		const key = projectRef.current;
		const previous = snapshot.current[key] ?? empty.current;
		const tabs = typeof value === "function" ? value(previous.tabs) : value;
		const next = pruneWorkspaceEditors({ ...snapshot.current, [key]: { ...previous, tabs } }, key);
		if (!next) return false;
		snapshot.current = next;
		setWorkspaces(next);
		return true;
	}, []);
	const setActiveTabId = useCallback((value: SetStateAction<string | null>) => update("activeTabId", value), [update]);
	const setPreviewTabId = useCallback((value: SetStateAction<string | null>) => update("previewTabId", value), [update]);

	/** 按稳定 tab 身份更新，后台自动保存不能清除另一个工作区的 dirty 状态。 */
	const markDirty = useCallback((id: string, dirty: boolean) => {
		const next = Object.fromEntries(
			Object.entries(snapshot.current).map(([key, state]) => [
				key,
				{
					...state,
					tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, dirty } : tab)),
					previewTabId: dirty && state.previewTabId === id ? null : state.previewTabId,
				},
			]),
		);
		snapshot.current = next;
		setWorkspaces(next);
	}, []);

	/** 注册的保存屏障和编辑器在同一生命周期清理；关闭失败时保留编辑器。 */
	const registerCloseGuard = useCallback((id: string, guard: () => Promise<boolean>) => {
		closeGuards.current.set(id, guard);
		return () => {
			if (closeGuards.current.get(id) === guard) closeGuards.current.delete(id);
		};
	}, []);
	const closeTab = useCallback(async (id: string): Promise<boolean> => {
		if (closing.current.has(id)) return false;
		closing.current.add(id);
		try {
			const guard = closeGuards.current.get(id);
			if (guard && !(await guard())) return false;
			const next = Object.fromEntries(
				Object.entries(snapshot.current).map(([key, state]) => {
					const index = state.tabs.findIndex((tab) => tab.id === id);
					if (index < 0) return [key, state];
					const tabs = state.tabs.filter((tab) => tab.id !== id);
					return [key, { tabs, activeTabId: state.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId, previewTabId: state.previewTabId === id ? null : state.previewTabId }];
				}),
			);
			snapshot.current = next;
			setWorkspaces(next);
			return true;
		} catch {
			return false;
		} finally {
			closing.current.delete(id);
		}
	}, []);
	const allTabs = useMemo(() => Object.values(workspaces).flatMap((state) => state.tabs), [workspaces]);
	return { ...current, allTabs, setTabs, setActiveTabId, setPreviewTabId, markDirty, registerCloseGuard, closeTab };
}
