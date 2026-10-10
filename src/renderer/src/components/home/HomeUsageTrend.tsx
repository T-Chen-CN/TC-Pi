import { useMemo, useState } from "react";
import type { UsageAggregated } from "../../../../shared/types";
import { buildBuckets, type RangeMode } from "../app/usageStats/usageDailyChartModel";
import { formatTokens } from "../app/usageStats/format";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";

/** 总览趋势用静态 SVG 呈现聚合桶，避免图表内部 store 与总览刷新互相触发渲染。 */
export function HomeUsageTrend({ data }: { data: UsageAggregated }) {
	const [mode, setMode] = useState<RangeMode>("day");
	const buckets = useMemo(() => buildBuckets(data.daily, mode, new Date()), [data.daily, mode]);
	const maximum = Math.max(1, ...buckets.map((bucket) => bucket.tokens));
	const width = 800;
	const height = 150;
	const columnWidth = 720 / Math.max(1, buckets.length);
	return (
		<div data-testid="home-usage-trend">
			<div className="mb-3 flex gap-1">
				{(["day", "week", "month"] as const).map((value) => (
					<Button key={value} variant={mode === value ? "secondary" : "ghost"} size="sm" className="px-3" aria-pressed={mode === value} onClick={() => setMode(value)}>
						{t(value === "day" ? "usageStats.daily.rangeDay" : value === "week" ? "usageStats.daily.rangeWeek" : "usageStats.daily.rangeMonth")}
					</Button>
				))}
			</div>
			{buckets.length ? (
				<svg viewBox={`0 0 ${width} 200`} className="h-[240px] w-full text-muted-foreground" role="img" aria-label={t("overview.trend")}>
					{[0, 0.5, 1].map((level) => (
						<g key={level}>
							<line x1="60" x2="790" y1={170 - height * level} y2={170 - height * level} className="stroke-border/60" />
							<text x="52" y={174 - height * level} textAnchor="end" fill="currentColor" fontSize="11">
								{formatTokens(maximum * level)}
							</text>
						</g>
					))}
					{buckets.map((bucket, index) => {
						const barHeight = Math.max(3, (bucket.tokens / maximum) * height);
						const center = 65 + columnWidth * (index + 0.5);
						const barWidth = Math.min(36, Math.max(2, columnWidth * 0.7));
						return (
							<g key={bucket.label}>
								<title>{`${bucket.label}: ${formatTokens(bucket.tokens)} ${t("overview.tokenUnit")}\n${bucket.byProvider.map((provider) => `${provider.provider}: ${formatTokens(provider.tokens)}`).join("\n")}`}</title>
								<rect data-testid="home-usage-bar" x={center - barWidth / 2} y={170 - barHeight} width={barWidth} height={barHeight} rx="2" className="fill-primary/75" />
								{(buckets.length <= 12 || index % Math.ceil(buckets.length / 10) === 0) && (
									<text x={center} y="188" textAnchor="middle" fill="currentColor" fontSize="11">
										{bucket.label}
									</text>
								)}
							</g>
						);
					})}
				</svg>
			) : (
				<p className="py-6 text-caption text-muted-foreground">{t("usageStats.table.empty")}</p>
			)}
		</div>
	);
}
