import type { ProjectFileAccessScope } from "./project";
import type { FileTreeNode } from "./session";

/** 全局配置范围由主进程定位，渲染层不能声明任意可信目录。 */
export type PiConfigFileAccessScope = { kind: "pi-config" };
export type FileAccessScope = ProjectFileAccessScope | PiConfigFileAccessScope;
export type PiConfigFileTree = { rootPath: string; files: FileTreeNode[] };
export const PI_CONFIG_FILE_SCOPE: PiConfigFileAccessScope = { kind: "pi-config" };

/** IPC 只接受固定标记，不接受由 renderer 自报根目录的附加字段。 */
export function isPiConfigFileAccessScope(value: unknown): value is PiConfigFileAccessScope {
	return typeof value === "object" && value !== null && "kind" in value && value.kind === "pi-config" && Object.keys(value).length === 1;
}

/** 不同授权域不能共用文件存在性缓存或编辑器标签身份。 */
export function fileAccessScopeKey(scope?: FileAccessScope): string {
	if (!scope) return "";
	if ("kind" in scope) return "pi-config";
	return `project:${scope.projectId}`;
}
