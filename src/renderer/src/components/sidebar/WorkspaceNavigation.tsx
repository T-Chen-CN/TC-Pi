import { useEffect } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Home, MessageSquare, FolderPlus, MessageCircle, MoreHorizontal } from "lucide-react";
import type { WorktreeEntry } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { isChatProject, displayProjectDirectoryName } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";
import { WorkspaceProjectList } from "./WorkspaceProjectList";
import { WorkspaceSessionList } from "./WorkspaceSessionList";

export type WorkspaceNavigationPort = ReturnType<typeof useWorkspaceNavigation>;

/** 固定导航与独立聊天入口；列表在文档流中展开，限高滚动保留文件树空间。 */
export function WorkspaceNavigation(props: {
	controller: SidebarController;
	navigation: WorkspaceNavigationPort;
	projectId?: string;
	sessionId?: string;
	worktreesByProject: Readonly<Record<string, readonly WorktreeEntry[]>>;
	branchByProject?: Readonly<Record<string, string | null | undefined>>;
	removingWorktreePaths?: ReadonlySet<string>;
}) {
	const { controller, navigation, projectId, sessionId } = props;
	const { actions, lists } = navigation;
	const projects = controller.catalog.projects.filter((project) => !isChatProject(project));
	const chat = controller.catalog.projects.find(isChatProject);
	const project = controller.catalog.projects.find((item) => item.id === projectId);
	const session = controller.catalog.sessionsByProject[projectId ?? ""]?.find((item) => item.id === sessionId);
	useEffect(() => {
		if (lists.sessions && projectId) actions.sessions.ensureCatalogsLoaded([projectId]);
	}, [lists.sessions, projectId, actions.sessions.ensureCatalogsLoaded]);
	const fail = () => showNotice(t("workspace.navigationFailed"));
	const add = () => {
		void actions.projects.add().catch(fail);
	};
	const rowClass = "h-9 w-full min-w-0 justify-start gap-2 px-2 text-left text-body";
	return (
		<nav className="flex max-h-[60vh] min-h-0 shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border/40 pb-2 [&>button]:shrink-0" aria-label={t("workspace.navigation")}>
			<Button variant="ghost" className={cn(rowClass, navigation.page === "home" && "bg-accent text-accent-foreground")} onClick={navigation.home} aria-current={navigation.page === "home" ? "page" : undefined}>
				<Home className="size-4 shrink-0" />
				<span>{t("workspace.home")}</span>
			</Button>
			<Button variant="ghost" className={rowClass} onClick={add}>
				<FolderPlus className="size-4 shrink-0" />
				<span>{t("workspace.add")}</span>
			</Button>
			<Button variant="ghost" className={rowClass} aria-label={t("workspace.select")} aria-expanded={lists.projects} aria-controls="workspace-inline-list" onClick={() => (projects.length ? navigation.setLists((value) => ({ ...value, projects: !value.projects })) : add())}>
				<FolderOpen className="size-4 shrink-0" />
				<span className="shrink-0">{t("workspace.select")}</span>
				<span className="min-w-0 flex-1 truncate text-right text-caption text-muted-foreground">{project && !isChatProject(project) ? displayProjectDirectoryName(project) : ""}</span>
				{lists.projects ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
			</Button>
			{lists.projects && <WorkspaceProjectList controller={controller} actions={actions} projectId={projectId} worktreesByProject={props.worktreesByProject} branchByProject={props.branchByProject} removingWorktreePaths={props.removingWorktreePaths} />}
			<Button variant="ghost" className={rowClass} aria-label={t("workspace.sessions")} aria-expanded={lists.sessions} aria-controls="workspace-session-list" onClick={() => navigation.setLists((value) => ({ ...value, sessions: !value.sessions }))}>
				<MessageSquare className="size-4 shrink-0" />
				<span className="shrink-0">{t("workspace.sessions")}</span>
				<span className="min-w-0 flex-1 truncate text-right text-caption text-muted-foreground">{session?.title}</span>
				{lists.sessions ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
			</Button>
			{lists.sessions && <WorkspaceSessionList project={project} sessionId={sessionId} controller={controller} actions={actions} />}
			{chat && (
				<div className="flex shrink-0 items-center">
					<Button variant="ghost" className={cn(rowClass, "flex-1", projectId === chat.id && navigation.page === "workspace" && "bg-accent text-accent-foreground")} onClick={() => navigation.chat(chat.id)}>
						<MessageCircle className="size-4 shrink-0" />
						<span>{t("workspace.independentChat")}</span>
					</Button>
					<Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground" aria-label={t("workspace.chatMenu")} onClick={(event) => void controller.openMenu({ kind: "project", projectId: chat.id, x: event.clientX, y: event.clientY }).catch(fail)}>
						<MoreHorizontal className="size-3.5" />
					</Button>
				</div>
			)}
		</nav>
	);
}
