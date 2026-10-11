import { toBlob } from "html-to-image";
import "katex/dist/katex.min.css";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent as ReactWheelEvent, type RefObject } from "react";
import { writeClipboard, writeClipboardImage } from "../../utils/clipboard";
import { messageEntryId } from "../../utils/sessionCommands";
import { PreviewRail, type PreviewRailItem } from "../motion/preview-rail";
import { Textarea } from "../ui-shadcn/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";
import { MarkdownStream } from "./MarkdownStream";
import { areOutlineRailItemsEqual, createOutlineItemIndex, resolveVisibleRailActiveId } from "./timeline/outlineRailActive";
import { planRailTicks } from "./timeline/outlineRailTicks";
import { useTimelineOutlineActiveId } from "./timeline/useTimelineOutlineActiveId";

/**
 * 消息图片按需解码：base64 data URL 的字符串已在消息对象中（无法省字符串），
 * 但解码出的位图是内存大头（一张截图 1~5MB）——视口外不设 src 不解码，
 * 进入视口（含 200px 提前量）才挂载 src；未加载时占位高度避免滚动跳动。
 * decoding="async" 保证解码不阻塞渲染主线程。
 */
function MessageImage(props: {
	src: string;
	alt: string;
	className: string;
	onClick?: () => void;
	/** 未加载时的占位高度类（无固定尺寸的图片防滚动跳动；固定尺寸缩略图无需传） */
	placeholderClass?: string;
}) {
	const ref = useRef<HTMLImageElement>(null);
	const [inView, setInView] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					setInView(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return <img ref={ref} src={inView ? props.src : undefined} alt={props.alt} className={`${props.className}${!inView && props.placeholderClass ? ` ${props.placeholderClass}` : ""}`} loading="lazy" decoding="async" onClick={props.onClick} />;
}

// Mermaid 库体积数 MB，仅在真正出现 mermaid 代码块时才动态加载，
// 避免随渲染进程常驻、放大内存占用并在流式期间抢占主线程。
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleDot, Copy, FileText, Folder, GitFork, LoaderCircle, MessageSquare, Quote, Send, Share, Sparkles, SquarePen, Trash, Undo2, UserPen, X } from "lucide-react";
import removeMarkdown from "remove-markdown";
import { imageContentSrc } from "../../../../shared/imageContentSrc";
import type { AgentRuntimeState, ChatMessage, ImageContent } from "../../../../shared/types";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import { showNotice } from "../../utils/notice";
import { Button } from "../ui-shadcn/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui-shadcn/dropdown-menu";
import { formatChipDisplayLabel, isDirectoryFileChip, parseRichInputChips, unwrapFileChipPath } from "./composer/chips";
import type { BubbleRefSegment } from "./composer/quoteChip";
import { buildBubbleRefSegments, replaceExpandedRefBlocksWithLabels } from "./composer/quoteChip";
import { ImageActionButtons } from "./imageActions";

import { MultiSelectModal } from "./MessageShareModal";
import { DiagnosticMessageCard, RespondingIndicator, ThinkingBlock } from "./TimelineEventCards";
import { formatDuration, formatPercent, formatTime, stripAnsi } from "./TimelineFormat";
import { ToolCard, ToolGroupCard } from "./ToolCallComponents";

// ============================================================
// Surface & Workspace domain components
// 从 AppParts.tsx 提取，包含所有会话渲染组件
//
// Button 收口状态（P0 UI 统一）：
// - 已换装 shadcn Button：turn-row-action-btn / user-turn-action-btn / copy-menu-trigger
//   （ghost + size-7 + hover:bg-muted，对齐旧透明小钮；避免 hover:bg-accent 绿底）。
// - 保留原生 button（样式完全由自定义 CSS 驱动，直接换装会被 Tailwind utilities 覆盖默认尺寸
//   导致回归，需先做 CSS→utility 迁移）：code-copy、execution-summary-toggle/collapse、
//   image-preview-close、outline-* 系列、scratch/terminal/files/git/editors/browser-entry、
//   空状态创建按钮。迁移路径见 P2 CSS 收口。
//   （copy-menu-popover 菜单项已于 2026-08 迁移到 shadcn DropdownMenu，保留锚点类仅用于
//   多选导出/截图复制的节点排除。）
// ============================================================

type SessionModifiedFile = {
	path: string;
	toolName: string;
	status: string;
	changedLines?: number;
	/** 工具执行前的文件原始内容，用于历史会话恢复时展示差异对比。 */
	originalContent?: string;
	/** 工具写入/编辑后的新文件内容，优先于从磁盘实时读取（历史会话恢复时磁盘可能已变化或文件已删除）。 */
	content?: string;
};

/**
 * 美元→人民币估算汇率：仅用于费用提示的便捷换算（约合金额），非实时牌价。
 * 如需跟随实时汇率或用户自定义，可升级为设置项（usdToCnyRate）。
 */
export const USD_TO_CNY_RATE = 7.2;

export type SessionDetailRow = { label: string; value: string; emphasis?: boolean /** 悬停说明：解释这行指标怎么算的（用户可自行核对口径） */; hint?: string };

export type SessionStatusDetail = {
	detailRows: SessionDetailRow[];
	/** 最近一条回复的性能指标（TTFT/总耗时/tps）：与上下文累计量分开展示，避免误读为整段会话均值 */
	replyPerfRows: SessionDetailRow[];
	hasDetail: boolean;
};

/**
 * 由 runtime 状态构建会话状态详情行（SessionStatus tooltip 与圆环面板共用）。
 * 纯函数：label/value 已本地化，调用方只负责布局。
 */
export function buildSessionStatusDetail(
	state: Pick<AgentRuntimeState, "contextPercent" | "contextTokens" | "contextWindow" | "inputTokens" | "outputTokens" | "cacheRead" | "cacheWrite" | "cacheTotal" | "cacheHitPercent" | "ttftMs" | "totalMs" | "tps" | "cost"> | undefined,
	averageCacheHit: number | undefined,
	averageCacheHitSampleCount: number,
): SessionStatusDetail {
	const detailRows: SessionDetailRow[] = [];
	const replyPerfRows: SessionDetailRow[] = [];
	if (!state) return { detailRows, replyPerfRows, hasDetail: false };
	// 美元→人民币估算汇率（仅用于费用提示的便捷换算，非实时牌价；
	// 如后续需要跟随实时汇率，可升级为设置项 usdToCnyRate）
	const cnyAmount = state.cost != null ? `¥${(state.cost * USD_TO_CNY_RATE).toFixed(2)}` : undefined;

	if (state.contextPercent != null || state.contextTokens != null) {
		detailRows.push({
			label: t("ctx.detail.context"),
			value: `${state.contextPercent != null ? `${formatPercent(state.contextPercent)}%` : "-"} / ${formatCompact(state.contextTokens)} / ${formatCompact(state.contextWindow)}`,
			hint: t("ctx.detail.contextHint"),
		});
	}
	if (state.inputTokens != null || state.outputTokens != null) {
		// 标签已是「输入/输出」，不再套 ↑/↓：箭头加长字符串，且 `/ ↓` 会在窄面板里被折成两行。
		detailRows.push({
			label: t("ctx.detail.tokens"),
			value: `${formatCompact(state.inputTokens)} / ${formatCompact(state.outputTokens)}`,
			hint: t("ctx.detail.tokensHint"),
		});
	}
	if (state.cacheRead != null || state.cacheWrite != null) {
		detailRows.push({
			label: t("ctx.detail.cacheIO"),
			value: `${t("ctx.detail.cacheRead")} ${formatCompact(state.cacheRead)} / ${t("ctx.detail.cacheWrite")} ${formatCompact(state.cacheWrite)}`,
			hint: t("ctx.detail.cacheIOHint"),
		});
	}
	if (state.cacheTotal != null) {
		detailRows.push({
			label: t("ctx.detail.cacheTotal"),
			value: formatCompact(state.cacheTotal),
			hint: t("ctx.detail.cacheTotalHint"),
		});
	}
	if (state.cacheHitPercent != null) {
		detailRows.push({
			label: t("ctx.detail.hitLatest"),
			value: `${state.cacheHitPercent.toFixed(1)}%`,
			hint: t("ctx.detail.hitLatestHint"),
		});
	}
	if (averageCacheHit != null) {
		detailRows.push({
			label: t("ctx.detail.hitAverage"),
			value: `${averageCacheHit.toFixed(1)}% (${averageCacheHitSampleCount} ${t("ctx.detail.snapshots")})`,
			hint: t("ctx.detail.hitAverageHint"),
		});
	}
	// 这些值来自 AgentManager 的 lastPerfByAgent，只代表最近一条 assistant 回复，
	// 不能和上下文累计量混在同一组，否则用户会误以为是整段会话的平均性能。
	if (state.ttftMs != null) {
		replyPerfRows.push({ label: t("ctx.detail.ttft"), value: formatDuration(state.ttftMs), hint: t("ctx.detail.ttftHint") });
	}
	if (state.totalMs != null) {
		replyPerfRows.push({ label: t("ctx.detail.total"), value: formatDuration(state.totalMs), hint: t("ctx.detail.totalHint") });
	}
	if (state.tps != null) {
		replyPerfRows.push({ label: t("ctx.detail.tps"), value: `${state.tps.toFixed(0)} tok/s`, hint: t("ctx.detail.tpsHint") });
	}
	if (state.cost != null) {
		detailRows.push({ label: t("ctx.detail.cost"), value: `$${state.cost.toFixed(3)}`, emphasis: true, hint: t("ctx.detail.costHint") });
		detailRows.push({ label: t("ctx.detail.costCny"), value: cnyAmount ?? "-", emphasis: true, hint: t("ctx.detail.costCnyHint") });
	}
	return {
		detailRows,
		replyPerfRows,
		hasDetail: detailRows.length > 0 || replyPerfRows.length > 0,
	};
}

export function SessionStatus(props: {
	state?: AgentRuntimeState;
	duration?: number;
	/** 本会话历史缓存命中率快照，用于展示会话平均命中率 */
	cacheHitHistory?: number[];
}) {
	const state = props.state;
	if (!state) return null;
	// 会话平均缓存命中率：主进程基于会话文件全部 assistant 消息 usage 算出的
	// 真实平均优先；渲染层快照历史均值仅作为无文件样本时的降级回退。
	const history = props.cacheHitHistory ?? [];
	const averageCacheHit = state.cacheHitAveragePercent ?? (history.length > 0 ? history.reduce((sum, value) => sum + value, 0) / history.length : undefined);
	const averageCacheHitSampleCount = state.cacheHitSampleCount ?? history.length;
	const { detailRows, replyPerfRows, hasDetail } = buildSessionStatusDetail(state, averageCacheHit, averageCacheHitSampleCount);
	// cost-chip 悬浮提示里的人民币估算（与明细行共用同一汇率常量）
	const cnyAmount = state.cost != null ? `¥${(state.cost * USD_TO_CNY_RATE).toFixed(2)}` : undefined;

	const statusInner = (
		<div className="session-status">
			{state.contextPercent != null && (
				<span className="ctx-chip">
					{t("app.ctx")}: {formatPercent(state.contextPercent)}% / {formatCompact(state.contextWindow)}
				</span>
			)}
			{state.cacheHitPercent != null && (
				<span className="cache-chip">
					{t("app.cacheHit")}: {state.cacheHitPercent?.toFixed?.(0) ?? state.cacheHitPercent}%
				</span>
			)}
			{/* 平均命中率只在悬停明细中展示（ctx.detail.hitAverage），头部不再显示单独 chip */}
			{state.cost != null && (
				<span
					className="cost-chip"
					title={t("app.totalCostCny", {
						usd: `$${state.cost.toFixed(3)}`,
						cny: cnyAmount ?? "-",
					})}
				>
					${state.cost.toFixed(3)}
				</span>
			)}
		</div>
	);

	if (!hasDetail) return statusInner;
	// 用有标题的 popover 承载明细：标题解释这组数字，行内用标签/数值对比降低阅读成本。
	return (
		<Tooltip>
			<TooltipTrigger asChild>{statusInner}</TooltipTrigger>
			<TooltipContent side="bottom" align="end" sideOffset={8} arrowClassName="!bg-popover !fill-popover" className="ctx-detail-tooltip !w-auto min-w-64 max-w-[min(320px,calc(100vw-24px))] !rounded-md !border !border-border !bg-popover !px-3 !py-2.5 !text-popover-foreground !shadow-lg">
				<div className="grid gap-2.5">
					<div className="flex items-center justify-between gap-4 border-b border-border/70 pb-2">
						<span className="text-caption font-semibold text-popover-foreground">{t("ctx.detail.title")}</span>
						<span className="text-micro text-muted-foreground">{t("app.ctx")}</span>
					</div>
					<div className="grid gap-1">
						{detailRows.map((row) => (
							<div key={row.label} title={row.hint} className={`flex items-baseline justify-between gap-4 px-1 py-0.5 text-caption leading-5${row.emphasis ? " mt-1 border-t border-border/70 pt-1.5" : ""}`}>
								<span className="shrink-0 text-muted-foreground">{row.label}</span>
								<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-popover-foreground">{row.value}</span>
							</div>
						))}
					</div>
					{replyPerfRows.length > 0 && (
						<div className="mt-2.5 grid gap-1 border-t border-border/70 pt-2">
							<div className="px-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t("ctx.detail.lastReply")}</div>
							{replyPerfRows.map((row) => (
								<div key={row.label} title={row.hint} className="flex items-baseline justify-between gap-4 px-1 py-0.5 text-caption leading-5">
									<span className="shrink-0 text-muted-foreground">{row.label}</span>
									<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-popover-foreground">{row.value}</span>
								</div>
							))}
						</div>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}

function formatCompact(value?: number | null) {
	if (value == null) return "-";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

export { LogoMark } from "../app/LogoMark";

export function AgentAvatar(props: { status: string }) {
	const normalizedStatus = props.status === "running" || props.status === "starting" || props.status === "error" ? props.status : "idle";
	return (
		<div className={`conversation-avatar agent-avatar avatar-status-${normalizedStatus}`} data-avatar-status={normalizedStatus}>
			<span className="agent-avatar-mark" aria-hidden="true">
				<svg viewBox="140 140 520 520" width="28" height="28" aria-hidden="true">
					<path fill="#fff" fillRule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z" />
					<path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
				</svg>
			</span>
			<span className="avatar-status-indicator" aria-label={normalizedStatus}>
				{normalizedStatus === "error" ? <CircleAlert size={8} strokeWidth={2.5} /> : normalizedStatus === "starting" ? <CircleDot size={8} strokeWidth={2.5} /> : normalizedStatus === "running" ? <LoaderCircle size={8} strokeWidth={2.5} className="animate-pideck-spin" /> : <Check size={8} strokeWidth={2.5} />}
			</span>
		</div>
	);
}

export function EmptyState(props: {
	hasProject: boolean;
	onCreate: () => void;
	/** 可选：自定义操作区（如项目空态的主从按钮），默认提供“启动 Agent”/无项目提示 */
	actions?: ReactNode;
	/** 可选：底部 meta 区（如模型/思考级别/路径），渲染在发丝线分隔的 dl 容器内 */
	footer?: ReactNode;
	/** 可选：章节页眉发丝线右侧的上下文（如当前项目名），帮助用户确认所在工作区 */
	eyebrow?: ReactNode;
}) {
	const description = props.hasProject ? t("app.emptyHasProject") : t("app.emptyNoProject");

	return (
		// Editorial 空态：左对齐章节式排版而非居中对话框，品牌感由衬线斜体的重音词承担。
		// 重音词固定用拉丁词（zh「Session」/ en「session」）：内置艺术字 Plantin 仅有拉丁字形，
		// 居中策略：几何居中（justify-center）后用户反馈标题区仍略偏上——
		// 补 pt-[10vh] 让内容块整体下移，标题重心落到窗口光学中心。
		<div className="empty-state relative h-full min-h-0 overflow-hidden bg-transparent px-6 text-left" data-empty-state={props.hasProject ? "project" : "no-project"}>
			<div className="mx-auto flex h-full w-full max-w-2xl animate-in flex-col justify-center pt-[10vh] duration-500 fade-in">
				{/* 章节页眉：发丝线 + 项目上下文，建立编辑排版的节奏起点 */}
				<div className="flex items-center gap-4 text-control text-text-secondary">
					<span className="h-px flex-1 bg-border-subtle" aria-hidden="true"></span>
					{props.eyebrow}
				</div>
				<h2 className="mt-10 animate-in text-[clamp(2.5rem,5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] delay-100 duration-500 fade-in fill-mode-backwards slide-in-from-bottom-2 text-foreground">
					{props.hasProject ? (
						<>
							{t("app.emptyProjectTitleLead")}
							<br />
							<span className="font-brand font-medium italic">{t("app.emptyProjectTitleAccent")}</span>
							{/* 句号用前景色（黑/白实心）而非灰：作为标题的落点强调，视觉上更扎实 */}
							<span className="text-foreground">{t("app.emptyProjectTitlePunct")}</span>
						</>
					) : (
						t("app.emptyNoProjectTitle")
					)}
				</h2>
				<p className="mt-6 max-w-md animate-in text-title leading-7 delay-100 duration-500 fade-in fill-mode-backwards text-text-secondary">{description}</p>
				{/* actions 是左对齐的主从按钮区，跟随阅读动线而不是居中悬浮 */}
				<div className="mt-10 animate-in delay-200 duration-500 fade-in fill-mode-backwards slide-in-from-bottom-2">
					{props.actions ??
						(props.hasProject ? (
							<Button size="lg" className="h-12 rounded-xl bg-foreground px-7 text-background shadow-sm hover:bg-foreground/85" onClick={props.onCreate}>
								{t("app.createAgent")}
							</Button>
						) : (
							<p className="text-sm text-muted-foreground">{t("app.emptyNoProject")}</p>
						))}
				</div>
				{props.footer && <div className="mt-14 animate-in border-t border-border-subtle pt-5 delay-300 duration-500 fade-in fill-mode-backwards">{props.footer}</div>}
			</div>
		</div>
	);
}

async function copyElementAsPng(element: HTMLElement) {
	// 截图后走 writeClipboardImage（Electron nativeImage），不依赖 ClipboardItem。
	// 使用 toBlob 而非 toPng+fetch 避免 CSP 拒绝连接 data: URL。
	// 克隆节点 + 内边距 + 临时注入 body 的方式与分享为图片（handleMultiSelectCopy）保持一致，
	// 避免直接截图导致图片紧贴内容边缘、缺少留白。
	const clone = element.cloneNode(true) as HTMLElement;
	clone.style.padding = "24px";
	clone.style.background = getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel") || "#fff";
	// 将 clone 插入到原元素旁边，确保 CSS 样式正确继承（父层选择器、CSS 变量、rem 等）
	if (element.parentElement) {
		// 克隆节点不能参与原布局，否则插入时会短暂撑开时间线导致闪动。
		// 复用多选分享的隐藏方式（.multi-select-image-export：absolute + left/top 归零 + z-index:-1）：
		// absolute 脱离文档流、不撑开布局；不能用 left:-100000px 把节点推出视口——
		// html-to-image 会把 clone 的 computed style 复制进 SVG foreignObject，负偏移会让
		// 内容整体渲染到 viewBox 之外，导致截图空白（「复制为图片空白」的根因）。
		clone.classList.add("multi-select-image-export");
		clone.style.width = `${element.getBoundingClientRect().width}px`;
		element.parentElement.insertBefore(clone, element.nextSibling);
	}
	let blob: Blob | null = null;
	try {
		blob = await toBlob(clone, {
			cacheBust: true,
			pixelRatio: Math.min(2, window.devicePixelRatio || 1),
			backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel") || undefined,
			filter: (node) => !(node instanceof HTMLElement) || (!node.classList.contains("turn-row-actions") && !node.classList.contains("user-turn-actions") && !node.classList.contains("copy-menu-popover")),
		});
	} finally {
		clone.remove();
	}
	// html-to-image 在 oklch / canvas / 失焦时可能返回 null 且不抛错；
	// 这里必须失败给调用方，否则 CopyMenu 会 toast「已复制」但剪贴板是空的。
	if (!blob) throw new Error("Unable to capture message as PNG");
	const written = await writeClipboardImage(blob);
	if (!written) throw new Error("Unable to write PNG to clipboard");
}

export function CopyMenu(props: { text: string; markdown: string; targetRef: React.RefObject<HTMLElement | null>; className?: string }) {
	const [copied, setCopied] = useState<string | null>(null);
	const copy = async (kind: "text" | "markdown" | "image") => {
		try {
			if (kind === "text") await navigator.clipboard.writeText(props.text);
			if (kind === "markdown") await navigator.clipboard.writeText(props.markdown);
			if (kind === "image") {
				if (!props.targetRef.current) throw new Error("Copy target is missing");
				await copyElementAsPng(props.targetRef.current);
			}
			setCopied(kind);
			showNotice(kind === "image" ? t("copy.asImageCopied") : t("copy.success"), 1200);
			window.setTimeout(() => setCopied(null), 1800);
		} catch (error) {
			setCopied(null);
			showNotice(t("copy.failed"), 2000, "error");
			// 下拉菜单失焦后 ClipboardItem 失败原先无 log；图片路径现在统一记 renderer 日志便于排查。
			if (kind === "image") {
				void window.piDesktop?.app.rendererLog("warn", "clipboard", "copy as image failed", error).catch(() => undefined);
			}
		}
	};
	return (
		<div className={`copy-menu ${props.className ?? ""}`}>
			{/* 拆分按钮：主按钮点击直接复制纯文本（默认动作，不再弹菜单）；
			   右侧小箭头展开完整菜单（复制为 Markdown / 图片）。弹层走 shadcn
			   DropdownMenu：Radix 定位 + animate-in/out + dropdown-stagger 错峰动画。 */}
			<div className="flex items-center overflow-hidden rounded-sm border border-transparent hover:border-border">
				<Button variant="ghost" size="icon-sm" className="copy-menu-trigger size-7 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground" type="button" onClick={() => void copy("text")} title={t("common.copy")}>
					{copied ? <Check size={14} /> : <Copy size={14} />}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						{/* 展开菜单的半边与主按钮同规格（size-7 / 图标 14）：原来的 24px 窄按钮 + 12px 图标
						    比同排其它操作图标小一号，是「图标大小不一」的来源；竖线分隔保留（两块仍是一个控件）。 */}
						<Button variant="ghost" size="icon-sm" className="size-7 rounded-none border-l border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground" type="button" aria-label={t("copy.moreOptions")} title={t("copy.moreOptions")}>
							<ChevronDown size={14} />
						</Button>
					</DropdownMenuTrigger>
					{/* 保留 copy-menu-popover 锚点类：多选导出/截图复制仍靠它排除菜单节点 */}
					<DropdownMenuContent align="end" className="copy-menu-popover min-w-[132px]">
						<DropdownMenuItem onSelect={() => void copy("text")}>{t("copy.asText")}</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void copy("markdown")}>{t("copy.asMarkdown")}</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void copy("image")}>{t("copy.asImage")}</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

// ============================================================
// 会话时间线渲染组件（借鉴 opencode 扁平 timeline 风格重写）
// 设计要点：
// - 助手内容去掉气泡，改为左对齐扁平排版，用左侧竖线聚合一轮对话
// - 工具调用做成独立可折叠卡片，trigger 行 + 展开内容，内联在 timeline 里
// - 用户消息保留右对齐气泡，但收窄并去掉头像，操作栏 hover 显隐
// - 思考过程做成轻量折叠卡片，不再占用大块气泡空间
// ============================================================

/** 助手正文：扁平 markdown 渲染，无气泡包裹，全宽排版，支持内嵌图片。
 *  路径链接化用 remark 插件在 mdast 层处理（见底部 remarkLinkifyPaths），不再前置改写原始字符串。 */
export const AssistantText = memo(
	function AssistantText(props: {
		text: string;
		images?: ImageContent[];
		onPreviewImage: (image: ImageContent) => void;
		onOpenExternal: (url: string) => void;
		onOpenFile?: (path: string, line?: number) => void;
		/** 当前消息是否正在流式追加。为 true 时走轻量渲染路径，跳过 KaTeX 数学解析与
		 *  mermaid 图渲染，避免每个 token 都对不断增长的全量正文调用重型插件导致主线程卡死。 */
		isStreaming?: boolean;
		/** live→settled 交接时播放一次淡入 */
		settle?: boolean;
	}) {
		// 清理 ANSI 转义码与 <thinking> 标签，thinking 由调用方通过 ThinkingBlock 渲染
		const cleanText = stripThinkingTags(stripAnsi(props.text));
		// 统一 Streamdown 引擎（迁移后唯一 markdown 管线）：流式由引擎按 block memo、
		// 半截 markdown 由 remend 容错补全，不再需要旧管线的流式/静态双路径切换。
		return (
			<div className="assistant-text markdown-body" data-settle={props.settle ? "1" : undefined}>
				{props.images && props.images.length > 0 && (
					<div className="message-images">
						{props.images.map((img, index) => {
							const src = imageContentSrc(img);
							if (!src) return null;
							return <MessageImage key={index} src={src} alt={t("app.imageAlt", { index: index + 1 })} className="message-image" placeholderClass="min-h-24" onClick={() => props.onPreviewImage(img)} />;
						})}
					</div>
				)}
				<MarkdownStream text={cleanText} isStreaming={Boolean(props.isStreaming)} onOpenExternal={props.onOpenExternal} onOpenFile={props.onOpenFile} />
			</div>
		);
	},
	// 自定义比较：正文文件回调绑定栏级 cwd/project，作用域变化时必须刷新；其余稳定回调仍忽略，
	// 避免 App 常规渲染让历史消息反复解析 Markdown。
	(prev, next) => prev.text === next.text && prev.isStreaming === next.isStreaming && prev.settle === next.settle && prev.images === next.images && prev.onOpenFile === next.onOpenFile,
);

/** 用户消息：右对齐气泡 + 附件 + hover 显隐操作栏（复制/编辑/删除/重发/修改输入框）。
 * 编辑分两种：原地编辑（修改 JSONL + 重载会话）和修改输入框（放回 composer 不自动发送）。 */
export const UserBubble = memo(function UserBubble(props: {
	message: ChatMessage;
	/** 新消息入场动画：发送后乐观上屏的用户消息播放一次 */
	fresh?: boolean;
	/** 上滚窗口扩展时顶部新增的用户消息：播放「从顶部淡入」过渡 */
	topFresh?: boolean;
	onPreviewImage: (image: ImageContent) => void;
	onOpenFile?: (path: string) => void;
	onResendUserMessage?: (message: ChatMessage) => void;
	onEditMessage?: (message: ChatMessage, newText: string) => void;
	onDeleteMessage?: (messageId: string, entryId?: string) => void;
	onRemoveMessageImage?: (message: ChatMessage, index: number) => void;
	/** 从该用户消息 fork 新会话；忙碌时不展示入口 */
	onForkMessage?: (message: ChatMessage) => void;
	/** 回退工作区文件到该消息时刻前最近的检查点；仅 pi 后端注入（rewind 能力） */
	onRewindToMessage?: (message: ChatMessage) => void;
	/** 是否为最后一条用户消息，用于控制重发按钮的显隐 */
	isLastUserMessage?: boolean;
	/** 仅当该消息后出现 error/abort 时显示重发（取代无条件 isLastUserMessage） */
	showResendButton?: boolean;
	validCommandNames?: Set<string>;
	validFilePaths?: Set<string>;
	/** Agent 正在处理请求或流式输出中时禁用编辑/删除等操作按钮 */
	agentRunning?: boolean;
	/** fork 进行中：仅当前消息禁用按钮，避免连点重复 fork */
	forking?: boolean;
	/** 打开多选分享弹框 */
	onEnterMultiSelect?: () => void;
}) {
	const { message } = props;
	// fork 入口始终展示（hover 可见）；忙碌/进行中仅禁用而非隐藏，避免用户误以为入口「时有时无」。
	// entryId 解析放到点击时做（meta 缺失时走 getForkMessages 回退）。
	const canFork = Boolean(props.onForkMessage);
	const rowRef = useRef<HTMLElement | null>(null);
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const editAreaRef = useRef<HTMLDivElement | null>(null);
	// 长消息折叠（2026-08）：超过 8 行（line-clamp-8）折叠为预览，避免超长发送全量铺开；
	// 溢出检测用 ResizeObserver 对比 scrollHeight/clientHeight，折叠态下才测量（展开态保持按钮可见）。
	const [messageExpanded, setMessageExpanded] = useState(false);
	const [messageOverflowing, setMessageOverflowing] = useState(false);
	// 文件 chip 右键菜单：记录光标坐标（Radix 受控 dropdown 按不可见 Trigger 矩形定位）
	const [fileChipMenu, setFileChipMenu] = useState<{ path: string; x: number; y: number } | null>(null);
	const openFileChipMenu = useCallback((path: string, x: number, y: number) => {
		setFileChipMenu({ path, x, y });
	}, []);
	const userTextRef = useRef<HTMLDivElement | null>(null);
	// 激活编辑时自动滚动到编辑区
	useEffect(() => {
		if (editing && editAreaRef.current) {
			editAreaRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}, [editing]);
	// 长消息折叠溢出检测：折叠态 clamp 生效后 scrollHeight > clientHeight 即溢出；
	// 窗口缩放/内容变化（chips 换行）都会经 ResizeObserver 重新测量。
	useLayoutEffect(() => {
		const el = userTextRef.current;
		if (!el) return;
		const check = () => {
			if (messageExpanded) return; // 展开态无需测量，保持按钮可见
			setMessageOverflowing(el.scrollHeight > el.clientHeight + 1);
		};
		// ResizeObserver 挂载后会先回调一次；直接check会在逐条挂载历史消息时
		// 强制同步布局，重复测量整条时间线。统一在浏览器布局完成后读取。
		const observer = new ResizeObserver(check);
		observer.observe(el);
		return () => observer.disconnect();
	}, [messageExpanded, editing, message.text]);
	const cleanText = stripAnsi(message.text);
	// 气泡片段（正文 + 引用/会话/skill chip）严格按原文顺序渲染：
	// 多个引用各有自己的描述时，顺序就是「引用1 描述1 引用2 描述2」，不能全部提到顶部。
	const bubbleSegments = buildBubbleRefSegments(cleanText);
	/** 原地编辑不影响输入框；先提交给确认弹窗。 */
	const handleSaveEdit = () => {
		if (!props.onEditMessage) return;
		// 空文本 = 放弃编辑（退出编辑态、保留原文），不让按钮无响应。
		if (!editText.trim()) {
			setEditing(false);
			return;
		}
		props.onEditMessage(message, editText);
		setEditing(false);
	};
	/** 编辑后重发：放回 composer 输入框，由用户自行修改后发送。 */
	const handleEditAndResend = () => {
		document.querySelector<HTMLElement>(".composer-box .rich-input, .composer-box textarea")?.focus();
		window.dispatchEvent(new CustomEvent("user-message-edit", { detail: { text: message.text, images: message.images } }));
	};
	return (
		<article /* user-turn 为 e2e 选择器锚点 */
			ref={rowRef}
			className={`user-turn group/user mb-4 flex w-full min-w-0 max-w-full flex-col items-end ${props.fresh ? "user-turn--fresh animate-[message-enter_260ms_cubic-bezier(0.22,1,0.36,1)_both]" : ""}${props.topFresh ? " user-turn--top-fresh animate-[top-enter_280ms_cubic-bezier(0.22,1,0.36,1)_both]" : ""}`}
			data-message-id={message.id}
		>
			{message.images && message.images.length > 0 && (
				<div className="mb-2 flex max-w-[min(82%,64ch)] flex-wrap justify-end gap-2">
					{message.images.map((img, index) => {
						// 参考图在历史里同样是 ref 引用（新图是内联 base64），统一走解析器
						const src = imageContentSrc(img);
						if (!src) return null;
						return (
							<div key={index} className="group/img relative">
								<MessageImage src={src} alt={t("app.imageAlt", { index: index + 1 })} className="size-16 max-h-40 cursor-pointer rounded-md border border-border object-cover transition-colors duration-fast hover:border-border-strong" onClick={() => props.onPreviewImage(img)} />
								{/* 上传图片此前只有点击预览、无复制/保存入口（2026-10 用户反馈）；hover 动作条与生图卡片同规格 */}
								<div className="absolute -top-2.5 right-0 z-10 opacity-0 transition-opacity duration-fast group-hover/img:opacity-100 focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
									<ImageActionButtons image={img} onRemove={props.onRemoveMessageImage && img.data ? () => props.onRemoveMessageImage?.(message, index) : undefined} />
								</div>
							</div>
						);
					})}
				</div>
			)}
			{cleanText && !editing && (
				<div className="user-turn-bubble w-fit min-w-0 max-w-[min(82%,64ch)] rounded-[14px] border px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere] break-words">
					<div
						ref={userTextRef}
						// user-turn-text 是气泡 chip 样式的唯一作用域锚点：timeline.css 的
						// `.user-turn-text .input-chip*` 全靠它生效（漏写时 chip 会退化成裸文本，
						// 且 lucide 图标会被 preflight 的 svg{display:block} 撑成单独一行）。
						className={`user-turn-text text-chat text-text-primary whitespace-pre-wrap break-words ${messageExpanded ? "" : "line-clamp-8"}`}
					>
						{renderBubbleSegments(bubbleSegments, { ...props, onFileContextMenu: openFileChipMenu })}
					</div>
					{messageOverflowing && (
						<div className="relative mt-1 flex justify-end">
							{/* 折叠态底部渐变提示还有内容；展开态不需要 */}
							{!messageExpanded && <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-muted/70 to-transparent" aria-hidden="true" />}
							<button
								type="button"
								className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-micro text-text-tertiary transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
								onClick={() => setMessageExpanded((v) => !v)}
								aria-expanded={messageExpanded}
							>
								{messageExpanded ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
								{messageExpanded ? t("app.messageCollapse") : t("app.messageExpand")}
							</button>
						</div>
					)}
				</div>
			)}
			{editing && (
				<div className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-border-subtle bg-[color:color-mix(in_srgb,var(--color-accent)_3%,var(--color-bg-panel))] pl-2" ref={editAreaRef}>
					<div className="flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] before:content-['✎'] before:text-sm">{t("common.edit")}</div>
					<Textarea
						className="min-h-[100px] max-h-[400px] w-full resize-y rounded-sm border border-[var(--color-accent)] bg-bg-panel p-2 font-mono text-sm leading-relaxed text-text-primary outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--focus-ring)]"
						value={editText}
						onChange={(e) => setEditText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								handleSaveEdit();
							}
							if (e.key === "Escape") setEditing(false);
						}}
						autoFocus
					/>
					<div className="flex justify-end gap-2">
						<Button variant="outline" size="sm" className="h-auto border-[var(--color-accent)] px-3 py-1 text-xs text-[var(--color-accent)] shadow-none hover:text-[var(--color-accent)]" onClick={handleSaveEdit}>
							{t("common.save")}
						</Button>
						<Button variant="outline" size="sm" className="h-auto px-3 py-1 text-xs shadow-none" onClick={() => setEditing(false)}>
							{t("common.cancel")}
						</Button>
					</div>
				</div>
			)}
			<div className="mt-1 inline-flex items-center gap-2 text-micro tabular-nums text-text-tertiary">
				<time>{formatTime(message.timestamp)}</time>
			</div>
			<div className="user-turn-actions flex min-h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
				<CopyMenu text={stripMarkdown(replaceExpandedRefBlocksWithLabels(cleanText))} markdown={replaceExpandedRefBlocksWithLabels(message.text)} targetRef={rowRef} />
				<Button type="button" variant="ghost" size="icon-sm" className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={props.onEnterMultiSelect} title={t("app.multiSelectEnter")}>
					<Share size={14} />
				</Button>
				{/* fork 忙碌时也不隐藏、仅禁用：入口稳定可见，避免用户误以为「时有时无」 */}
				{!editing && canFork && (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
						disabled={props.agentRunning || props.forking}
						onClick={() => props.onForkMessage?.(message)}
						title={props.agentRunning ? t("app.forkBusyTitle") : t("app.forkFromMessageTitle")}
						aria-label={t("app.forkFromMessage")}
					>
						<GitFork size={14} strokeWidth={1.8} aria-hidden="true" />
					</Button>
				)}
				{/* 回退到此消息：把工作区文件恢复到该消息时刻前最近的检查点（见 injector 的最近点解析） */}
				{!editing && props.onRewindToMessage && (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
						disabled={props.agentRunning}
						onClick={() => props.onRewindToMessage?.(message)}
						title={props.agentRunning ? t("app.forkBusyTitle") : t("rewind.restoreTitle")}
						aria-label={t("rewind.restore")}
					>
						<Undo2 size={14} strokeWidth={1.8} aria-hidden="true" />
					</Button>
				)}
				{!editing && !props.agentRunning && (
					<>
						{props.onEditMessage && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={() => {
									setEditText(cleanText);
									setEditing(true);
								}}
								title={t("common.edit")}
							>
								<SquarePen size={14} />
							</Button>
						)}
						<Button type="button" variant="ghost" size="icon-sm" className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={handleEditAndResend} title={t("app.editAndResendTitle")}>
							<UserPen size={14} />
						</Button>
						{props.onDeleteMessage && (
							<Button type="button" variant="ghost" size="icon-sm" className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => props.onDeleteMessage?.(message.id, messageEntryId(message))} title={t("common.delete")}>
								<Trash size={14} />
							</Button>
						)}
						{(props.isLastUserMessage || props.showResendButton) && props.onResendUserMessage && (
							<Button type="button" variant="ghost" size="icon-sm" className="user-turn-action-btn size-7 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => props.onResendUserMessage?.(message)} title={t("app.resendTitle")}>
								<Send size={14} />
							</Button>
						)}
					</>
				)}
			</div>
			{/* 文件 chip 右键菜单：默认方式打开 / 在文件夹中显示 / 复制路径。粘贴转文件落
			    在 userData、项目外路径无 scope，主进程不设边界直接交给系统；菜单形态与
			    文件抽屉右键菜单（ComposerOverlayContextMenu）保持一致。 */}
			{fileChipMenu && (
				<DropdownMenu
					open
					onOpenChange={(open) => {
						if (!open) setFileChipMenu(null);
					}}
				>
					{/* 不可见 Trigger 钉在右键坐标上：Radix 受控 open 仍按 Trigger 矩形定位（见 ComposerOverlayContextMenu） */}
					<DropdownMenuTrigger aria-hidden tabIndex={-1} style={{ position: "fixed", left: fileChipMenu.x, top: fileChipMenu.y, width: 0, height: 0, padding: 0, border: 0, background: "transparent", pointerEvents: "none" }} />
					<DropdownMenuContent align="start" side="bottom" className="min-w-40">
						<DropdownMenuItem
							onSelect={() => {
								void desktopApi.files.open(fileChipMenu.path).catch((error) => showNotice(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) })));
							}}
						>
							{t("menu.defaultOpen")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => {
								void desktopApi.files.showInFolder(fileChipMenu.path).catch((error) => showNotice(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) })));
							}}
						>
							{t("menu.revealFile")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => {
								void writeClipboard(fileChipMenu.path).then((ok) => {
									if (ok) showNotice(t("copy.success"), 1200);
								});
							}}
						>
							{t("menu.copyPath")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</article>
	);
});

export function ImagePreviewModal(props: { image: ImageContent; onClose: () => void }) {
	const src = imageContentSrc(props.image);
	if (!src) return null;
	return (
		<div className="image-preview-modal" onClick={props.onClose}>
			<button className="image-preview-close" onClick={props.onClose} aria-label={t("app.imagePreviewClose")}>
				<X size={20} strokeWidth={2.4} />
			</button>
			<img src={src} alt={t("app.imagePreviewAlt")} onClick={(event) => event.stopPropagation()} />
			{/* 预览态动作条：全尺寸查看时直接复制/保存（缩略图 hover 之外的第二个入口，两条路共用同一组件） */}
			<div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2" onClick={(event) => event.stopPropagation()}>
				<ImageActionButtons image={props.image} />
			</div>
		</div>
	);
}

// ANSI 转义码正则:匹配 \x1b[...m 等终端颜色/样式序列
function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

/** 将 Markdown 语法转换为纯文本，保留可读的文字内容 */
export function stripMarkdown(text: string): string {
	return removeMarkdown(text, {
		// 保留列表项文本，移除列表标记符号
		stripListLeaders: true,
		// 使用 Unicode 字符替换列表标记
		listUnicodeChar: "",
		// 启用 GFM 表格/任务列表等处理
		gfm: true,
		// 图片保留 alt 文本
		useImgAltText: true,
	});
}

/** 引用 chip 图标：与输入框（mentionChip 内联 SVG）同 path 同 stroke 参数，视觉逐像素一致。
 * lucide 组件渲染结果 = 同 viewBox + stroke currentColor + width/height 1em 的 svg。 */
const CHIP_ICONS: Record<string, typeof FileText> = {
	file: FileText,
	skill: Sparkles,
	session: MessageSquare,
	quote: Quote,
};

/** 气泡正文片段：正文 + 引用/会话/skill chip，严格按原文顺序行内渲染。
 *
 * quoted_context / referenced_session / pi 的 skill / PiDeck 的 prompt_template 都自带展示名和
 * 完整模型上下文；因此切会话、重启、模板改名或删除后仍可恢复，不依赖运行时 atom。其余
 * 原始 `@path`、`/command` 正文继续走 renderChipText 重新解析。
 * 顺序必须保持：用户可能「引用A + 描述A + 引用B + 描述B」，把引用全部提前会打乱配对
 * （发送给模型的文本本身顺序正确，问题只在展示层）。 */
function renderBubbleSegments(
	segments: BubbleRefSegment[],
	props: {
		onOpenFile?: (path: string) => void;
		validCommandNames?: Set<string>;
		validFilePaths?: Set<string>;
		/** 文件 chip 右键：弹坐标菜单（默认打开/在文件夹中显示/复制路径） */
		onFileContextMenu?: (path: string, x: number, y: number) => void;
	},
): ReactNode[] {
	const nodes: ReactNode[] = [];
	segments.forEach((segment, index) => {
		// 片段之间补一个空格：块自带的 \n\n 只服务模型阅读，气泡里必须保持行内紧凑，
		// 否则每个 chip 独占一行（用户实测截图：「不像行内 chip」）。
		if (index > 0) nodes.push(" ");
		if (segment.kind === "text") {
			nodes.push(...renderChipText(segment.value, props.onOpenFile, props.validCommandNames, props.validFilePaths, props.onFileContextMenu, `text-${index}-`));
			return;
		}
		const { block } = segment;
		const chipKind = block.kind;
		const label = block.kind === "session" ? block.name : block.label;
		// skill/template 正文可能是一整份 SKILL.md 或提示词；它属于模型上下文，不应在
		// 原生 title 中撑出巨大浮层。quote/session 仍保留全文悬浮预览。
		const title = block.kind === "skill" ? `/${label}` : block.text;
		const Icon = CHIP_ICONS[chipKind] ?? FileText;
		nodes.push(
			<span key={`${chipKind}-${block.start}`} className={`input-chip input-chip--${chipKind}`} data-type={chipKind} title={title}>
				{/* inline-block 是必须的：Tailwind preflight 把 svg 设为 display:block，
				    仅靠 legacy 作用域在气泡外的渲染点会再次被拆行 */}
				<Icon className="input-chip__icon inline-block shrink-0" width="12" height="12" aria-hidden="true" />
				<span className="input-chip__label">{formatChipDisplayLabel(chipKind, label)}</span>
			</span>,
		);
	});
	return nodes;
}

/** 将原始 @path / /command 渲染为行内 chip（聊天区展示用，与输入框视觉一致）。
 * 自包含 XML 块由 renderUserBubbleChipText 先折叠；file chip 保留点击打开能力。 */
function renderChipText(text: string, onOpenFile?: (path: string) => void, validCommandNames?: Set<string>, validFilePaths?: Set<string>, onFileContextMenu?: (path: string, x: number, y: number) => void, keyPrefix = ""): ReactNode[] {
	const chips = parseRichInputChips(text, validCommandNames, validFilePaths);
	if (chips.length === 0) return [text];
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const chip of chips) {
		if (chip.start > cursor) {
			nodes.push(text.slice(cursor, chip.start));
		}
		const clickable = onOpenFile && chip.kind === "file";
		// 目录引用换成文件夹图标（对齐 Proma 的目录 chip）；title 给完整路径便于悬浮确认。
		const isDirectory = chip.kind === "file" && isDirectoryFileChip(chip.raw);
		const Icon = isDirectory ? Folder : (CHIP_ICONS[chip.kind] ?? FileText);
		const title = chip.kind === "file" ? unwrapFileChipPath(chip.raw) : chip.raw;
		nodes.push(
			<span
				key={`${keyPrefix}chip-${chip.start}`}
				className={`input-chip input-chip--${chip.kind}${clickable ? " clickable" : ""}`}
				data-type={chip.kind}
				data-raw={chip.raw}
				title={title}
				onClick={clickable ? () => onOpenFile(unwrapFileChipPath(chip.raw)) : undefined}
				onContextMenu={
					chip.kind === "file"
						? (event) => {
								// 右键出坐标菜单：左键打开之外的入口（系统默认打开/在文件夹中显示/复制路径）
								event.preventDefault();
								onFileContextMenu?.(unwrapFileChipPath(chip.raw), event.clientX, event.clientY);
							}
						: undefined
				}
			>
				<Icon className="input-chip__icon inline-block shrink-0" width="12" height="12" aria-hidden="true" />
				{/* 展示文本与输入框一致（formatChipDisplayLabel），构成区分信号之一 */}
				<span className="input-chip__label">{formatChipDisplayLabel(chip.kind, chip.label)}</span>
			</span>,
		);
		cursor = chip.end;
	}
	if (cursor < text.length) {
		nodes.push(text.slice(cursor));
	}
	return nodes;
}

export { DiagnosticMessageCard, MultiSelectModal, RespondingIndicator, ThinkingBlock, ToolCard, ToolGroupCard };

/**
 * 会话定位轴（beUI PreviewRail）：右缘一列 1px 刻度对应全部已加载的用户消息
 * （不再封顶 15 条——长会话此前「最上面的刻度不是第一条消息、很多消息没有刻度」），
 * hover 出预览卡、点击跳转。工具开关已上收会话 Tab 栏（SessionToolAction），
 * 此处不再承载其他入口；容器沿用 .outline-hover 的贴右缘偏移规则（有测试守护）。
 *
 * 高度自适应：容器被 .outline-hover 的 top/bottom 双向夹持出可用高度，刻度间距
 * 按条数收缩；间距压到下限仍放不下时均匀抽稀，但首尾刻度强制保留（planRailTicks）。
 */
type ConversationOutlineProps = {
	className?: string;
	timelineRef?: RefObject<HTMLElement | null>;
	onTimelineWheel?: (deltaY: number) => void;
	items: Array<{ id: string; role: string; title: string; time: string }>;
	onJump: (id: string) => void;
};

function areConversationOutlinePropsEqual(previous: ConversationOutlineProps, next: ConversationOutlineProps): boolean {
	return previous.className === next.className && previous.timelineRef === next.timelineRef && previous.onTimelineWheel === next.onTimelineWheel && previous.onJump === next.onJump && areOutlineRailItemsEqual(previous.items, next.items);
}

function ConversationOutlineView(props: ConversationOutlineProps) {
	// The visible timeline checkpoint owns rail feedback; clicking a tick updates it immediately.
	const [railActiveId, setRailActiveId] = useTimelineOutlineActiveId(props.timelineRef, props.items);
	const containerRef = useRef<HTMLDivElement>(null);
	const [availableHeight, setAvailableHeight] = useState(0);
	// 容器高度由 top/bottom 夹持（不随内容变化），ResizeObserver 重测不会形成反馈环；
	// 窗口缩放、--outline-top 变化都会反映为容器尺寸变化，统一在这里重算刻度规划。
	useLayoutEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const update = () => setAvailableHeight(element.clientHeight);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const plan = useMemo(() => planRailTicks(props.items, availableHeight), [props.items, availableHeight]);
	const railItems = useMemo<PreviewRailItem[]>(
		() =>
			plan.items.map((item) => ({
				id: item.id,
				label: item.title,
				ariaLabel: item.title,
				description: item.time,
			})),
		[plan.items],
	);
	const outlineItemIndex = useMemo(() => createOutlineItemIndex(props.items), [props.items]);
	const visibleRailActiveId = useMemo(() => resolveVisibleRailActiveId(railActiveId, outlineItemIndex, plan.items), [railActiveId, outlineItemIndex, plan.items]);

	const handleTimelineWheel = useCallback(
		(event: ReactWheelEvent<HTMLDivElement>) => {
			if (!props.onTimelineWheel || event.deltaY === 0) return;
			event.preventDefault();
			props.onTimelineWheel(event.deltaY);
		},
		[props.onTimelineWheel],
	);

	return (
		<div ref={containerRef} onWheel={handleTimelineWheel} className={cn("outline-hover pointer-events-none", props.className)}>
			{railItems.length > 0 && (
				<PreviewRail
					orientation="vertical"
					items={railItems}
					label={t("outline.title")}
					itemSize={plan.itemSize}
					previewSide="before"
					activeId={visibleRailActiveId}
					highlightActive={visibleRailActiveId !== undefined}
					onItemSelect={(item) => {
						setRailActiveId(item.id);
						props.onJump(item.id);
					}}
					/* 宽度对齐原触发按钮（30px），min-h-0 抵消组件自带的演示高度 */
					className="pointer-events-auto min-h-0 w-[30px]"
					railClassName="w-full content-center [&_[data-slot=preview-rail-item]]:w-full [&_[data-slot=preview-rail-item]]:justify-center [&_[data-slot=preview-rail-tick]]:h-px [&_[data-slot=preview-rail-tick]]:w-4 [&_[data-slot=preview-rail-tick]]:origin-center"
					previewContainerClassName="inset-y-0 right-7 left-auto w-64"
					previewClassName="[&_[data-slot=preview-rail-card]]:h-20 [&_[data-slot=preview-rail-card]]:overflow-hidden [&_[data-slot=preview-rail-card]]:p-3 [&_[data-slot=preview-rail-title]]:line-clamp-1 [&_[data-slot=preview-rail-title]]:text-xs [&_[data-slot=preview-rail-title]]:leading-4 [&_[data-slot=preview-rail-description]]:line-clamp-1 [&_[data-slot=preview-rail-description]]:text-xs [&_[data-slot=preview-rail-description]]:leading-4"
				/>
			)}
		</div>
	);
}

export const ConversationOutline = memo(ConversationOutlineView, areConversationOutlinePropsEqual);

export { DrawerContent, SessionFileSummary, SessionHistoryModal } from "./WorkspaceSurface";

export { FileContextMenu, PromptSuggestions } from "./ComposerOverlayComponents";

/** 会话管理弹框：展示项目所有会话，支持多选删除、导出、重命名 */
