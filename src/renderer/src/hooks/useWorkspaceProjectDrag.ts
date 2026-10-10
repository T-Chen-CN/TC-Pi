import { useCallback, useRef, type DragEvent } from "react";
import type { SidebarController } from "./useSidebarController";
import type { SidebarActions } from "../components/sidebar/SidebarContent";
import { showNotice } from "../utils/notice";
import { t } from "../i18n";

export const WORKSPACE_DRAG_MIME = "text/pideck-workspace";

/** 拖放读最新清单；只移动根工作区，不接受会话/文件的 text/plain 误投。 */
export function useWorkspaceProjectDrag(controller: SidebarController, actions: SidebarActions) {
	const snapshot = useRef({ controller, actions });
	snapshot.current = { controller, actions };
	const position = (event: DragEvent<HTMLElement>): "before" | "after" => {
		const rect = event.currentTarget.getBoundingClientRect();
		return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
	};
	const validRoot = (id: string) => snapshot.current.controller.catalog.projects.some((project) => project.id === id && project.kind !== "chat" && !project.worktreeParentId);
	const start = useCallback((event: DragEvent<HTMLElement>, id: string) => {
		if (!validRoot(id)) {
			event.preventDefault();
			return;
		}
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(WORKSPACE_DRAG_MIME, id);
		snapshot.current.controller.startProjectDrag(id);
	}, []);
	const over = useCallback((event: DragEvent<HTMLElement>, id: string) => {
		const source = snapshot.current.controller.drag.sourceProjectId;
		if (!source || source === id || !validRoot(id)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		snapshot.current.controller.setProjectDropTarget(id, position(event));
	}, []);
	const drop = useCallback((event: DragEvent<HTMLElement>, id: string) => {
		const source = event.dataTransfer.getData(WORKSPACE_DRAG_MIME);
		if (!source || source === id || !validRoot(source) || !validRoot(id)) return;
		event.preventDefault();
		const placement = position(event);
		snapshot.current.controller.finishProjectDrag();
		void snapshot.current.actions.projects.reorder(source, id, placement).catch(() => showNotice(t("workspace.navigationFailed")));
	}, []);
	return { start, over, drop };
}
