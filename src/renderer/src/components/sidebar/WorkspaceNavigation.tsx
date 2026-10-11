import { MessageSquare } from "lucide-react";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { useWorkspaceSessionPicker } from "../../hooks/useWorkspaceSessionPicker";
import { displayProjectDirectoryName } from "../../rendererUtils";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui-shadcn/popover";
import { WorkspaceSessionList } from "./WorkspaceSessionList";

export type WorkspaceNavigationPort = ReturnType<typeof useWorkspaceNavigation>;

/** 标签栏里的会话选择浮层；controller 和菜单仍由原侧栏单实例管理。 */
export function WorkspaceNavigation(props: { controller: SidebarController; navigation: WorkspaceNavigationPort; projectId?: string; sessionId?: string }) {
	const { controller, navigation, projectId, sessionId } = props;
	const project = controller.catalog.projects.find((item) => item.id === projectId);
	const picker = useWorkspaceSessionPicker(projectId, navigation.actions.sessions);
	return (
		<Popover open={picker.open} onOpenChange={picker.setOpen}>
			<PopoverTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" className="size-7 shrink-0 [-webkit-app-region:no-drag]" title={t("workspace.sessions")} aria-label={t("workspace.sessions")} disabled={!projectId}>
					<MessageSquare className="size-3.5" aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="bottom"
				sideOffset={8}
				collisionPadding={8}
				className="flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-1 [-webkit-app-region:no-drag]"
				data-testid="workspace-session-picker"
				aria-label={t("workspace.sessions")}
				onInteractOutside={(event) => {
					// 原菜单 portal 到 body；菜单抢焦点不是用户点击浮层之外，不能误关列表。
					if (controller.menu || (event.target instanceof Element && event.target.closest('[data-slot="dropdown-menu-content"]'))) event.preventDefault();
				}}
				onEscapeKeyDown={(event) => {
					if (controller.menu) event.preventDefault();
				}}
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-2 text-caption">
					<span className="shrink-0 font-medium">{t("workspace.sessions")}</span>
					<span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{project ? displayProjectDirectoryName(project) : ""}</span>
				</div>
				<WorkspaceSessionList project={project} sessionId={sessionId} controller={controller} actions={navigation.actions} onSelect={picker.select} />
				{project && (
					<Button
						variant="ghost"
						className="mt-1 h-8 shrink-0 justify-start border-t border-border/40 px-2 text-caption text-muted-foreground"
						onClick={() => {
							controller.openSessionManager(project.id);
							picker.setOpen(false);
						}}
					>
						{t("workspace.manageSessions")}
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}
