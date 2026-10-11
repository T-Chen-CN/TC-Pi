import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FoldVertical } from "lucide-react";
import { useSetAtom } from "jotai";
import { t } from "../../i18n";
import type { AgentRuntimeState } from "../../../../shared/types";
import type { UsageProbeBackend } from "../../../../shared/types/providerUsage";
import { compactUiState, resolveCompactUsagePercent } from "../../../../shared/compactFeedback";
import type { SessionRuntimeTarget } from "../../../../shared/types";
import { openSettingsAtom } from "../../atoms/app-ui-atoms";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";
import { ProviderUsageDetails } from "../app/ProviderUsageDetails";
import { buildSessionStatusDetail } from "./SurfaceComponents";
import { formatPercent } from "./TimelineFormat";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const COLOR_CONVERSATION = "var(--color-context-conversation, #2563eb)";
const COLOR_SYSTEM_TOOLS = "var(--color-context-system-tools, rgb(167, 139, 250))";

/** 弹出面板宽度：原 264px 对「输入/输出 tokens / 命中率快照」过窄会折行；
 *  320 仍贴 composer 不挡主栏。style.width 与定位回退必须用同一常量，
 *  避免首帧 offsetWidth=0 时按旧宽度错位。 */
const PANEL_WIDTH = 320;

export function formatTokens(n: number): string {
	const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
	return `${scaled(n / 1_000_000)}M`;
}

/** 币种代码 → 常用符号（未知代码原样展示，避免硬编码映射丢失币种）。 */
function currencySymbol(code?: string): string {
	switch ((code ?? "").toUpperCase()) {
		case "CNY":
		case "RMB":
			return "¥";
		case "USD":
			return "$";
		case "EUR":
			return "€";
		case "GBP":
			return "£";
		default:
			return (code ?? "").trim();
	}
}

/** 金额/点数格式化：最多两位小数，整数不显示小数点。 */
function formatAmount(n: number): string {
	const rounded = Math.round(n * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** 余额展示：有符号用「¥110」，无符号用「110 CNY」，无币种只用数字。 */
function formatBalance(balance: { value: number; currency?: string }): string {
	const symbol = currencySymbol(balance.currency);
	const amount = formatAmount(balance.value);
	if (symbol) return `${symbol}${amount}`;
	if (balance.currency) return `${amount} ${balance.currency}`;
	return amount;
}

export function contextOccupancy(state: Pick<AgentRuntimeState, "contextPercent" | "contextTokens" | "contextWindow"> | undefined): { percent: number; usedTokens?: number; contextWindow?: number } | null {
	const usedTokens = state?.contextTokens ?? undefined;
	const contextWindow = state?.contextWindow ?? undefined;
	// 百分比与 /compact 共用 resolveCompactUsagePercent，避免圆环和斜杠门槛分叉。
	const percent = resolveCompactUsagePercent(state);
	if (percent == null || contextWindow == null) return null;
	return {
		percent,
		usedTokens,
		contextWindow,
	};
}

/** 占用构成：
 *  - breakdown：host contextBreakdown 投影（dsh），系统/工具/对话三段直接可用（0 也是有效值）；
 *  - estimate：无投影时的反推两段（对话 = 消息估算，系统+工具 = total − 对话，pi 路径）。
 *  返回 null 表示无估算数据（渲染单段条）。 */
export type ContextSegments = { kind: "estimate"; conversation: number; systemTools: number };

export function contextSegments(state: Pick<AgentRuntimeState, "contextTokens" | "contextMessageTokens"> | undefined): ContextSegments | null {
	const total = state?.contextTokens;
	const messageTokens = state?.contextMessageTokens;
	if (total == null || total <= 0 || messageTokens == null || messageTokens <= 0) return null;
	const conversation = Math.min(messageTokens, total);
	return { kind: "estimate", conversation, systemTools: Math.max(0, total - conversation) };
}

export function SessionContextMeter(props: {
	state?: Pick<
		AgentRuntimeState,
		"contextPercent" | "contextTokens" | "contextWindow" | "contextOverflow" | "contextMessageTokens" | "cacheHitPercent" | "cacheHitAveragePercent" | "cacheHitSampleCount" | "inputTokens" | "outputTokens" | "isCompacting" | "cost" | "ttftMs" | "totalMs" | "tps" | "cacheRead" | "cacheWrite" | "cacheTotal" | "provider"
	>;
	/** 压缩上下文（原右上角紧凑徽章动作，迁入面板底部） */
	onCompact?: () => void;
	/** 超限错误时的恢复动作：压缩入口必须能在占用快照缺失时直接触发。 */
	overflowRecoveryTarget?: SessionRuntimeTarget;
	onOverflowRecovery?: (target: SessionRuntimeTarget) => void;
	/**
	 * 运行时缺省时的 provider 兜底（由会话记录/默认 model 推导）：用量查询只依赖
	 * provider 配置解析端点、不依赖 agent 运行，未激活/未启动会话也可查用量。
	 */
	fallbackProvider?: string;

	backend?: UsageProbeBackend;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLSpanElement | null>(null);
	/** 面板 fixed 定位：相对 viewport 的 {left, top}；null = 尚未定位（首帧隐藏） */
	const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const context = contextOccupancy(props.state);
	const available = context !== null;
	const segments = contextSegments(props.state);
	const compacting = props.state?.isCompacting === true;
	// 完整详情复用会话头部 SessionStatus 的构建器：平均命中率以主进程
	// 文件统计为准（缓存快照历史均值仅作降级，头部同款语义）
	const detail = buildSessionStatusDetail(props.state, props.state?.cacheHitAveragePercent ?? undefined, props.state?.cacheHitSampleCount ?? 0);
	// 统计圆环已移动到输入框底栏，但点击后的详情仍需完整展示 token 与缓存数据。
	// 这里保留完整明细，避免用户必须从一行截断文本里猜测具体数值。
	const panelDetailRows = detail.detailRows;

	// ── 面板内 provider 用量/余额区块 ─────────────────────────────
	// 数据源与展示统一收敛到 ProviderUsageDetails（与模型选择器展开区共享同一份
	// provider-usage-atoms 缓存，本组件只决定「是否渲染」与「失败跳转」）。
	// 用量查询不依赖 agent 运行：未激活/未启动会话用会话记录/默认 model 推导的
	// provider 兜底（ComposerComponents 已按 liveState → record → defaultModel 顺序解析）。
	const provider = props.state?.provider?.trim() || props.fallbackProvider?.trim() || undefined;
	const openModelsSettings = useSetAtom(openSettingsAtom);
	// 查不到用量 → 一键跳「设置 → 配置管理 → 模型」并定位该供应商（唯一配置入口）。
	const onConfigureUsage = useCallback(() => {
		if (!provider) return;
		openModelsSettings({ tab: "common", pane: "config", configTab: "models", provider });
	}, [provider, openModelsSettings]);
	// 有 provider 名才渲染用量区块。
	const showUsage = provider != null;

	// 圆环常驻：无 capacity 时也渲染占位环，不再因模型切换瞬间关闭面板
	// （原：不渲染过期面板；用户要求非激活会话也常驻圆环）。

	// 面板定位：fixed 相对 viewport（portal 到 body，脱离 composer 的 overflow 裁剪）。
	// 向上弹出（面板底边贴 trigger 顶），顶部空间不足时翻转到 trigger 下方；
	// 面板内容高度随数据变化，每次打开/内容变化都重新测量（首帧 hidden 定位）。
	// 抽成 useCallback 供打开/数据变化（layout effect）与滚动/resize（scroll 监听）
	// 两条路径复用——滚动时保持面板贴 trigger 而不是关闭。
	const positionPanel = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || !panel) return;
		const rect = trigger.getBoundingClientRect();
		const panelWidth = panel.offsetWidth || PANEL_WIDTH;
		const panelHeight = panel.offsetHeight;
		const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
		let top = rect.top - 8 - panelHeight;
		if (top < 8) top = rect.bottom + 8; // 上方放不下：翻转到 trigger 下方
		// 位置未变不重复 setState：流式渲染追底滚动期间每帧都有 scroll 事件，
		// trigger 固定在底部栏（不随消息滚动），位置不变时避免每帧 re-render
		setPlacement((prev) => (prev !== null && prev.left === left && prev.top === top ? prev : { left, top }));
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		positionPanel();
		// 依赖只用原始值（对象引用每次渲染都变，会导致定位循环）：
		// 数据更新（占用/费用/压缩态变化）或尺寸变化时重新测量定位
	}, [open, context?.percent, context?.usedTokens, context?.contextWindow, props.state?.cost, props.state?.cacheHitPercent, props.state?.cacheHitAveragePercent, props.state?.isCompacting, positionPanel]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent): void => {
			const inside = e.target instanceof Node && (rootRef.current?.contains(e.target) === true || panelRef.current?.contains(e.target) === true);
			if (inside) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// fixed 面板本身不随滚动移动，滚动/resize 会导致 trigger 相对 viewport 变化：
	// 重新锚定面板到 trigger 当前位置而不是关闭——流式渲染追底滚动（弹簧/instant
	// 跳转）期间面板保持打开且贴 trigger，不再「点开就关」（2026-08 用户反馈）。
	// 外点 / Escape 仍是关闭面板的唯一途径。
	useEffect(() => {
		if (!open) return;
		let raf = 0;
		const reanchor = (): void => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(positionPanel);
		};
		window.addEventListener("scroll", reanchor, true);
		window.addEventListener("resize", reanchor);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", reanchor, true);
			window.removeEventListener("resize", reanchor);
		};
	}, [open, positionPanel]);

	// 无 capacity 数据（会话未运行/模型切换瞬间）也渲染占位环：0% 空环 +「暂不可用」提示，
	// 保证底部栏圆环常驻。contextOccupancy 语义不变（仍返回 null 供面板内部判断）。
	const percent = context?.percent ?? 0;
	// 上下文超限失败后，Pi 仍可能没有可用的 get_session_stats 百分比（错误回合没有
	// 成功 assistant usage）。此时不能把唯一恢复入口锁死：主进程已明确标记 overflow，
	// 手动压缩由 pi 自己决定是否有可压内容。
	const overflowRecovery = props.state?.contextOverflow === true;
	// 低占用保留有效数字（1M 窗口下 408 tokens ≈ 0.04%，不显示成「0%」）
	const reading = context !== null ? t("sessionContext.used", { percent: formatPercent(percent) }) : overflowRecovery ? t("sessionContext.overflow") : t("sessionContext.unavailable");
	const figures = context !== null && [context.usedTokens, context.contextWindow].every((v) => v != null) ? `~${formatTokens(context.usedTokens!)} / ${formatTokens(context.contextWindow!)}` : undefined;
	const showCompact = props.onCompact !== undefined || (overflowRecovery && props.overflowRecoveryTarget !== undefined && props.onOverflowRecovery !== undefined);
	// 压缩按钮态走共享策略：无占用数据（percent 未上报）禁用；压缩中禁用。
	// 传 context?.percent 而非 ?? 0 后的 percent：占位环需要 0，但未就绪判定
	// 必须以「是否有真实数据」为准（percent=0 的真实数据也允许压缩）。
	const compactUi = compactUiState(context?.percent, compacting);
	const compactDisabled = compactUi.compacting || (!compactUi.ready && !overflowRecovery);
	const compactUrgency = overflowRecovery
		? "text-destructive border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
		: compactUi.urgency === "danger"
			? "text-destructive border-destructive/40 hover:bg-destructive/10"
			: compactUi.urgency === "warn"
				? "text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
				: "border-border hover:bg-muted/60";

	return (
		<span ref={rootRef} className="relative inline-flex" data-testid="session-context-meter">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						ref={triggerRef}
						type="button"
						className="grid size-7 flex-none place-items-center rounded-full text-text-tertiary transition-colors hover:bg-muted/60"
						aria-label={reading}
						aria-haspopup="dialog"
						aria-expanded={open}
						onClick={() => {
							setOpen((value) => !value);
						}}
					>
						<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
							<circle className="fill-none stroke-[var(--color-border)]" cx="7" cy="7" r={RADIUS} strokeWidth={2} />
							<circle className="fill-none stroke-[var(--color-text-tertiary)] [stroke-linecap:round]" cx="7" cy="7" r={RADIUS} strokeWidth={2} strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" />
						</svg>
					</button>
				</TooltipTrigger>
				<TooltipContent>{reading}</TooltipContent>
			</Tooltip>
			{open &&
				createPortal(
					<div
						ref={panelRef}
						role="dialog"
						aria-label={reading}
						className="fixed z-[100] cursor-default rounded-xl border border-border bg-popover p-3 text-xs leading-5 text-text-secondary shadow-[var(--shadow-popover)]"
						style={{
							left: placement?.left,
							top: placement?.top,
							width: PANEL_WIDTH,
							visibility: placement === null ? "hidden" : "visible",
						}}
					>
						<div className="flex items-center gap-1.5">
							<span className="text-text-tertiary" title={t("sessionContext.usageHint")}>
								{reading}
							</span>
							{available && figures !== undefined && <span className="ml-auto font-medium tabular-nums text-foreground">{figures}</span>}
						</div>
						<div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
							{segments === null ? (
								<div className="h-full rounded-full bg-text-tertiary" style={{ width: `${percent}%` }} />
							) : (
								// 两段：对话（蓝）在前、系统+工具（紫）在后，宽度按占 contextTokens 比例
								<div className="flex h-full overflow-hidden rounded-full">
									<div
										className="h-full"
										style={{
											width: `${Math.min(100, (segments.conversation / (context?.contextWindow ?? 1)) * 100)}%`,
											backgroundColor: COLOR_CONVERSATION,
										}}
									/>
									<div
										className="h-full"
										style={{
											width: `${Math.min(100, (segments.systemTools / (context?.contextWindow ?? 1)) * 100)}%`,
											backgroundColor: COLOR_SYSTEM_TOOLS,
										}}
									/>
								</div>
							)}
						</div>
						{available && segments !== null && (
							<div className="mt-2 space-y-0.5">
								{
									<>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_CONVERSATION }} />
											<span title={t("sessionContext.conversationEstimateHint")}>{t("sessionContext.conversation")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.conversation)}</span>
										</div>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_SYSTEM_TOOLS }} />
											<span title={t("sessionContext.systemToolsEstimateHint")}>{t("sessionContext.systemTools")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.systemTools)}</span>
										</div>
									</>
								}
							</div>
						)}
						{(panelDetailRows.length > 0 || detail.replyPerfRows.length > 0) && (
							<div className="mt-2 space-y-0.5 border-t border-border pt-2">
								{panelDetailRows.map((row) => (
									<div key={row.label} title={row.hint} className={`flex items-baseline justify-between gap-4 px-0.5 py-0.5 text-caption leading-5${row.emphasis ? " mt-1 border-t border-border/70 pt-1.5" : ""}`}>
										<span className="shrink-0 text-text-secondary">{row.label}</span>
										<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
									</div>
								))}
							</div>
						)}
						{detail.replyPerfRows.length > 0 && (
							<div className="mt-2.5 space-y-0.5 border-t border-border pt-2">
								<div className="px-0.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">{t("ctx.detail.lastReply")}</div>
								{detail.replyPerfRows.map((row) => (
									<div key={row.label} title={row.hint} className="flex items-baseline justify-between gap-4 px-0.5 py-0.5 text-caption leading-5">
										<span className="shrink-0 text-text-secondary">{row.label}</span>
										<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
									</div>
								))}
							</div>
						)}

						{provider && showUsage && (
							// 用量区块：与模型选择器展开区共享 ProviderUsageDetails（同数据源同视觉）；

							// 失败态「配置用量查询」按钮跳设置模型页并定位供应商。
							<div className="mt-2.5" data-testid="session-context-usage">
								<ProviderUsageDetails provider={provider} backend={props.backend} onConfigureUsage={onConfigureUsage} />
							</div>
						)}
						{showCompact && (
							<button
								type="button"
								data-testid="session-context-compact"
								disabled={compactDisabled}
								title={compactUi.compacting ? t("sessionContext.compacting") : overflowRecovery ? t("sessionContext.compactOverflowHint") : compactUi.ready ? t("sessionContext.compact") : t("sessionContext.compactNotReadyHint")}
								onClick={() => {
									if (overflowRecovery && props.overflowRecoveryTarget && props.onOverflowRecovery) {
										props.onOverflowRecovery(props.overflowRecoveryTarget);
										return;
									}
									props.onCompact?.();
								}}
								className={`mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border bg-transparent text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${compactUrgency}`}
							>
								<FoldVertical size={13} className={compactUi.compacting ? "animate-pideck-spin" : undefined} />
								{compactUi.compacting ? t("sessionContext.compacting") : overflowRecovery ? t("sessionContext.compactOverflow") : compactUi.ready ? t("sessionContext.compact") : t("sessionContext.compactNotReady")}
							</button>
						)}
					</div>,
					document.body,
				)}
		</span>
	);
}
