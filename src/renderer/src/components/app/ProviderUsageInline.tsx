import { Fragment } from "react";
import { Clock, RefreshCw } from "lucide-react";
import type { UsageProbeBackend } from "../../../../shared/types/providerUsage";
import { useProviderUsageEntry, useProviderUsageRefresh, useProviderUsageState } from "../../hooks/useProviderUsage";
import { usageBadgePrimarySegment, usageBadgeSegments, USAGE_TONE_TEXT_CLASS, relativeTimeParts, type UsageBadgeSegment } from "../../utils/providerUsageDisplay";
import { t } from "../../i18n";

/** 一段用量的渲染：灰标签 + 彩色粗体数值（段间由调用方加分隔点）。 */
function UsageSegment(props: { segment: UsageBadgeSegment }) {
	const { segment } = props;
	return (
		<span className="inline-flex items-baseline gap-0.5 whitespace-nowrap">
			<span className="text-text-tertiary">{segment.labelKey != null ? t(segment.labelKey) : segment.labelText}</span>
			<span className={`font-mono font-semibold tabular-nums ${USAGE_TONE_TEXT_CLASS[segment.tone]}`}>{segment.text}</span>
		</span>
	);
}

/** 数值段：卡片 = 全部档位（·分隔）；选择器行 = 最严重的一段。 */
function UsageSegments(props: { segments: UsageBadgeSegment[]; className?: string }) {
	return (
		<span className={`flex-none whitespace-nowrap font-mono text-caption tabular-nums ${props.className ?? ""}`}>
			{props.segments.map((segment, index) => (
				<Fragment key={`${segment.labelKey ?? segment.labelText ?? ""}:${index}`}>
					{index > 0 && <span className="px-1 text-text-tertiary">·</span>}
					<UsageSegment segment={segment} />
				</Fragment>
			))}
		</span>
	);
}

/** 刷新按钮：查询中显示转圈；点击不冒泡（卡片整行点击是展开/收起）。 */
function UsageRefreshButton(props: { provider: string; backend: UsageProbeBackend; loading: boolean }) {
	const refresh = useProviderUsageRefresh();
	return (
		<button
			type="button"
			data-testid="provider-usage-inline-refresh"
			title={t("config.usage.refresh")}
			aria-label={t("config.usage.refresh")}
			onClick={(event) => {
				event.stopPropagation();
				refresh(props.provider, props.backend);
			}}
			className="flex h-4 w-4 flex-none items-center justify-center rounded text-text-tertiary transition-colors hover:bg-muted/60 hover:text-foreground"
		>
			<RefreshCw size={10} className={props.loading ? "animate-pideck-spin" : undefined} />
		</button>
	);
}

export function ProviderUsageInline(props: {
	provider: string;
	/** row = 选择器分组行（无数据不渲染）；card = 卡片头部常驻徽章（只读四态）。 */
	variant: "row" | "card";
	backend?: UsageProbeBackend;
	className?: string;
}) {
	const backend = props.backend ?? "pi";
	const entry = useProviderUsageEntry(props.provider, backend);
	const state = useProviderUsageState(props.provider, backend);
	if (!props.provider) return null;

	if (props.variant === "row") {
		if (!entry.result?.success) return null;
		const primary = usageBadgePrimarySegment(entry.result, t);
		if (!primary) return null;
		return <UsageSegments segments={[primary]} className={props.className} />;
	}

	// card：只在「已启用」时渲染。未启用/状态未回来都不占位——开关在右侧「用量查询」弹窗里，
	// 徽章只展示数据，不留「未启用」这类噪音文案。
	if (!state?.enabled) return null;

	const loading = entry.status === "loading";
	const result = entry.result;
	const segments = result?.success ? usageBadgeSegments(result, t) : null;
	const failed = !loading && result != null && !result.success;
	const time = entry.fetchedAt != null ? relativeTimeParts(entry.fetchedAt) : null;

	return (
		<span className={`flex flex-none items-center gap-1.5 whitespace-nowrap ${props.className ?? ""}`} data-testid="provider-usage-inline" data-provider={props.provider} data-enabled="true">
			{time && segments && segments.length > 0 && (
				<span className="inline-flex items-center gap-0.5 text-[10px] text-text-tertiary">
					<Clock size={10} aria-hidden="true" />
					{t(time.key, time.params)}
				</span>
			)}
			{segments && segments.length > 0 ? (
				<UsageSegments segments={segments} />
			) : (
				<span
					className="text-caption text-text-tertiary"
					// 失败时把主进程给的原因挂在 title 上：卡片空间有限，hover 才能看到细节。
					title={failed ? (result?.error ?? undefined) : undefined}
				>
					{failed ? t("config.usage.badgeFailed") : t("config.usage.badgeLoading")}
				</span>
			)}
			<UsageRefreshButton provider={props.provider} backend={backend} loading={loading} />
		</span>
	);
}
