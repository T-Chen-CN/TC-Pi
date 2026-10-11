import { ArrowLeft, ArrowRight, Home, MessageCircle, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { useSessionNavigation } from "../../hooks/useSessionNavigation";
import type { WorkspaceNavigationPort } from "./WorkspaceNavigation";
import { isChatProject } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui-shadcn/button";

export type SidebarHistoryNavigation = Pick<ReturnType<typeof useSessionNavigation>, "back" | "forward" | "canBack" | "canForward">;

/** 左栏全局入口与工作区选择共用同一导航 owner；会话选择留在右侧。 */
export function SidebarNavigation(props: { controller: SidebarController; navigation: WorkspaceNavigationPort; history: SidebarHistoryNavigation; projectId?: string; children: ReactNode }) {
	const chat = props.controller.catalog.projects.find(isChatProject);
	const rowClass = "h-8 min-w-0 flex-1 justify-start gap-2 px-2 text-caption";
	return (
		<nav className="flex max-h-[45vh] min-h-0 shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border/40 px-2 py-1 [-webkit-app-region:no-drag]" aria-label={t("workspace.navigation")} data-testid="sidebar-navigation">
			<div className="flex shrink-0 items-center gap-0.5">
				<Button variant="ghost" className={cn(rowClass, props.navigation.page === "home" && "bg-accent text-accent-foreground")} aria-current={props.navigation.page === "home" ? "page" : undefined} onClick={props.navigation.home}>
					<Home className="size-4 shrink-0" />
					{t("workspace.home")}
				</Button>
				<Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={t("navigation.back")} title={t("navigation.back")} disabled={!props.history.canBack} onClick={props.history.back}>
					<ArrowLeft className="size-3.5" />
				</Button>
				<Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={t("navigation.forward")} title={t("navigation.forward")} disabled={!props.history.canForward} onClick={props.history.forward}>
					<ArrowRight className="size-3.5" />
				</Button>
			</div>
			{chat && (
				<div className="flex shrink-0 items-center gap-0.5">
					<Button variant="ghost" className={cn(rowClass, props.projectId === chat.id && props.navigation.page === "workspace" && "bg-accent text-accent-foreground")} onClick={() => props.navigation.chat(chat.id)}>
						<MessageCircle className="size-4 shrink-0" />
						{t("workspace.independentChat")}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7 shrink-0 text-muted-foreground"
						aria-label={t("workspace.chatMenu")}
						onClick={(event) => void props.controller.openMenu({ kind: "project", projectId: chat.id, x: event.clientX, y: event.clientY }).catch(() => showNotice(t("workspace.navigationFailed")))}
					>
						<MoreHorizontal className="size-3.5" />
					</Button>
				</div>
			)}
			{props.children}
		</nav>
	);
}
