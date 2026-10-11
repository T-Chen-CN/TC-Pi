import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { type Layout, type LayoutChangedMeta, type PanelImperativeHandle, type GroupImperativeHandle } from "react-resizable-panels";
import { ControlledResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui-shadcn/resizable";
import { AppHeader } from "../AppHeader";
import { WorkspaceDrawerHost } from "../workspace/WorkspaceDrawerHost";
import { useNotifyLayoutResized } from "../../hooks/useNotifyLayoutResized";
import { DRAWER_WIDTH_MAX, type WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";
import { cn } from "../../lib/utils";
import { useConversationPanel, CONVERSATION_WIDTH_MIN, CONVERSATION_WIDTH_MAX } from "../../hooks/useConversationPanel";
import { useWorkbenchPanelLayout } from "../../hooks/useWorkbenchPanelLayout";
import { useWorkbenchPanelResize } from "../../hooks/useWorkbenchPanelResize";
import { PanelLeft } from "lucide-react";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";

/**
 * 文件优先工作台外壳：文件树、中央文件、常驻会话与可折叠工具分别拥有固定面板身份。
 * 工具优先借用文件余量，再借会话余量；左栏只接受自己的主动调整。
 * 总览只覆盖中央，访问总览不卸载编辑器或会话。
 * px 偏好只在用户拖拽/键盘操作结束后保存，受窗口约束的实际宽度仅用于 CSS 定位。
 * preserve-pixel-size 保住侧栏、会话和工具宽度，窗口余量交给中央。
 * 面板开合由统一 hook 在绘制前原子分配；ResizeObserver 与动画均有配对清理。
 */

export interface AppShellProps {
	/** 视觉 chrome 与导航入口位置独立；简洁外观不再占用全宽导航行。 */
	simple?: boolean;
	/** Compact mode reuses this window's session store and preserves workbench layout preferences. */
	compactContent?: ReactNode;
	listCollapsed: boolean;
	listWidth: number;
	drawer: WorkspaceDrawerPanel | null;
	drawerCollapsed: boolean;
	drawerWidth: number;
	drawerPinned: boolean;
	useNativeTitleBar: boolean;
	/** 当前运行平台；mac 自定义标题栏要避开系统红绿灯，不能再画一套 Win 按钮。 */
	platform: NodeJS.Platform;

	chatPaneRef: React.RefObject<HTMLElement | null>;
	terminalRowHeight: number;
	/** 聊天内容区占面板百分比（60–100），注入 --chat-content-pct-set，由 CSS 容器查询自适应分屏 */
	chatContentWidthPct: number;
	/** 额外的会话右缘偏移；文件区在会话左边，文件优先布局传 0。 */
	outlineContentOffset: number;

	sidebarContent: ReactNode;
	chatPaneContent: ReactNode;
	filePaneContent: ReactNode;
	/** 总览仅覆盖中央文件区域，会话始终保持可见。 */
	overview?: ReactNode;
	drawerContent: (panel: WorkspaceDrawerPanel) => ReactNode;
	/** 抽屉活动栏（files/git/browser 切换），由 App 注入；抽屉打开时常驻。 */
	drawerRail?: ReactNode;
	outlineContent?: ReactNode;

	setListCollapsed: (v: boolean) => void;
	setListWidth: (v: number) => void;
	setDrawerCollapsed: (v: boolean) => void;
	setDrawerWidth: (v: number) => void;
	onToggleListCollapsed: () => void;
	onDrawerCollapse: () => void;
	onDrawerClose: () => void;
	onDrawerRestore: () => void;
	onToggleDrawerPin: () => void;

	toggleAlwaysOnTop: () => Promise<boolean>;
	isWindowAlwaysOnTop: () => Promise<boolean>;
	minimizeWindow: () => void;
	toggleMaximizeWindow: () => Promise<boolean>;
	isWindowMaximized: () => Promise<boolean>;
	onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
	closeWindow: () => void;

	children?: ReactNode;
}

/** 侧栏收起后保留的边缘提示条宽度（对齐旧 grid 实现） */
const LIST_COLLAPSED_SIZE = 0;

/** 将面板库的实际布局宽度同步给只读 CSS 变量，不触发 React 状态/持久化回写。 */
function writeListLayoutVariables(shell: HTMLElement, width: number, visible: boolean) {
	shell.style.setProperty("--list-width", `${visible ? width : 0}px`);
	shell.style.setProperty("--list-expanded-width", `${width}px`);
	shell.style.setProperty("--list-hover-width", `${Math.max(190, width)}px`);
}

/** 将抽屉的实际布局宽度同步给悬浮入口定位变量。 */
function writeDrawerLayoutVariables(shell: HTMLElement, width: number, visible: boolean) {
	const renderedWidth = visible ? width : 0;
	shell.style.setProperty("--drawer-width", `${renderedWidth}px`);
	shell.style.setProperty("--drawer-col-w", `${renderedWidth}px`);
	shell.style.setProperty("--drawer-splitter-w", `${visible ? 6 : 0}px`);
}

export function AppShell(props: AppShellProps) {
	const {
		listCollapsed,
		listWidth,
		drawer,
		drawerCollapsed: workspaceDrawerCollapsed,
		drawerWidth,
		drawerPinned: workspaceDrawerPinned,
		useNativeTitleBar,
		platform,
		chatPaneRef,
		terminalRowHeight,
		chatContentWidthPct,
		outlineContentOffset,
		sidebarContent,
		chatPaneContent,
		drawerContent,
		drawerRail,
		outlineContent,
		setListCollapsed,
		setListWidth,
		setDrawerCollapsed,
		setDrawerWidth,
		onToggleListCollapsed,
		onDrawerCollapse,
		onDrawerClose,
		onDrawerRestore,
		onToggleDrawerPin,
		toggleAlwaysOnTop,
		isWindowAlwaysOnTop,
		minimizeWindow,
		toggleMaximizeWindow,
		isWindowMaximized,
		onWindowMaximizedChange,
		closeWindow,
		children,
	} = props;
	const hasDrawer = Boolean(drawer);
	const drawerCollapsed = workspaceDrawerCollapsed;
	const drawerPinned = workspaceDrawerPinned;
	const conversationPanel = useConversationPanel();
	const groupRef = useRef<GroupImperativeHandle | null>(null);
	const panelGroupElementRef = useRef<HTMLDivElement | null>(null);
	const resize = useWorkbenchPanelResize({ groupRef, elementRef: panelGroupElementRef, enabled: !props.compactContent, listCollapsed, drawerOpen: hasDrawer && !drawerCollapsed, drawerPinned, conversationWidth: conversationPanel.width, setListWidth, setDrawerWidth, saveConversationWidth: conversationPanel.saveWidth });
	const layoutListWidth = resize.listDragWidth ?? listWidth;
	const panelLayout = useWorkbenchPanelLayout({
		groupRef,
		elementRef: panelGroupElementRef,
		enabled: !props.compactContent,
		listWidth: layoutListWidth,
		listCollapsed,
		conversationWidth: conversationPanel.width,
		drawerWidth,
		drawerLayoutWidth: resize.drawerLayoutWidth,
		drawerOpen: hasDrawer && !drawerCollapsed,
		drawerPinned,
	});

	const shellRef = useRef<HTMLDivElement | null>(null);
	const listPanelRef = useRef<PanelImperativeHandle | null>(null);
	const listPanelElementRef = useRef<HTMLDivElement | null>(null);
	const drawerPanelElementRef = useRef<HTMLDivElement | null>(null);
	// 这两个 ref 表示当前实际布局宽度，只用于 CSS 定位；不进入持久化状态。
	const listLayoutWidthRef = useRef(listWidth);
	const drawerLayoutWidthRef = useRef(drawerWidth);
	const notifyLayoutResized = useNotifyLayoutResized();

	// 抽屉/侧栏“刚打开”标志：closed→open 时给内容容器挂一次进入动画类；
	// 动画结束（onAnimationEnd）移除。面板库 collapse/expand 是即时宽度，
	// 内容动画只动 transform/opacity，且播完无残留。
	const [drawerEntering, setDrawerEntering] = useState(false);
	const [listEntering, setListEntering] = useState(false);
	const prevDrawerOpenRef = useRef(false);
	const prevListOpenRef = useRef(false);
	useEffect(() => {
		const open = hasDrawer && !drawerCollapsed;
		if (open && !prevDrawerOpenRef.current) setDrawerEntering(true);
		prevDrawerOpenRef.current = open;
	}, [hasDrawer, drawerCollapsed]);
	useEffect(() => {
		const open = !listCollapsed;
		if (open && !prevListOpenRef.current) setListEntering(true);
		prevListOpenRef.current = open;
	}, [listCollapsed]);

	// 水合或用户拖拽改变保存宽度后，先让定位变量跟随保存值；面板若受到约束，
	// 下方 ResizeObserver 会再用实际 DOM 宽度校正。observer 只改 CSS，不触发每帧 React 重渲染。
	useEffect(() => {
		listLayoutWidthRef.current = listWidth;
		const shell = shellRef.current;
		if (shell) writeListLayoutVariables(shell, listWidth, !listCollapsed);
	}, [listWidth, listCollapsed]);
	useEffect(() => {
		drawerLayoutWidthRef.current = drawerWidth;
		const shell = shellRef.current;
		if (shell) writeDrawerLayoutVariables(shell, drawerWidth, hasDrawer && !drawerCollapsed);
	}, [drawerWidth, hasDrawer, drawerCollapsed]);

	// 面板受窗口约束、钉住状态或拖拽影响时，实际 DOM 宽度可能与保存偏好不同。
	// 只把这个瞬时值写入 CSS 定位变量，绝不写回 listWidth/drawerWidth 缓存。
	useEffect(() => {
		const shell = shellRef.current;
		const listElement = listPanelElementRef.current;
		const drawerElement = drawerPanelElementRef.current;
		if (!shell || typeof ResizeObserver === "undefined") return;

		const syncActualWidths = () => {
			if (listElement && !listCollapsed) {
				const width = Math.round(listElement.getBoundingClientRect().width);
				if (width > 1) {
					listLayoutWidthRef.current = width;
					writeListLayoutVariables(shell, width, true);
				}
			}
			if (drawerElement && hasDrawer && !drawerCollapsed) {
				const width = Math.round(drawerElement.getBoundingClientRect().width);
				if (width > 1) {
					drawerLayoutWidthRef.current = width;
					writeDrawerLayoutVariables(shell, width, true);
				}
			}
		};

		const observer = new ResizeObserver(syncActualWidths);
		if (listElement) observer.observe(listElement);
		if (drawerElement) observer.observe(drawerElement);
		syncActualWidths();
		return () => observer.disconnect();
	}, [hasDrawer, drawerCollapsed, drawerPinned, listCollapsed]);

	// Group 回调只负责定位通知与启动自愈；偏好回写由 resize hook 根据手势目标处理。
	function handleLayoutChanged(_layout: Layout, meta: LayoutChangedMeta) {
		// 无论交互还是程序化变更，布局落定后都通知悬浮层重算一次。
		notifyLayoutResized();

		// 约束重解意外折叠列表时，用同一原子策略恢复；不能再次走相邻 resize 挤动会话。
		if (!meta.isUserInteraction) {
			const listPanel = listPanelRef.current;
			if (listPanel && !listCollapsed && listPanel.isCollapsed()) {
				panelLayout.syncPanelLayout();
			}
			return;
		}
	}

	if (props.compactContent) {
		return (
			<div className={["wechat-shell quick-task-shell bg-bg-app [[data-bg-image=on]_&]:bg-transparent", "", useNativeTitleBar ? "" : "custom-titlebar-enabled", !useNativeTitleBar && platform === "darwin" ? "mac-custom-titlebar" : ""].filter(Boolean).join(" ")}>
				{
					<AppHeader
						useNativeTitleBar={useNativeTitleBar}
						platform={platform}
						toggleAlwaysOnTop={toggleAlwaysOnTop}
						isWindowAlwaysOnTop={isWindowAlwaysOnTop}
						minimizeWindow={minimizeWindow}
						toggleMaximizeWindow={toggleMaximizeWindow}
						isWindowMaximized={isWindowMaximized}
						onWindowMaximizedChange={onWindowMaximizedChange}
						closeWindow={closeWindow}
					/>
				}
				<main ref={chatPaneRef} className="flex min-h-0 flex-1 flex-col">
					{props.compactContent}
				</main>
				{children}
			</div>
		);
	}
	return (
		<div
			ref={shellRef}
			className={[
				"wechat-shell",
				props.simple
					? "simple-shell bg-(--simple-shell-surface) [--simple-shell-surface:color-mix(in_srgb,var(--color-bg-sidebar)_25%,var(--color-bg-muted))] dark:[--simple-shell-surface:var(--color-bg-app)] [[data-bg-image=on]_&]:bg-transparent [[data-bg-image=on]_&]:[--simple-shell-surface:var(--color-bg-sidebar)] [&_.session-tabs-bar]:mr-0 [&_.session-tabs-bar]:[-webkit-app-region:no-drag]"
					: "bg-bg-app [[data-bg-image=on]_&]:bg-transparent",
				hasDrawer && !drawerCollapsed ? "drawer-open" : "",
				listCollapsed ? "list-collapsed" : "",
				drawerCollapsed ? "drawer-collapsed" : "",
				useNativeTitleBar ? "" : "custom-titlebar-enabled",
				// mac 自定义标题栏：系统红绿灯占左上角，右侧不再叠 Win 风格控件。
				!useNativeTitleBar && platform === "darwin" ? "mac-custom-titlebar" : "",
			]
				.filter(Boolean)
				.join(" ")}
			style={
				{
					"--list-width": `${listCollapsed ? 0 : listLayoutWidthRef.current}px`,
					"--list-expanded-width": `${listLayoutWidthRef.current}px`,
					"--list-hover-width": `${Math.max(190, listLayoutWidthRef.current)}px`,
					"--drawer-width": `${hasDrawer && !drawerCollapsed ? drawerLayoutWidthRef.current : 0}px`,
					"--drawer-col-w": `${hasDrawer && !drawerCollapsed ? drawerLayoutWidthRef.current : 0}px`,
					"--drawer-splitter-w": `${hasDrawer && !drawerCollapsed ? 6 : 0}px`,
					// 右缘刻度定位轴（.outline-hover）的底部边界：终端坞打开时让出其高度，
					// 避免刻度铺到终端上；关闭时保底 16px 边距。
					"--outline-bottom": `${Math.max(terminalRowHeight, 0) + 16}px`,
					// 工作台分屏（文件/Diff 在右）时右移内容区宽度，让刻度落在消息区右缘；
					// solo/maximize 时为 0（消息区独占或收起），刻度回窗口右缘。
					"--outline-content-w": `${Math.max(outlineContentOffset, 0)}px`,
				} as CSSProperties
			}
		>
			<AppHeader
				simple={props.simple}
				useNativeTitleBar={useNativeTitleBar}
				platform={platform}
				toggleAlwaysOnTop={toggleAlwaysOnTop}
				isWindowAlwaysOnTop={isWindowAlwaysOnTop}
				minimizeWindow={minimizeWindow}
				toggleMaximizeWindow={toggleMaximizeWindow}
				isWindowMaximized={isWindowMaximized}
				onWindowMaximizedChange={onWindowMaximizedChange}
				closeWindow={closeWindow}
			/>
			<div className="flex min-h-0 flex-1 overflow-x-auto">
				{/* 收起的列表仍保留左侧恢复入口；放在 Group 外避免污染库的分隔条命中。 */}
				{listCollapsed && (
					<div className="relative z-[930] flex w-9 shrink-0 flex-col items-center border-r border-border/40 bg-bg-sidebar pt-1 [.mac-custom-titlebar_&]:pt-[var(--window-drag-height)]" data-testid="sidebar-restore-rail">
						<Button variant="ghost" size="icon-sm" className="size-7 [-webkit-app-region:no-drag]" aria-label={t("app.expandList")} title={t("app.expandList")} onClick={onToggleListCollapsed}>
							<PanelLeft className="size-3.5" />
						</Button>
					</div>
				)}
				<ResizablePanelGroup orientation="horizontal" groupRef={groupRef} elementRef={panelGroupElementRef} className="shell-panel-group" disabled style={{ minWidth: panelLayout.minimumGroupWidth }} onLayoutChanged={handleLayoutChanged}>
					<ResizablePanel id="list" panelRef={listPanelRef} collapsible collapsedSize={LIST_COLLAPSED_SIZE} minSize={layoutListWidth} maxSize={layoutListWidth} groupResizeBehavior="preserve-pixel-size" defaultSize={listCollapsed ? LIST_COLLAPSED_SIZE : listWidth} className="shell-panel-list">
						<div
							ref={listPanelElementRef}
							className={cn("h-full min-w-0", listCollapsed && "hidden", listEntering && "list-content-enter")}
							aria-hidden={listCollapsed || undefined}
							inert={listCollapsed}
							onAnimationEnd={(event) => {
								if (event.target === event.currentTarget) setListEntering(false);
							}}
						>
							{sidebarContent}
						</div>
					</ResizablePanel>
					{/* 禁用库的相邻借宽与双击归零手势，分隔线统一走可测策略；收起走专属按钮。 */}
					<ControlledResizableHandle className={cn("splitter splitter-left", props.simple && "before:hidden")} {...resize.getHandleProps("list")} aria-label={t("app.resizeList")} />

					<ResizablePanel id="files" minSize={panelLayout.fileMinSize} className="h-full min-h-0 min-w-0">
						<main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg-panel" data-testid="file-region">
							<div className={cn("contents", props.overview && "invisible")} aria-hidden={props.overview ? true : undefined} inert={Boolean(props.overview)}>
								{props.filePaneContent}
							</div>
							{props.overview && <div className="absolute inset-0 bg-bg-panel">{props.overview}</div>}
						</main>
					</ResizablePanel>
					<ControlledResizableHandle className="splitter border-l border-border/50" {...resize.getHandleProps("conversation")} aria-label={t("workbench.resizeConversation")} />
					<ResizablePanel id="conversation" minSize={CONVERSATION_WIDTH_MIN} maxSize={CONVERSATION_WIDTH_MAX} defaultSize={conversationPanel.width} groupResizeBehavior="preserve-pixel-size" className="shell-panel-chat h-full min-h-0 min-w-0">
						<div className="flex h-full min-h-0 min-w-0 flex-col" data-testid="conversation-region">
							{/* 只保留窗口控件空间；选择会话已并入标签栏，工具开合不改纵向位置。 */}
							<div className="shrink-0 [.custom-titlebar-enabled:not(.mac-custom-titlebar)_&]:pt-[var(--window-drag-height)]" />
							<main
								ref={chatPaneRef}
								className={cn("chat-pane flex-1 h-auto min-h-0 bg-bg-panel", props.simple && "rounded-tl-[18px]")}
								style={
									{
										"--terminal-row-h": `${terminalRowHeight}px`,
										// 内容宽度百分比（60–100）：消息区/输入框用 var(--chat-content-pct-set) 做 width。
										"--chat-content-pct-set": `${chatContentWidthPct}%`,
									} as CSSProperties
								}
							>
								{chatPaneContent}
							</main>
						</div>
					</ResizablePanel>

					{/* 工具面板常驻挂载；关闭时下限归零，钉住也不能强行重开并借走左栏宽度。 */}
					<ControlledResizableHandle className="splitter splitter-right" data-active={hasDrawer && !drawerCollapsed} {...resize.getHandleProps("drawer")} aria-label={t("workbench.resizeTools")} />
					<ResizablePanel id="drawer" collapsible={!drawerPinned || !hasDrawer || drawerCollapsed} collapsedSize={0} minSize={panelLayout.drawerMinSize} maxSize={DRAWER_WIDTH_MAX} groupResizeBehavior="preserve-pixel-size" defaultSize={0} className="shell-panel-drawer">
						<div
							ref={drawerPanelElementRef}
							className={cn("relative h-full min-w-0", drawerEntering && "drawer-content-enter")}
							onAnimationEnd={(event) => {
								if (event.target === event.currentTarget) setDrawerEntering(false);
							}}
						>
							<WorkspaceDrawerHost panel={drawer} collapsed={workspaceDrawerCollapsed} pinned={workspaceDrawerPinned} onCollapse={onDrawerCollapse} onClose={onDrawerClose} onRestore={onDrawerRestore} onTogglePin={onToggleDrawerPin} rail={drawerRail} renderPanel={(panel) => drawerContent(panel)} />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
			{/* 大纲浮层必须放在 Group 外：v4 只认 data-panel / data-separator 直系子节点，
          夹在 panel 之间会污染分隔条命中区计算（absolute 也不算例外）。 */}
			{outlineContent}
			{children}
		</div>
	);
}
