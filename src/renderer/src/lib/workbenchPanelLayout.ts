/** 工作台宽度策略：工具开合只在文档区内调配空间，边栏宽度由各自偏好决定。 */
export const WORKBENCH_FILE_WIDTH_MIN = 200;

export interface WorkbenchPanelPreferences {
	list: number;
	conversation: number;
	drawer: number;
	listCollapsed: boolean;
	drawerOpen: boolean;
	listMinimum: number;
	conversationMinimum: number;
	drawerMinimum: number;
	/** 仅开合/初次恢复时优先保留会话宽度；主动拖动使用实际工具宽度。 */
	preserveConversation?: boolean;
}

export interface WorkbenchPanelWidths {
	list: number;
	files: number;
	conversation: number;
	drawer: number;
}

/** 保留左栏像素偏好，先花文档余量再压会话；预算不足时由容器最小宽度兜底。 */
export function planWorkbenchPanelWidths(groupPixels: number, preferences: WorkbenchPanelPreferences) {
	if (!Number.isFinite(groupPixels) || groupPixels <= 0) return null;
	const { listCollapsed, drawerOpen, conversationMinimum, drawerMinimum } = preferences;
	const list = listCollapsed ? 0 : preferences.list;
	const fileMinSize = WORKBENCH_FILE_WIDTH_MIN;
	const drawerMinSize = drawerOpen ? drawerMinimum : 0;
	const available = groupPixels - list;
	if (available < fileMinSize + conversationMinimum + drawerMinSize) return null;
	const conversationReserve = preferences.preserveConversation ? preferences.conversation : conversationMinimum;
	const drawerLimit = Math.max(drawerMinSize, available - fileMinSize - conversationReserve);
	const drawer = drawerOpen ? Math.min(Math.max(drawerMinSize, preferences.drawer), drawerLimit) : 0;
	const conversation = Math.min(preferences.conversation, available - drawer - fileMinSize);
	return { list, conversation, drawer, files: available - drawer - conversation, fileMinSize, drawerMinSize };
}

/** 保留面板键顺序，以整组 setLayout 原子更新，避免相邻面板 resize 的供体选择。 */
export function applyWorkbenchPanelWidths(layout: Record<string, number>, groupPixels: number, widths: WorkbenchPanelWidths) {
	return { ...layout, list: (widths.list / groupPixels) * 100, files: (widths.files / groupPixels) * 100, conversation: (widths.conversation / groupPixels) * 100, drawer: (widths.drawer / groupPixels) * 100 };
}

export type WorkbenchResizeTarget = "list" | "conversation" | "drawer";

export interface WorkbenchResizeLimits {
	listMinimum: number;
	listMaximum: number;
	conversationMinimum: number;
	conversationMaximum: number;
	drawerMinimum: number;
	drawerMaximum: number;
	conversationPreferred: number;
}

/** 从手势起点的快照计算，拖过下限后反向移动也不会累积误差或借用左栏。 */
export function resizeWorkbenchPanels(initial: WorkbenchPanelWidths, target: WorkbenchResizeTarget, delta: number, limits: WorkbenchResizeLimits): WorkbenchPanelWidths {
	if (!Number.isFinite(delta) || delta === 0) return { ...initial };
	const total = initial.list + initial.files + initial.conversation + initial.drawer;
	const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
	if (target === "conversation") {
		const conversation = clamp(initial.conversation - delta, limits.conversationMinimum, Math.min(limits.conversationMaximum, initial.files + initial.conversation - WORKBENCH_FILE_WIDTH_MIN));
		return { ...initial, conversation, files: initial.files + initial.conversation - conversation };
	}
	if (target === "list") {
		const list = clamp(initial.list + delta, limits.listMinimum, Math.min(limits.listMaximum, total - initial.drawer - WORKBENCH_FILE_WIDTH_MIN - limits.conversationMinimum));
		const conversation = Math.min(initial.conversation, total - list - initial.drawer - WORKBENCH_FILE_WIDTH_MIN);
		return { ...initial, list, conversation, files: total - list - initial.drawer - conversation };
	}
	const available = total - initial.list;
	const drawer = clamp(initial.drawer - delta, limits.drawerMinimum, Math.min(limits.drawerMaximum, available - WORKBENCH_FILE_WIDTH_MIN - limits.conversationMinimum));
	// 缩小工具时恢复被借用的会话空间；其用户偏好只由会话分隔线保存。
	const conversation = Math.min(Math.max(initial.conversation, limits.conversationPreferred), available - drawer - WORKBENCH_FILE_WIDTH_MIN);
	return { ...initial, drawer, conversation, files: available - drawer - conversation };
}
