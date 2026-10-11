import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { SessionSplitLayout } from "../utils/sessionSplitEdge";

type ChromeState = { preview: string | null; split: SessionSplitLayout | null };

/** 按工作区保留预览标签和分屏现场；选择切换只改变投影，不删除草稿或历史。 */
export function useProjectSessionChrome(projectId: string | undefined) {
	const [byProject, setByProject] = useState<Record<string, ChromeState>>({});
	const projectRef = useRef(projectId);
	projectRef.current = projectId;
	const updatePreview = useCallback((id: string | undefined, update: SetStateAction<string | null>) => {
		if (!id) return;
		setByProject((all) => {
			const state = all[id] ?? { preview: null, split: null };
			const preview = typeof update === "function" ? update(state.preview) : update;
			return preview === state.preview ? all : { ...all, [id]: { ...state, preview } };
		});
	}, []);
	const setPreviewSessionTabId = useCallback((update: SetStateAction<string | null>) => updatePreview(projectRef.current, update), [updatePreview]);
	const setSplitLayout = useCallback((update: SetStateAction<SessionSplitLayout | null>) => {
		const id = projectRef.current;
		if (!id) return;
		setByProject((all) => {
			const state = all[id] ?? { preview: null, split: null };
			const split = typeof update === "function" ? update(state.split) : update;
			return split === state.split ? all : { ...all, [id]: { ...state, split } };
		});
	}, []);
	return { previewSessionTabId: projectId ? (byProject[projectId]?.preview ?? null) : null, splitLayout: projectId ? (byProject[projectId]?.split ?? null) : null, setPreviewSessionTabId, setSplitLayout, updatePreview, byProject };
}
