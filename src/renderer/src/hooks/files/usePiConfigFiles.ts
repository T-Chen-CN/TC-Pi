import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode } from "../../../../shared/types";
import type { PiDesktopApi } from "../../../../preload";
import { loadProjectFileTree, markFileTreeLoadFailed, mergeFileTreeChildren } from "../../utils/fileTreeLazy";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";

const EXPANSION_KEY = "pideck:pi-config-expanded:v1";

function readExpansion(): Set<string> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(EXPANSION_KEY) ?? "[]");
		return new Set(Array.isArray(value) ? value.filter((path): path is string => typeof path === "string").slice(0, 1000) : []);
	} catch {
		return new Set();
	}
}

/** 配置树独立于 ProjectStore：保存目录展开状态，并拒绝卸载/刷新前的迟到请求。 */
export function usePiConfigFiles(api: PiDesktopApi) {
	const [rootPath, setRootPath] = useState("");
	const [files, setFiles] = useState<FileTreeNode[]>([]);
	const [expandedDirs, setExpandedDirs] = useState(readExpansion);
	const expandedRef = useRef(expandedDirs);
	expandedRef.current = expandedDirs;
	const generation = useRef(0);
	const [error, setError] = useState(false);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		try {
			const root = await api.files.listPiConfig();
			const tree = await loadProjectFileTree(
				() => Promise.resolve(root.files),
				expandedRef.current,
				() => generation.current === request,
				async (directory) => (await api.files.listPiConfig({ directory })).files,
			);
			if (!tree || request !== generation.current) return;
			setRootPath(root.rootPath);
			setFiles(tree);
			setError(false);
		} catch {
			if (request === generation.current) setError(true);
		}
	}, [api]);
	useEffect(() => {
		void refresh();
		return () => {
			generation.current += 1;
		};
	}, [refresh]);

	const saveExpansion = useCallback((next: Set<string>) => {
		expandedRef.current = next;
		setExpandedDirs(next);
		try {
			localStorage.setItem(EXPANSION_KEY, JSON.stringify([...next]));
		} catch {
			/* 存储不可用不阻断浏览。 */
		}
	}, []);
	const toggleDirectory = useCallback(
		(path: string) => {
			const next = new Set(expandedRef.current);
			if (next.has(path)) next.delete(path);
			else {
				next.add(path);
				const request = generation.current;
				void api.files
					.listPiConfig({ directory: path })
					.then((result) => {
						if (request === generation.current) setFiles((current) => mergeFileTreeChildren(current, path, result.files));
					})
					.catch(() => {
						if (request !== generation.current) return;
						setFiles((current) => markFileTreeLoadFailed(current, path));
						showNotice(t("workspace.piConfigLoadFailed"));
					});
			}
			saveExpansion(next);
		},
		[api, saveExpansion],
	);
	const collapseAll = useCallback(() => saveExpansion(new Set()), [saveExpansion]);
	return { rootPath, files, expandedDirs, error, refresh, toggleDirectory, collapseAll };
}
