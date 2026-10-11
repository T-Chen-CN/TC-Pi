import { ChevronDown, ChevronRight, FolderOpen, FolderPlus, MoreHorizontal } from "lucide-react";
import type { WorktreeEntry } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { WorkspaceNavigationPort } from "./WorkspaceNavigation";
import { isChatProject, displayProjectDirectoryName } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { WorkspaceProjectList } from "./WorkspaceProjectList";

/** 左侧工作区选择与内联列表；复用导航 owner 和原有项目操作，不复制状态。 */
export function WorkspaceProjectNavigation(props: {
	controller: SidebarController;
	navigation: WorkspaceNavigationPort;
	projectId?: string;
	worktreesByProject: Readonly<Record<string, readonly WorktreeEntry[]>>;
	branchByProject?: Readonly<Record<string, string | null | undefined>>;
	removingWorktreePaths?: ReadonlySet<string>;
}) {
	const { controller, navigation, projectId } = props;
	const { actions, lists } = navigation;
	const projects = controller.catalog.projects.filter((project) => !isChatProject(project));
	const project = controller.catalog.projects.find((item) => item.id === projectId);
	const fail = () => showNotice(t("workspace.navigationFailed"));
	const add = () => {
		void actions.projects.add().catch(fail);
	};
	const rowClass = "h-8 min-w-0 flex-1 justify-start gap-2 px-2 text-left text-caption";
	return (
		<div className="relative z-[930] flex shrink-0 flex-col gap-0.5 [-webkit-app-region:no-drag]" data-testid="workspace-project-navigation">
			<div className="flex shrink-0 items-center gap-0.5">
				<Button variant="ghost" className={rowClass} aria-label={t("workspace.select")} aria-expanded={lists.projects} aria-controls="workspace-inline-list" onClick={() => (projects.length ? navigation.setLists((value) => ({ ...value, projects: !value.projects })) : add())}>
					<FolderOpen className="size-4 shrink-0" />
					<span className="shrink-0">{t("workspace.select")}</span>
					<span className="min-w-0 flex-1 truncate text-right text-caption text-muted-foreground">{project && !isChatProject(project) ? displayProjectDirectoryName(project) : ""}</span>
					{lists.projects ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
				</Button>
				<Button variant="ghost" size="icon-sm" className="size-7 shrink-0" title={t("workspace.add")} aria-label={t("workspace.add")} onClick={add}>
					<FolderPlus className="size-3.5" />
				</Button>
				{project && (
					<Button variant="ghost" size="icon-sm" className="size-7 shrink-0" title={t("workspace.workspaceMenu")} aria-label={t("workspace.workspaceMenu")} onClick={(event) => void controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }).catch(fail)}>
						<MoreHorizontal className="size-3.5" />
					</Button>
				)}
			</div>
			{lists.projects && <WorkspaceProjectList controller={controller} actions={actions} projectId={projectId} worktreesByProject={props.worktreesByProject} branchByProject={props.branchByProject} removingWorktreePaths={props.removingWorktreePaths} />}
		</div>
	);
}
