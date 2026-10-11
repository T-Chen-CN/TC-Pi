import { useSetAtom } from "jotai";
import { useId, useState } from "react";
import { ChevronRight, FolderTree } from "lucide-react";
import { FilesPanel } from "../session/WorkspaceSurface";
import type { DrawerFilesPort } from "../workspace/DrawerSurface";
import { workspacePageAtom } from "../../atoms/workspace-navigation-atoms";
import { t } from "../../i18n";
import { isChatProject, displayProjectDirectoryName } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";

/** 复用唯一文件树控制器；文件操作从总览返回工作区编辑区域。 */
export function WorkspaceFileExplorer(props: { projectId?: string; files: DrawerFilesPort }) {
	const { projectId, files } = props;
	const setPage = useSetAtom(workspacePageAtom);
	const [expanded, setExpanded] = useState(true);
	const contentId = useId();
	const project = files.projects.find((item) => item.id === projectId);
	return (
		<section className={cn("flex min-h-0 flex-col overflow-hidden", expanded ? "flex-1" : "shrink-0")} aria-label={t("workspace.files")} data-testid="workspace-file-explorer">
			<Button variant="ghost" className="h-8 w-full shrink-0 justify-start gap-2 px-2 text-caption" aria-label={t("workspace.files")} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>
				<FolderTree className="size-4 shrink-0" aria-hidden="true" />
				<span>{t("workspace.files")}</span>
				<span className="min-w-0 flex-1 truncate text-micro font-normal text-muted-foreground" title={project?.path}>
					{project && !isChatProject(project) ? displayProjectDirectoryName(project) : ""}
				</span>
				<ChevronRight className={cn("size-3.5 shrink-0", expanded && "rotate-90")} aria-hidden="true" />
			</Button>
			{/* 只隐藏内容而不卸载文件树：收起/展开保留目录展开、搜索与滚动状态。 */}
			<div id={contentId} hidden={!expanded} className={cn("min-h-0 flex-1 flex-col overflow-hidden", expanded ? "flex" : "hidden")}>
				{project && !isChatProject(project) ? (
					<FilesPanel
						key={project.id}
						projectId={project.id}
						files={files.files}
						expandedDirs={files.expandedDirs}
						onToggleDirectory={files.onToggleDirectory}
						onCollapseAll={files.onCollapseAllDirectories}
						onFileContextMenu={(node, x, y) => files.setFileMenu({ node, x, y })}
						onRefreshFiles={() => void Promise.resolve(files.refreshFiles(project.id)).catch(() => showNotice(t("workspace.navigationFailed")))}
						onOpenFolder={() => void files.api.files.open(project.path).catch(() => showNotice(t("workspace.navigationFailed")))}
						onOpenFile={files.openFilePath}
						onViewFile={(path, mode) => {
							setPage("workspace");
							files.viewFilePath(path, mode);
						}}
						projectRoot={project.path}
						onDropFiles={files.onDropFiles}
						onPasteFiles={files.onPasteFiles}
						onMoveFiles={files.onMoveFiles}
					/>
				) : (
					<p className="px-2 py-6 text-caption text-muted-foreground">{t(isChatProject(project) ? "miniOverlay.chatProjectHint" : "workspace.chooseFirst")}</p>
				)}
			</div>
		</section>
	);
}
