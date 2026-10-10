import { useAtom, useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SidebarActions } from "../components/sidebar/SidebarContent";
import { sessionRecordsAtom, sessionCatalogLoadStateAtom } from "../atoms";
import { workspaceLastSessionsAtom, workspaceListsAtom, workspacePageAtom } from "../atoms/workspace-navigation-atoms";
import { workspaceLandingSession } from "../utils/workspaceNavigation";
import { showNotice } from "../utils/notice";
import { t } from "../i18n";
import { hostPluginPanelAtom } from "../atoms/host-plugin-atoms";

/** 导航的唯一 owner：异步恢复按最新选择结算，不允许迟到 catalog 抢回焦点。 */
export function useWorkspaceNavigation(rawActions: SidebarActions, projectId: string | undefined, sessionId: string | undefined) {
	const store = useStore();
	const [page, setPage] = useAtom(workspacePageAtom);
	const [lists, setLists] = useAtom(workspaceListsAtom);
	const [lastSessions, setLastSessions] = useAtom(workspaceLastSessionsAtom);
	const records = useAtomValue(sessionRecordsAtom);
	const loadStates = useAtomValue(sessionCatalogLoadStateAtom);
	const pluginPanel = useAtomValue(hostPluginPanelAtom);
	useEffect(() => {
		if (pluginPanel) setPage("workspace");
	}, [pluginPanel, setPage]);
	const snapshot = useRef({ rawActions, projectId, sessionId, lastSessions });
	snapshot.current = { rawActions, projectId, sessionId, lastSessions };
	const pending = useRef<{ projectId: string; revision: number } | undefined>(undefined);
	const revision = useRef(0);
	const [restoreRequest, setRestoreRequest] = useState<string | undefined>(undefined);
	useEffect(() => {
		if (!sessionId) return;
		const record = records[sessionId];
		if (!record || record.noSession || record.supersededBy) return;
		setLastSessions((current) => (current[record.projectId] === sessionId ? current : { ...current, [record.projectId]: sessionId }));
	}, [sessionId, records, setLastSessions]);
	const open = useCallback(
		async (targetProject: string, targetSession: string, tabMode?: "preview" | "permanent") => {
			revision.current += 1;
			pending.current = undefined;
			setRestoreRequest(undefined);
			setPage("workspace");
			await snapshot.current.rawActions.sessions.open(targetProject, targetSession, tabMode);
		},
		[setPage, setRestoreRequest],
	);
	const select = useCallback(
		(targetProject: string, force = false) => {
			setPage("workspace");
			// 同项目有选中会话时保留现场；只有项目身份而无会话时仍应恢复历史。
			if (!force && snapshot.current.projectId === targetProject && snapshot.current.sessionId) return;
			const request = { projectId: targetProject, revision: ++revision.current };
			pending.current = request;
			snapshot.current.rawActions.projects.select(targetProject);
			snapshot.current.rawActions.sessions.ensureCatalogsLoaded([targetProject]);
			setRestoreRequest(targetProject);
		},
		[setPage, setRestoreRequest],
	);
	/** 新会话快捷键进入引导页，不能被“同项目保持选择”的导航策略吞掉。 */
	const welcome = useCallback(
		(targetProject: string) => {
			revision.current += 1;
			pending.current = undefined;
			setRestoreRequest(undefined);
			setPage("workspace");
			snapshot.current.rawActions.projects.select(targetProject);
		},
		[setPage, setRestoreRequest],
	);
	useEffect(() => {
		const request = pending.current;
		if (!request || request.projectId !== restoreRequest || projectId !== request.projectId || loadStates[request.projectId]?.status !== "ready") return;
		pending.current = undefined;
		setRestoreRequest(undefined);
		const target = workspaceLandingSession(
			Object.values(store.get(sessionRecordsAtom)).filter((record) => record.projectId === request.projectId),
			snapshot.current.lastSessions[request.projectId],
		);
		if (target && request.revision === revision.current) void open(request.projectId, target.id).catch(() => showNotice(t("workspace.navigationFailed")));
	}, [projectId, restoreRequest, loadStates, records, store, open, setRestoreRequest]);
	useEffect(
		() => () => {
			revision.current += 1;
			pending.current = undefined;
		},
		[],
	);
	const actions = useMemo<SidebarActions>(
		() => ({
			...rawActions,
			projects: {
				...rawActions.projects,
				select,
				add: async () => {
					const id = await snapshot.current.rawActions.projects.add();
					if (id) select(id, true);
					return id;
				},
			},
			sessions: {
				...rawActions.sessions,
				open,
				createDraft: async (id) => {
					revision.current += 1;
					pending.current = undefined;
					setRestoreRequest(undefined);
					setPage("workspace");
					await snapshot.current.rawActions.sessions.createDraft(id);
				},
			},
		}),
		[rawActions, select, open, setPage, setRestoreRequest],
	);
	const home = useCallback(() => {
		revision.current += 1;
		pending.current = undefined;
		setRestoreRequest(undefined);
		setPage("home");
	}, [setPage, setRestoreRequest]);
	const chat = useCallback(
		(id: string) => {
			setLists((current) => ({ ...current, sessions: true }));
			select(id);
		},
		[setLists, select],
	);
	return { page, lists, setLists, actions, home, welcome, chat };
}
