import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { applyWorkbenchPanelWidths, planWorkbenchPanelWidths, WORKBENCH_FILE_WIDTH_MIN } from "../lib/workbenchPanelLayout";
import { LIST_WIDTH_MIN } from "./useResize";
import { CONVERSATION_WIDTH_MIN } from "./useConversationPanel";
import { DRAWER_WIDTH_MIN, DRAWER_WIDTH_MIN_PINNED } from "./useWorkspacePanels";

interface WorkbenchPanelLayoutOptions {
	groupRef: RefObject<GroupImperativeHandle | null>;
	elementRef: RefObject<HTMLDivElement | null>;
	enabled: boolean;
	listWidth: number;
	listCollapsed: boolean;
	conversationWidth: number;
	drawerWidth: number;
	drawerLayoutWidth?: number | null;
	drawerOpen: boolean;
	drawerPinned: boolean;
}

/** 与面板库共用 CSS 像素坐标；分隔条不参与百分比布局，不能计入宽度预算。 */
function measurePanelBudget(element: HTMLDivElement) {
	const separatorWidth = Array.from(element.children).reduce((sum, child) => sum + (child instanceof HTMLElement && child.hasAttribute("data-separator") ? child.offsetWidth : 0), 0);
	return element.clientWidth - separatorWidth;
}

/** 单一布局同步入口：开合、偏好恢复和窗口尺寸变化均在绘制前原子分配四栏。 */
export function useWorkbenchPanelLayout(options: WorkbenchPanelLayoutOptions) {
	const { groupRef, elementRef, enabled, listWidth, listCollapsed, conversationWidth, drawerWidth, drawerLayoutWidth, drawerOpen, drawerPinned } = options;
	const [groupPixels, setGroupPixels] = useState(0);
	const drawerMinimum = drawerPinned ? DRAWER_WIDTH_MIN_PINNED : DRAWER_WIDTH_MIN;
	// 不允许其他栏借走左栏或突破阅读下限；极窄窗口保留最小工作台宽度。
	const minimumGroupWidth = (listCollapsed ? 0 : listWidth) + WORKBENCH_FILE_WIDTH_MIN + CONVERSATION_WIDTH_MIN + (drawerOpen ? drawerMinimum : 0) + (drawerOpen ? 3 : 2);
	const widths = useMemo(
		() => planWorkbenchPanelWidths(groupPixels, { list: listWidth, conversation: conversationWidth, drawer: drawerLayoutWidth ?? drawerWidth, preserveConversation: drawerLayoutWidth == null, listCollapsed, drawerOpen, listMinimum: LIST_WIDTH_MIN, conversationMinimum: CONVERSATION_WIDTH_MIN, drawerMinimum }),
		[groupPixels, listWidth, conversationWidth, drawerWidth, drawerLayoutWidth, listCollapsed, drawerOpen, drawerMinimum],
	);

	useLayoutEffect(() => {
		const element = elementRef.current;
		if (!enabled || !element) return;
		const measure = () => setGroupPixels(measurePanelBudget(element));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [elementRef, enabled, listCollapsed, drawerOpen]);

	const syncPanelLayout = useCallback(() => {
		const group = groupRef.current;
		if (!enabled || !group || !widths) return;
		const layout = group.getLayout();
		// Group 初次注册尚无四栏约束时等待下一次 layout effect，不提交残缺布局。
		if (![layout.list, layout.files, layout.conversation, layout.drawer].every(Number.isFinite)) return;
		group.setLayout(applyWorkbenchPanelWidths(layout, groupPixels, widths));
	}, [enabled, groupRef, groupPixels, widths]);

	useLayoutEffect(syncPanelLayout, [syncPanelLayout]);
	return { syncPanelLayout, minimumGroupWidth, fileMinSize: WORKBENCH_FILE_WIDTH_MIN, drawerMinSize: drawerOpen ? drawerMinimum : 0 };
}
