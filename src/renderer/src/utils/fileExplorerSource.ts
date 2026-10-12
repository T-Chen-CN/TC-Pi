import type { Project } from "../../../shared/types";

export const PI_CONFIG_EDITOR_OWNER = "config:pi-agent";

/** 主界面与独立聊天共享全局配置现场，其余页面绑定当前工作区。 */
export function usesPiConfigFiles(page: "home" | "workspace", project?: Pick<Project, "id" | "kind"> | null): boolean {
	return page === "home" || !project || project.kind === "chat";
}

export function fileEditorOwner(page: "home" | "workspace", project?: Pick<Project, "id" | "kind"> | null): string {
	return usesPiConfigFiles(page, project) ? PI_CONFIG_EDITOR_OWNER : `project:${project?.id ?? ""}`;
}
