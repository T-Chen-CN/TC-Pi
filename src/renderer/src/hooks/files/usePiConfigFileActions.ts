import { useCallback, useState } from "react";
import type { PiDesktopApi } from "../../../../preload";
import { PI_CONFIG_FILE_SCOPE, type FileTreeNode } from "../../../../shared/types";
import type { DrawerFileMenu } from "../../components/workspace/DrawerSurface";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";

/** 配置树的文件操作始终携带固定全局配置授权，不读取当前工作区作为目标。 */
export function usePiConfigFileActions(api: PiDesktopApi, refresh: () => Promise<void>) {
	const [menu, setMenu] = useState<DrawerFileMenu | null>(null);
	const [hasClipboardFiles, setHasClipboardFiles] = useState(false);
	const [renaming, setRenaming] = useState<{ path: string; name: string; input: string } | null>(null);
	const [deleting, setDeleting] = useState<FileTreeNode | null>(null);
	const run = useCallback(
		async (operation: () => Promise<unknown>, done?: () => void) => {
			try {
				await operation();
				done?.();
				await refresh();
			} catch (error) {
				showNotice(t("workspace.piConfigOperationFailed", { error: error instanceof Error ? error.message : String(error) }));
			}
		},
		[refresh],
	);
	const paste = useCallback(
		(directory: string) => {
			void run(async () => {
				const paths = api.files.getClipboardPaths();
				if (paths.length) await api.files.copy(paths, directory, PI_CONFIG_FILE_SCOPE);
			});
		},
		[api, run],
	);
	const drop = useCallback(
		(directory: string, files: FileList) => {
			void run(async () => {
				const paths = Array.from(files, (file) => api.files.getPathForFile(file)).filter(Boolean);
				if (paths.length) await api.files.copy(paths, directory, PI_CONFIG_FILE_SCOPE);
			});
		},
		[api, run],
	);
	const move = useCallback(
		(paths: string[], directory: string) => {
			void run(() => api.files.move(paths, directory, PI_CONFIG_FILE_SCOPE));
		},
		[api, run],
	);
	const rename = useCallback(
		(path: string, name: string) => {
			void run(
				() => api.files.rename(path, name, PI_CONFIG_FILE_SCOPE),
				() => setRenaming((current) => (current?.path === path ? null : current)),
			);
		},
		[api, run],
	);
	const remove = useCallback(
		(node: FileTreeNode) => {
			setDeleting(null);
			void run(() => api.files.delete(node.path, true, PI_CONFIG_FILE_SCOPE));
		},
		[api, run],
	);
	const openMenu = useCallback(
		(next: DrawerFileMenu | null) => {
			setMenu(next);
			if (next) {
				try {
					setHasClipboardFiles(api.files.getClipboardPaths().length > 0);
				} catch {
					setHasClipboardFiles(false);
				}
			}
		},
		[api],
	);
	return { menu, setMenu: openMenu, hasClipboardFiles, renaming, setRenaming, deleting, setDeleting, run, paste, drop, move, rename, remove };
}
