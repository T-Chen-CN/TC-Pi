import { useCallback, useEffect, useRef, useState } from "react";
import type { GitResourceGroups } from "../../../shared/types";

type GraphUpdatesOptions = {
	projectId: string;
	repoScopeKey: string;
	open: boolean;
	groups?: GitResourceGroups;
	getStatus: (projectId: string) => Promise<GitResourceGroups>;
	refreshWorkspace: () => void;
	refreshHistory: () => void;
	watchRefs?: (projectId: string) => Promise<string>;
	unwatchRefs?: (watchId: string) => Promise<void>;
	onRefsChanged?: (listener: (watchId: string) => void) => () => void;
};

/** Share the Changes pane status; only the multi-repository history pane reads its own. */
export function useGitGraphUpdates(options: GraphUpdatesOptions) {
	const apiRef = useRef(options);
	apiRef.current = options;
	const [localGroups, setLocalGroups] = useState<GitResourceGroups | undefined>();
	const [statusError, setStatusError] = useState<string | null>(null);
	const refreshStatusRef = useRef<() => void>(() => {});
	const hasSharedGroups = options.groups !== undefined;

	useEffect(() => {
		setLocalGroups(undefined);
		setStatusError(null);
		if (!options.open) return;
		let disposed = false;
		let statusPending = false;
		const refreshStatus = () => {
			if (hasSharedGroups || disposed || statusPending || document.hidden) return;
			statusPending = true;
			void apiRef.current
				.getStatus(options.projectId)
				.then((groups) => {
					if (!disposed) {
						setLocalGroups(groups);
						setStatusError(null);
					}
				})
				.catch((error: unknown) => {
					if (!disposed) setStatusError(error instanceof Error ? error.message : String(error));
				})
				.finally(() => {
					statusPending = false;
				});
		};
		refreshStatusRef.current = refreshStatus;
		refreshStatus();
		const timer = hasSharedGroups ? undefined : window.setInterval(refreshStatus, 5000);
		const refresh = () => {
			if (document.hidden || disposed) return;
			refreshStatus();
			apiRef.current.refreshHistory();
		};
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		const { watchRefs, unwatchRefs, onRefsChanged } = apiRef.current;
		let watchId: string | undefined;
		const unsubscribe = onRefsChanged?.((changedId) => {
			if (watchId === changedId) refresh();
		});
		if (watchRefs && unwatchRefs && onRefsChanged) {
			void watchRefs(options.projectId)
				.then((id) => {
					if (disposed) void unwatchRefs(id).catch(() => undefined);
					else watchId = id;
				})
				.catch(() => undefined);
		}
		return () => {
			disposed = true;
			refreshStatusRef.current = () => {};
			if (timer !== undefined) window.clearInterval(timer);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
			unsubscribe?.();
			if (watchId && unwatchRefs) void unwatchRefs(watchId).catch(() => undefined);
		};
	}, [options.projectId, options.repoScopeKey, options.open, hasSharedGroups]);

	const refreshWorkingTree = useCallback(() => {
		if (apiRef.current.groups) apiRef.current.refreshWorkspace();
		else refreshStatusRef.current();
	}, []);
	return { groups: options.groups ?? localGroups, statusError, refreshWorkingTree };
}
