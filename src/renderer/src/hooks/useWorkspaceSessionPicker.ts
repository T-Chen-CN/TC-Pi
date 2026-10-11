import { useCallback, useEffect, useRef, useState } from "react";
import type { SidebarActions } from "../components/sidebar/SidebarContent";

/** 临时会话浮层的唯一 owner；关闭、换工作区或卸载后拒绝迟到选择结果。 */
export function useWorkspaceSessionPicker(projectId: string | undefined, actions: SidebarActions["sessions"]) {
	const [state, setState] = useState({ projectId, open: false });
	const snapshot = useRef({ projectId, actions });
	snapshot.current = { projectId, actions };
	const revision = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		++revision.current;
		setState({ projectId, open: false });
	}, [projectId]);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			++revision.current;
		};
	}, []);
	const setOpen = useCallback((open: boolean) => {
		++revision.current;
		const current = snapshot.current;
		setState({ projectId: current.projectId, open });
		if (open && current.projectId) current.actions.ensureCatalogsLoaded([current.projectId]);
	}, []);
	const select = useCallback(
		async (targetProjectId: string, sessionId: string) => {
			if (!mounted.current || targetProjectId !== snapshot.current.projectId) return false;
			const request = ++revision.current;
			const accepted = await snapshot.current.actions.open(targetProjectId, sessionId, "permanent");
			if (accepted === false) return false;
			if (mounted.current && request === revision.current && targetProjectId === snapshot.current.projectId) setOpen(false);
			return true;
		},
		[setOpen],
	);
	return { open: state.open && state.projectId === projectId, setOpen, select };
}
