import { GitBranch, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { useAtomValue } from "jotai";
import { workspaceProjectStatusAtomFamily } from "../../atoms/workspace-project-atoms";
import { SessionActivityIndicator } from "../session/SessionActivityIndicator";
import { PendingAskBadge } from "./PendingAskBadge";
import type { Project, WorktreeEntry } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { SidebarActions } from "./SidebarContent";
import { useWorkspaceProjectDrag } from "../../hooks/useWorkspaceProjectDrag";
import { displayProjectDirectoryName, isChatProject } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";
import { mergeWorkspaceTreeRows, normalizeWorkspacePath } from "./workspaceTreeModel";

const fail = () => showNotice(t("workspace.navigationFailed"));

/** 根工作区保留持久化顺序；Worktree 按 Git 清单与已登记项目合并，跟随所属根。 */
export function WorkspaceProjectList(props: { controller: SidebarController; actions: SidebarActions; projectId?: string; worktreesByProject: Readonly<Record<string, readonly WorktreeEntry[]>>; branchByProject?: Readonly<Record<string, string | null | undefined>>; removingWorktreePaths?: ReadonlySet<string> }) {
	const { controller, actions } = props;
	const projects = controller.catalog.projects.filter((project) => !isChatProject(project));
	const roots = projects.filter((project) => !project.worktreeParentId || !projects.some((root) => root.id === project.worktreeParentId));
	const drag = useWorkspaceProjectDrag(controller, actions);
	const removing = new Set([...(props.removingWorktreePaths ?? [])].map(normalizeWorkspacePath));
	const row = (project: Project, branch?: string, nested = false) => (
		<div
			key={project.id}
			data-project-id={project.id}
			className={cn(
				"group relative flex shrink-0 items-center transition-[opacity,transform] duration-250",
				nested && "ml-3",
				removing.has(normalizeWorkspacePath(project.path)) && "pointer-events-none -translate-x-3 opacity-0",
				controller.drag.sourceProjectId === project.id && "opacity-60",
				controller.drag.overProjectId === project.id && (controller.drag.overPosition === "before" ? "border-t-2 border-primary" : "border-b-2 border-primary"),
			)}
			onContextMenu={(event) => {
				event.preventDefault();
				void controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }).catch(fail);
			}}
		>
			<Button
				variant="ghost"
				className={cn("h-auto min-h-10 min-w-0 flex-1 justify-start gap-1 px-2 py-1 text-left", project.id === props.projectId && "bg-accent text-accent-foreground")}
				aria-label={displayProjectDirectoryName(project)}
				aria-pressed={project.id === props.projectId}
				title={project.path}
				onClick={() => actions.projects.select(project.id)}
				draggable={!nested}
				onDragStart={(event) => drag.start(event, project.id)}
				onDragOver={(event) => drag.over(event, project.id)}
				onDrop={(event) => drag.drop(event, project.id)}
				onDragLeave={(event) => {
					if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) controller.setProjectDropTarget(undefined);
				}}
				onDragEnd={controller.finishProjectDrag}
			>
				{nested && <GitBranch className="size-3 shrink-0 text-muted-foreground" />}
				<span className="min-w-0 flex-1">
					<span className="block truncate text-caption font-medium">{displayProjectDirectoryName(project)}</span>
					{branch && <span className="block truncate text-micro text-muted-foreground">{branch}</span>}
					<span className="block truncate text-micro text-muted-foreground">{project.path}</span>
					{project.missing && (
						<span className="block text-micro text-danger" title={t("app.projectMissingHint")}>
							{t("app.projectMissing")}
						</span>
					)}
				</span>
				<WorkspaceProjectStatus projectId={project.id} />
			</Button>
			{project.worktreeEnabled && !nested && (
				<Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground" aria-label={t("app.worktreeNew")} onClick={() => controller.openWorktreeCreate(project.id)}>
					<Plus className="size-3.5" />
				</Button>
			)}
			<Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground" aria-label={t("workspace.workspaceMenu")} onClick={(event) => void controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }).catch(fail)}>
				<MoreHorizontal className="size-3.5" />
			</Button>
		</div>
	);
	return (
		<div id="workspace-inline-list" data-testid="workspace-inline-list" className="ml-3 flex max-h-[22vh] shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-border/60 pl-1">
			<Button variant="ghost" className="h-7 shrink-0 justify-start gap-2 px-2 text-caption text-muted-foreground" onClick={() => void actions.projects.refreshAll().catch(fail)}>
				<RefreshCw className="size-3" />
				{t("app.projectRefreshAll")}
			</Button>
			{roots.map((root) => {
				const children = projects.filter((project) => project.worktreeParentId === root.id);
				const entries = root.worktreeEnabled ? (props.worktreesByProject[root.id] ?? []) : [];
				const rows = mergeWorkspaceTreeRows(
					entries.filter((entry) => normalizeWorkspacePath(entry.path) !== normalizeWorkspacePath(root.path)),
					children,
				);
				return (
					<div key={root.id} className="shrink-0">
						{row(root, root.worktreeEnabled ? (props.branchByProject?.[root.id] ?? undefined) : undefined)}
						{rows.map((child) =>
							child.project ? (
								row(child.project, child.branch, true)
							) : (
								<div key={child.key} className="ml-3 flex shrink-0 items-center gap-1 px-2 py-1 text-micro text-muted-foreground" title={child.path}>
									<GitBranch className="size-3" />
									<span className="truncate">
										{child.branch} · {child.directory}
									</span>
								</div>
							),
						)}
					</div>
				);
			})}
		</div>
	);
}

/** 汇总状态单独挂载，避免在可变长度的行渲染函数中调用 hook。 */
function WorkspaceProjectStatus({ projectId }: { projectId: string }) {
	const status = useAtomValue(workspaceProjectStatusAtomFamily(projectId));
	return (
		<>
			<SessionActivityIndicator status={status.running ? "running" : status.live ? "idle" : undefined} waiting={status.pending > 0 && !status.running} />
			<PendingAskBadge count={status.pending} />
		</>
	);
}
