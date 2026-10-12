import { useAtom, useAtomValue } from "jotai";
import { Activity, ArrowUpRight, ChevronDown, FolderOpen, Wallet } from "lucide-react";
import type { Project } from "../../../../shared/types";
import { homeOverviewAtom, homeOverviewRangeAtom } from "../../atoms/home-overview-atoms";
import { displayProjectDirectoryName } from "../../rendererUtils";
import { t } from "../../i18n";
import { formatCost, formatTokens } from "../app/usageStats/format";
import { Button } from "../ui-shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui-shadcn/collapsible";
import { HomeUsageTrend } from "./HomeUsageTrend";
import { overviewProjectPath, overviewUsage, type OverviewRange } from "./homeOverviewModel";

/** 用量摘要保留在首页下方，趋势与完整项目消耗由用户按需展开。 */
export function HomeUsageSummary({ workspaces, runningCount, onOpenProject }: { workspaces: readonly Project[]; runningCount: number; onOpenProject: (projectId: string) => void }) {
	const overview = useAtomValue(homeOverviewAtom);
	const [range, setRange] = useAtom(homeOverviewRangeAtom);
	const usage = overview.usage ? overviewUsage(overview.usage, range) : undefined;
	const values = [
		{ label: t("overview.workspaces"), value: workspaces.length.toLocaleString(), icon: FolderOpen },
		{ label: t("overview.runningTasks"), value: runningCount.toLocaleString(), icon: Activity },
		{ label: t("overview.tokens"), value: usage ? formatTokens(usage.totals.tokens) : "—", icon: Activity },
		{ label: t("overview.cost"), value: usage ? formatCost(usage.totals.cost) + (usage.costKnown ? "" : " *") : "—", icon: Wallet },
	];
	return (
		<section className="min-w-0 rounded-xl border border-border/60 bg-card p-4" data-testid="home-usage-summary">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-body font-semibold">{t("overview.usageSummary")}</h2>
				<div className="flex flex-wrap gap-1" aria-label={t("overview.range")}>
					{(["today", "week", "month", "all"] as const).map((value: OverviewRange) => (
						<Button key={value} variant={range === value ? "secondary" : "ghost"} size="sm" aria-pressed={range === value} onClick={() => setRange(value)}>
							{t(value === "all" ? "overview.all" : value === "today" ? "overview.today" : value === "week" ? "overview.week" : "overview.month")}
						</Button>
					))}
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
				{values.map(({ label, value, icon: Icon }) => (
					<div key={label} className="min-w-0 rounded-lg bg-muted/40 p-3">
						<div className="flex items-center justify-between gap-2 text-micro text-muted-foreground">
							<span>{label}</span>
							<Icon className="size-3.5 shrink-0" />
						</div>
						<p className="mt-2 truncate text-xl font-semibold tabular-nums" title={value}>
							{value}
						</p>
					</div>
				))}
			</div>
			{overview.usageMissing && <p className="mt-3 text-caption text-muted-foreground">{t("overview.usageMissing")}</p>}
			{overview.usageError && (
				<p role="alert" className="mt-3 text-caption text-destructive">
					{t("overview.usageError")}
				</p>
			)}
			{usage && !usage.costKnown && <p className="mt-3 text-caption text-muted-foreground">{t("usageStats.cards.costUnknown")}</p>}
			{overview.usage && (
				<Collapsible className="mt-3" data-testid="home-usage-details">
					<CollapsibleTrigger asChild>
						<Button variant="ghost" size="sm" className="group w-full justify-between text-muted-foreground">
							{t("overview.usageDetails")}
							<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-4 border-t border-border/60 pt-4">
							<h3 className="mb-3 text-caption font-semibold">{t("overview.trend")}</h3>
							<HomeUsageTrend data={overview.usage} />
							<div className="mt-4 flex items-center justify-between gap-2">
								<h3 className="text-caption font-semibold">{t("overview.projectUsage")}</h3>
								<span className="text-micro text-muted-foreground">
									{t("overview.tokens")} / {t("overview.costUnit")}
								</span>
							</div>
							{workspaces.map((project) => {
								const cost = usage?.projects.find((row) => overviewProjectPath(row.project) === overviewProjectPath(project.path));
								return (
									<Button key={project.id} variant="ghost" className="mt-1 h-auto min-h-10 w-full min-w-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => onOpenProject(project.id)}>
										<span className="min-w-0 truncate text-caption">{displayProjectDirectoryName(project)}</span>
										<span className="shrink-0 text-micro tabular-nums text-muted-foreground">{cost ? `${formatTokens(cost.tokens)} / ${formatCost(cost.cost)}${usage?.costKnown ? "" : " *"}` : "—"}</span>
										<ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
									</Button>
								);
							})}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</section>
	);
}
