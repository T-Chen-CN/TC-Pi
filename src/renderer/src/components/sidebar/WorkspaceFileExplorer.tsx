import { useSetAtom } from "jotai";
import { FilesPanel } from "../session/WorkspaceSurface";
import type { DrawerFilesPort } from "../workspace/DrawerSurface";
import { workspacePageAtom } from "../../atoms/workspace-navigation-atoms";
import { t } from "../../i18n";
import { isChatProject, displayProjectDirectoryName } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";

/** 复用唯一文件树控制器；文件操作从总览返回工作区编辑区域。 */
export function WorkspaceFileExplorer(props: { projectId?: string; files: DrawerFilesPort }) {
	const { projectId, files } = props;
	const setPage = useSetAtom(workspacePageAtom);
	const project = files.projects.find((item) => item.id === projectId);
	return (
		<section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t("workspace.files")} data-testid="workspace-file-explorer">
			<div className="flex h-7 shrink-0 items-center gap-2 px-2 text-caption font-medium">
				<span>{t("workspace.files")}</span>
				<span className="min-w-0 flex-1 truncate text-micro font-normal text-muted-foreground" title={project?.path}>
					{project && !isChatProject(project) ? displayProjectDirectoryName(project) : ""}
				</span>
			</div>
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
		</section>
	);
}
