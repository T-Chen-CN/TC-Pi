import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** 页面只控制呈现；回到总览不清空工作区、会话或运行时。 */
export const workspacePageAtom = atom<"home" | "workspace">("home");
export const workspaceListsAtom = atomWithStorage("pideck:workspace-lists:v1", { projects: false, sessions: false });
export const workspaceLastSessionsAtom = atomWithStorage<Record<string, string>>("pideck:workspace-last-sessions:v1", {});

/** 只保存导航的 DOM 落点；菜单与列表状态仍由唯一 SidebarController 拥有，卸载时清空。 */
export const workspaceNavigationHostAtom = atom<HTMLDivElement | null>(null);
