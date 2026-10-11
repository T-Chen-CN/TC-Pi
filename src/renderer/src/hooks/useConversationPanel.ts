import { useCallback, useState } from "react";

export const CONVERSATION_WIDTH_MIN = 320;
export const CONVERSATION_WIDTH_MAX = 800;
export const CONVERSATION_WIDTH_DEFAULT = 420;
const STORAGE_KEY = "pid:conversation-width";

/** 会话宽度是独立 chrome 偏好，工具开合和窗口缩放不改变它。 */
export function parseConversationWidth(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(CONVERSATION_WIDTH_MAX, Math.max(CONVERSATION_WIDTH_MIN, Math.round(value))) : CONVERSATION_WIDTH_DEFAULT;
}

/** 持久化用户拖拽后的宽度；存储不可用时仍允许正常调整布局。 */
export function useConversationPanel() {
	const [width, setWidth] = useState(() => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			return parseConversationWidth(saved === null ? undefined : Number(saved));
		} catch {
			return CONVERSATION_WIDTH_DEFAULT;
		}
	});
	const saveWidth = useCallback((next: number) => {
		const normalized = parseConversationWidth(next);
		setWidth(normalized);
		try {
			localStorage.setItem(STORAGE_KEY, String(normalized));
		} catch {
			// 缓存失败不影响面板的交互。
		}
	}, []);
	return { width, saveWidth };
}
