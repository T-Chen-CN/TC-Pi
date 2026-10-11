import { useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Pin } from "lucide-react";
import { useAtomValue } from "jotai";
import type { Project } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import { getBoundSidebarRuntimeAgent } from "../../hooks/useSidebarController";
import { sessionRuntimeBySessionIdAtomFamily, sessionRuntimeUiBySessionIdAtomFamily } from "../../atoms/session-selectors";
import { workspaceSessionGroups, type WorkspaceSessionGroup } from "../../utils/workspaceSessionGroups";
import { countPendingAsksForSessions } from "../../utils/askUi";
import { SESSION_TAB_DRAG_MIME } from "../../utils/sessionSplitEdge";
import { sessionDisplayName } from "../../utils/sessionDisplayName";
import { displayProjectDirectoryName } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { cn } from "../../lib/utils";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { BridgeGuiSlot } from "../bridge/BridgeSlot";
import { SessionActivityIndicator } from "../session/SessionActivityIndicator";
import { PendingAskBadge } from "./PendingAskBadge";
import { SessionHoverCard } from "./SessionHoverCard";
import type { SidebarActions } from "./SidebarContent";

const fail = () => showNotice(t("workspace.navigationFailed"));

/** 当前工作区全部会话；排序和分组是纯策略，展开集合由侧栏 controller 持有。 */
export function WorkspaceSessionList(props: { project?: Project; sessionId?: string; controller: SidebarController; actions: SidebarActions; onSelect: (projectId: string, sessionId: string) => Promise<boolean> }) {
	const { project, controller, actions } = props;
	const records = controller.catalog.sessionsByProject[project?.id ?? ""];
	const groups = useMemo(() => workspaceSessionGroups(records ?? [], controller.pinnedSessionIds), [records, controller.pinnedSessionIds]);
	const loading = project && controller.catalog.catalogLoadStateByProject[project.id]?.status === "loading";
	return (
		<div id="workspace-session-list" data-testid="workspace-session-list" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1">
			{project ? (
				<>
					{loading && (
						<div className="flex shrink-0 items-center gap-2 px-2 py-2 text-caption text-muted-foreground">
							<Loader2 className="size-3 animate-pideck-spin" />
							{t("common.loading")}
						</div>
					)}
					{!loading && !groups.length && <p className="shrink-0 px-2 py-2 text-caption text-muted-foreground">{t("workspace.noSessions")}</p>}
					{groups.map((group) => (
						<WorkspaceSessionRow key={group.session.id} group={group} project={project} sessionId={props.sessionId} controller={controller} actions={actions} onSelect={props.onSelect} />
					))}
				</>
			) : (
				<p className="shrink-0 px-2 py-2 text-caption text-muted-foreground">{t("workspace.chooseFirst")}</p>
			)}
		</div>
	);
}

/** 逐会话订阅 runtime/UI，拒绝旧代待确认徽章，不用当前焦点的全局状态。 */
function WorkspaceSessionRow(props: { group: WorkspaceSessionGroup; project: Project; sessionId?: string; controller: SidebarController; actions: SidebarActions; onSelect: (projectId: string, sessionId: string) => Promise<boolean> }) {
	const { group, controller, actions } = props;
	const item = group.session;
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(item.id));
	const ui = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(item.id));
	const pending = runtime?.agentId && runtime.status !== "closed" && runtime.status !== "detached" && ui?.agentId === runtime.agentId && ui.runtimeGeneration === runtime.runtimeGeneration ? countPendingAsksForSessions([item.id], { [item.id]: ui }) : 0;
	const groupKey = `${props.project.id}:${item.id}`;
	const expanded = controller.expandedSubagentGroups.has(groupKey);
	const title = sessionDisplayName(item.title, item.forked) ?? item.title;
	const status = pending
		? t("sidebar.pendingConfirmation")
		: runtime?.status === "starting"
			? t("app.statusStarting")
			: runtime?.status === "running"
				? t("app.statusRunning")
				: runtime?.status === "idle"
					? t("app.statusIdle")
					: runtime?.status === "error"
						? t("app.statusError")
						: runtime?.status === "closed"
							? t("tool.statusStopped")
							: item.status === "draft"
								? t("workspace.notStarted")
								: t("workspace.history");
	const menu = (x: number, y: number) => {
		const agent = getBoundSidebarRuntimeAgent(controller.catalog, item.id);
		void controller.openMenu(agent ? { kind: "agent", agentId: agent.id, pinnable: true, x, y } : item.status === "draft" ? { kind: "draft", projectId: item.projectId, sessionId: item.id, x, y } : { kind: "session", projectId: item.projectId, sessionId: item.id, pinnable: true, x, y }).catch(fail);
	};
	return (
		<div className="shrink-0" data-testid="workspace-session-row" data-session-id={item.id}>
			<div
				className="group flex min-w-0 items-center"
				onContextMenu={(event) => {
					event.preventDefault();
					menu(event.clientX, event.clientY);
				}}
			>
				<SessionHoverCard session={item} projectName={displayProjectDirectoryName(props.project)} title={title} status={runtime?.status} disabled={Boolean(controller.menu)}>
					<Button
						variant="ghost"
						className={cn("h-auto min-h-10 min-w-0 flex-1 justify-start gap-1.5 px-2 py-1 text-left", item.id === props.sessionId && "bg-accent text-accent-foreground")}
						aria-pressed={item.id === props.sessionId}
						onClick={() => void props.onSelect(item.projectId, item.id).catch(fail)}
						draggable
						onDragStart={(event) => {
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData(SESSION_TAB_DRAG_MIME, item.id);
							event.dataTransfer.setData("text/plain", item.id);
							actions.sessions.beginDrag?.(item.id);
						}}
						onDragEnd={() => actions.sessions.endDrag?.()}
					>
						<SessionActivityIndicator status={runtime?.status} sessionId={item.id} waiting={pending > 0} />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-caption font-medium">{title}</span>
							<span className="block truncate text-micro text-muted-foreground">
								{new Date(item.createdAt).toLocaleString()} · {status}
							</span>
						</span>
						<PendingAskBadge count={pending} />
					</Button>
				</SessionHoverCard>
				<Button
					variant="ghost"
					size="icon-sm"
					className={cn("size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100", controller.isSessionPinned(item.id) && "text-primary opacity-100")}
					aria-label={t(controller.isSessionPinned(item.id) ? "menu.unpinSession" : "menu.pinSession")}
					onClick={() => controller.toggleSessionPin(item.id)}
				>
					<Pin className="size-3" />
				</Button>
				<Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground" aria-label={t("workspace.sessionMenu")} onClick={(event) => menu(event.clientX, event.clientY)}>
					<MoreHorizontal className="size-3.5" />
				</Button>
			</div>
			<BridgeGuiSlot sessionId={item.id} slot="session.item" className="min-w-0 px-2" />
			{group.children.length > 0 && (
				<>
					<Button variant="ghost" className="h-6 w-full justify-start gap-1 px-3 text-micro text-muted-foreground" aria-expanded={expanded} onClick={() => controller.toggleSubagentGroup(groupKey)}>
						{expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
						{t("drawer.subagentSessionCount", { count: group.children.length })}
					</Button>
					{expanded && (
						<div className="ml-3 border-l border-border/60 pl-1">
							{group.children.map((child) => (
								<WorkspaceSessionRow key={child.session.id} {...props} group={child} />
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
