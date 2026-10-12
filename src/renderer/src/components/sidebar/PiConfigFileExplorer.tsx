import type { PiDesktopApi } from "../../../../preload";
import { PI_CONFIG_FILE_SCOPE, type FileAccessScope } from "../../../../shared/types";
import { FilesPanel } from "../session/WorkspaceSurface";
import { FileContextMenu } from "../session/ComposerOverlayComponents";
import { RenameModals } from "../RenameModals";
import { ConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import { usePiConfigFiles } from "../../hooks/files/usePiConfigFiles";
import { usePiConfigFileActions } from "../../hooks/files/usePiConfigFileActions";
import { fileNodeDragPayloadToRef } from "../app/AppUtils";
import { t } from "../../i18n";

/** 复用文件树和文档编辑器，仅切换数据与授权范围；不创建虚假的项目记录。 */
export function PiConfigFileExplorer(props: { api: PiDesktopApi; viewFilePath: (path: string, mode?: "preview" | "permanent", line?: number, scope?: FileAccessScope) => void }) {
	const tree = usePiConfigFiles(props.api);
	const actions = usePiConfigFileActions(props.api, tree.refresh);
	const menu = actions.menu;
	const rootMenu = menu?.node.path === tree.rootPath;
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="pi-config-file-tree">
			{tree.error && <p className="shrink-0 px-2 py-3 text-caption text-muted-foreground">{t("workspace.piConfigLoadFailed")}</p>}
			<FilesPanel
				key={tree.rootPath}
				files={tree.files}
				expandedDirs={tree.expandedDirs}
				onToggleDirectory={tree.toggleDirectory}
				onCollapseAll={tree.collapseAll}
				onRefreshFiles={() => void tree.refresh()}
				onOpenFolder={() => void actions.run(() => props.api.files.open(tree.rootPath, PI_CONFIG_FILE_SCOPE))}
				onOpenFile={(path) => void actions.run(() => props.api.files.open(path, PI_CONFIG_FILE_SCOPE))}
				onViewFile={(path, mode) => props.viewFilePath(path, mode, undefined, PI_CONFIG_FILE_SCOPE)}
				onFileContextMenu={(node, x, y) => actions.setMenu({ node, x, y })}
				projectRoot={tree.rootPath}
				search={props.api.files.searchPiConfig}
				absoluteReferences
				onDropFiles={actions.drop}
				onPasteFiles={actions.paste}
				onMoveFiles={actions.move}
			/>
			{menu && (
				<FileContextMenu
					menu={menu}
					onClose={() => actions.setMenu(null)}
					onOpen={() => {
						actions.setMenu(null);
						void actions.run(() => props.api.files.open(menu.node.path, PI_CONFIG_FILE_SCOPE));
					}}
					onReveal={() => {
						actions.setMenu(null);
						void actions.run(() => props.api.files.showInFolder(menu.node.path, PI_CONFIG_FILE_SCOPE));
					}}
					onCopyPath={() => {
						actions.setMenu(null);
						void actions.run(() => navigator.clipboard.writeText(menu.node.path));
					}}
					onAttach={() => {
						actions.setMenu(null);
						window.dispatchEvent(new CustomEvent("composer-attach-refs", { detail: { refs: [fileNodeDragPayloadToRef({ path: menu.node.path, relativePath: menu.node.path, type: menu.node.type })] } }));
					}}
					onRename={
						rootMenu
							? undefined
							: () => {
									actions.setRenaming({ path: menu.node.path, name: menu.node.name, input: menu.node.name });
									actions.setMenu(null);
								}
					}
					onDelete={
						rootMenu
							? undefined
							: () => {
									actions.setDeleting(menu.node);
									actions.setMenu(null);
								}
					}
					hasClipboardFiles={actions.hasClipboardFiles}
					onPaste={(directory) => {
						actions.setMenu(null);
						actions.paste(directory);
					}}
				/>
			)}
			{actions.renaming && (
				<RenameModals fileRename={{ path: actions.renaming.path, name: actions.renaming.name, inputValue: actions.renaming.input, onInputChange: (input) => actions.setRenaming((current) => (current ? { ...current, input } : null)), onClose: () => actions.setRenaming(null), onConfirm: actions.rename }} />
			)}
			{actions.deleting && (
				<ConfirmDialog
					title={t(actions.deleting.type === "directory" ? "drawer.deleteFolderTitle" : "drawer.deleteFileTitle")}
					message={t(actions.deleting.type === "directory" ? "drawer.deleteFolderConfirm" : "drawer.deleteFileConfirm", { name: actions.deleting.name })}
					danger
					confirmLabel={t("common.delete")}
					onCancel={() => actions.setDeleting(null)}
					onConfirm={() => {
						if (actions.deleting) actions.remove(actions.deleting);
					}}
				/>
			)}
		</div>
	);
}
