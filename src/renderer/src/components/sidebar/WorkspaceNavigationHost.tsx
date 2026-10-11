import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { workspaceNavigationHostAtom } from "../../atoms/workspace-navigation-atoms";

/** 会话标签栏右侧的单一落点；ref 卸载时清除，保留原侧栏 controller。 */
export function WorkspaceNavigationHost() {
	const setHost = useSetAtom(workspaceNavigationHostAtom);
	const ref = useCallback((element: HTMLDivElement | null) => setHost(element), [setHost]);
	return <div ref={ref} className="flex shrink-0 items-center" data-testid="conversation-navigation" />;
}

/** 保留原侧栏 controller 与菜单宿主，只迁移导航的呈现位置。 */
export function WorkspaceNavigationMount(props: { children: ReactNode }) {
	const host = useAtomValue(workspaceNavigationHostAtom);
	return host ? createPortal(props.children, host) : null;
}
