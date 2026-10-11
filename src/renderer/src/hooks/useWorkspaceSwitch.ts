import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../desktopApi";
import { showNotice } from "../utils/notice";
import { t } from "../i18n";

/** 选择域的唯一切换闸：空闲静默关闭，忙碌确认，失败/取消不改变选择。 */
export function useWorkspaceSwitch(projectId: string | undefined) {
	const source = useRef(projectId);
	const pending = useRef(false);
	const mounted = useRef(true);
	const answer = useRef<((value: boolean) => void) | undefined>(undefined);
	const [busyCount, setBusyCount] = useState<number | undefined>(undefined);
	useEffect(() => {
		source.current = projectId;
	}, [projectId]);
	const respond = useCallback((value: boolean) => {
		const resolve = answer.current;
		answer.current = undefined;
		setBusyCount(undefined);
		resolve?.(value);
	}, []);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			answer.current?.(false);
			answer.current = undefined;
		};
	}, []);
	const prepare = useCallback(async (toProjectId: string): Promise<boolean> => {
		if (!mounted.current || pending.current) return false;
		if (source.current === toProjectId) return true;
		pending.current = true;
		const fromProjectId = source.current;
		try {
			let result = await desktopApi.sessions.switchWorkspace({ fromProjectId, toProjectId, terminateBusy: false });
			if (!mounted.current) return false;
			if (result.status === "confirmation-required") {
				const confirmed = await new Promise<boolean>((resolve) => {
					answer.current = resolve;
					setBusyCount(result.status === "confirmation-required" ? result.busyCount : 0);
				});
				if (!confirmed || !mounted.current) return false;
				result = await desktopApi.sessions.switchWorkspace({ fromProjectId, toProjectId, terminateBusy: true });
				if (!mounted.current) return false;
			}
			if (result.status !== "ready") {
				showNotice(t("workspace.switchFailed", { error: result.status === "failed" ? result.error : t("workspace.navigationFailed") }), 5000);
				return false;
			}
			source.current = toProjectId;
			return true;
		} catch (error) {
			if (mounted.current) showNotice(t("workspace.switchFailed", { error: error instanceof Error ? error.message : String(error) }), 5000);
			return false;
		} finally {
			pending.current = false;
		}
	}, []);
	return { prepare, busyCount, respond };
}
