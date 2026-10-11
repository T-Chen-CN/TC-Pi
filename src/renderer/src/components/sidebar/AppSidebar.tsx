import { useRef, type ReactNode } from "react";
import type { WorkspaceNavigationPort } from "./WorkspaceNavigation";
import { useSetAtom } from "jotai";
import { PanelLeft } from "lucide-react";
import { SidebarContent, type SidebarActions } from "./SidebarContent";
import type { AppInfo, AppThemeMode, WorktreeEntry } from "../../../../shared/types";
import { useSidebarController } from "../../hooks/useSidebarController";
import { BrandLockup } from "../app/AppParts";
import { AboutPopover } from "../app/AboutPopover";
import { settingsOpenAtom } from "../../atoms";
import { desktopApi } from "../../desktopApi";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { WorkspaceProjectNavigation } from "./WorkspaceProjectNavigation";
import { WorkspaceNavigationMount } from "./WorkspaceNavigationHost";
import { SidebarNavigation, type SidebarHistoryNavigation } from "./SidebarNavigation";

interface AppSidebarProps {
	navigation: WorkspaceNavigationPort;
	historyNavigation: SidebarHistoryNavigation;
	workspaceFiles: ReactNode;
	simple?: boolean;
	actions: SidebarActions;
	currentProjectId: string | undefined;
	currentSessionId: string | undefined;
	worktreesByProject: Record<string, WorktreeEntry[]>;
	branchByProject: Record<string, string | null>;
	creatingWorktree: boolean;
	/** 正在删除的 worktree 路径集合（useWorktreeActions 维护，驱动行淡出动画）。 */
	removingWorktreePaths: ReadonlySet<string>;
	isLanWeb: boolean;
	/** 「新建会话」：打开初始引导页（居中输入框 + 项目下拉切换），由 App 提供。 */
	onOpenNewSession: () => void;
	/** 关于弹框（版本/官网/GitHub 链接）数据，由 App 从 AppInfo IPC 拉取后提供。 */
	appInfo: AppInfo;
	/** 底栏主题切换：当前主题模式 + 点击循环（浅色→暗色→跟随系统），由 App 提供。 */
	themeMode: AppThemeMode;
	onToggleTheme: () => void;
	/** 左侧栏折叠态与开关（main 布局：按钮在品牌文字右侧） */
	listCollapsed: boolean;
	toggleListCollapsed: () => void;
	/** settings.json 中已保存的展开项目 id，权威来源 */
	settingsExpandedProjectIds?: readonly string[];
	/** settings.json 中已保存的稳定 SessionRecord 置顶 id。 */
	settingsPinnedSessionIds?: readonly string[];
	/** 首次 settings.get 已完成，controller 可安全处理旧 key 迁移。 */
	settingsLoaded: boolean;
	/** 展开集合完成权威 hydration 后，允许 App 按它懒加载会话。 */
	onExpandedProjectsReady: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
	const setSettingsOpen = useSetAtom(settingsOpenAtom); // 快速连续点击展开/折叠会触发多次 IPC；按顺序写入可避免旧请求最后完成后覆盖新集合。
	const expandedProjectsSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const pinnedSessionIdsSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const controller = useSidebarController({
		getRpcLogging: props.actions.rpc.getLogging,
		openRpcLogViewer: props.actions.rpc.openViewer,
		settingsExpandedProjectIds: props.settingsExpandedProjectIds,
		settingsPinnedSessionIds: props.settingsPinnedSessionIds,
		settingsLoaded: props.settingsLoaded,
		onExpandedProjectsReady: props.onExpandedProjectsReady,
		persistExpandedProjectIds: (projectIds) => {
			expandedProjectsSaveQueueRef.current = expandedProjectsSaveQueueRef.current
				.catch(() => undefined)
				.then(() => desktopApi.settings.update({ sidebarExpandedProjectIds: projectIds }))
				.catch(() => undefined);
		},
		persistPinnedSessionIds: (sessionIds) => {
			// 快速连续置顶/取消置顶必须按触发顺序落盘，避免较慢的旧请求覆盖新集合。
			pinnedSessionIdsSaveQueueRef.current = pinnedSessionIdsSaveQueueRef.current
				.catch(() => undefined)
				.then(() => desktopApi.settings.update({ pinnedSessionIds: sessionIds }))
				.catch(() => undefined);
		},
	});

	return (
		<>
			<WorkspaceNavigationMount>
				<WorkspaceNavigation controller={controller} navigation={props.navigation} projectId={props.currentProjectId} sessionId={props.currentSessionId} />
			</WorkspaceNavigationMount>
			<SidebarContent
				navigation={props.navigation}
				workspaceFiles={props.workspaceFiles}
				simple={props.simple}
				controller={controller}
				actions={props.actions}
				currentProjectId={props.currentProjectId}
				currentSessionId={props.currentSessionId}
				worktreesByProject={props.worktreesByProject}
				branchByProject={props.branchByProject}
				creatingWorktree={props.creatingWorktree}
				removingWorktreePaths={props.removingWorktreePaths}
				isLanWeb={props.isLanWeb}
				onOpenNewSession={props.onOpenNewSession}
				chrome={
					<>
						<div className="list-toolbar flex h-14 shrink-0 items-center gap-1 py-2 pr-2.5 pl-[max(0.625rem,var(--traffic-lights-width,0px))] [&>div]:min-w-0 [&>div]:flex-1">
							<AboutPopover appInfo={props.appInfo}>
								<div
									className="app-badge flex min-w-0 flex-1 cursor-pointer items-center justify-center pl-5"
									role="button"
									tabIndex={0}
									aria-label={t("about.title")}
									title={t("about.clickHint")}
									onKeyDown={(e) => {
										// 键盘可达性：Enter/空格等价点击，触发 MorphPopoverTrigger 注入的 onClick
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											e.currentTarget.click();
										}
									}}
								>
									<BrandLockup />
								</div>
							</AboutPopover>
							<Button type="button" variant="ghost" size="icon-sm" className="list-toggle-native size-7 shrink-0" aria-label={props.listCollapsed ? t("app.expandList") : t("app.collapseList")} title={props.listCollapsed ? t("app.expandList") : t("app.collapseList")} onClick={props.toggleListCollapsed}>
								<PanelLeft size={14} strokeWidth={2} aria-hidden="true" />
							</Button>
						</div>
						<SidebarNavigation controller={controller} navigation={props.navigation} history={props.historyNavigation} projectId={props.currentProjectId}>
							<WorkspaceProjectNavigation controller={controller} navigation={props.navigation} projectId={props.currentProjectId} removingWorktreePaths={props.removingWorktreePaths} worktreesByProject={props.worktreesByProject} branchByProject={props.branchByProject} />
						</SidebarNavigation>
					</>
				}
				onOpenSettings={() => setSettingsOpen(true)}
				themeMode={props.themeMode}
				onToggleTheme={props.onToggleTheme}
			/>
		</>
	);
}
