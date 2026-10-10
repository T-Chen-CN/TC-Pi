import { atom } from "jotai";

/** 并行问询：结果弹框是否可见 */
export const askPanelOpenAtom = atom(false);
/** 并行问询的普通会话 id；关闭面板保留历史。 */
export const askPanelSessionIdAtom = atom<string | null>(null);
/** 发起并行问询的主会话 id（用于「带回主线：插入主会话 composer」，关闭弹框即清空） */
export const askPanelOriginSessionIdAtom = atom<string | null>(null);
/** 问询会话创建中（发送按钮显示 loading 防重复点击） */
export const askPanelCreatingAtom = atom(false);
/** 多个 hook 实例共享取消代次，关闭期间的迟到激活不能重新打开面板。 */
export const askPanelGenerationAtom = atom(0);
