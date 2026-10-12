import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** 页面只控制呈现；回到总览不清空工作区、会话或运行时。 */
export const piConfigDocumentVisibleAtom = atom(false);
const workspacePageValueAtom = atom<"home" | "workspace">("home");
/** 每次主动回主界面都显示总览，同时保留已经打开的全局配置文件。 */
export const workspacePageAtom = atom(
	(get) => get(workspacePageValueAtom),
	(_get, set, page: "home" | "workspace") => {
		set(workspacePageValueAtom, page);
		if (page === "home") set(piConfigDocumentVisibleAtom, false);
	},
);
export const workspaceListsAtom = atomWithStorage("pideck:workspace-lists:v1", { projects: false, sessions: false });
export const workspaceLastSessionsAtom = atomWithStorage<Record<string, string>>("pideck:workspace-last-sessions:v1", {});

/** 只保存导航的 DOM 落点；菜单与列表状态仍由唯一 SidebarController 拥有，卸载时清空。 */
export const workspaceNavigationHostAtom = atom<HTMLDivElement | null>(null);
