import { useEffect, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Activity, ArrowUpRight, Clock, FolderOpen, Layers, RefreshCw, Wallet } from "lucide-react";
import { projectInventoryAtom, sessionRecordsAtom, sidebarRuntimeAtom } from "../../atoms";
import { homeOverviewAtom, homeOverviewRangeAtom, homePendingRequestsAtom } from "../../atoms/home-overview-atoms";
import { overviewProjectPath, overviewUsage, type OverviewRange } from "./homeOverviewModel";
import type { SidebarActions } from "../sidebar/SidebarContent";
import { Button } from "../ui-shadcn/button";
import { HomeUsageTrend } from "./HomeUsageTrend";
import { formatCost, formatTokens } from "../app/usageStats/format";
import { isChatProject, displayProjectDirectoryName } from "../../rendererUtils";
import { workspaceSessions } from "../../utils/workspaceNavigation";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";

/** 全局总览：仅浏览 catalog 摘要，历史打开仍走原会话链路。 */
export function HomeOverview(props: { actions: SidebarActions; onRefresh: () => Promise<void> }) {
	const projects = useAtomValue(projectInventoryAtom);
	const records = useAtomValue(sessionRecordsAtom);
	const runtimes = useAtomValue(sidebarRuntimeAtom);
	const pendingRequests = useAtomValue(homePendingRequestsAtom);
	const overview = useAtomValue(homeOverviewAtom);
	const [range, setRange] = useAtom(homeOverviewRangeAtom);
	const sessions = useMemo(() => workspaceSessions(Object.values(records)), [records]);
	const workspaces = projects.filter((project) => !isChatProject(project));
	const usage = overview.usage ? overviewUsage(overview.usage, range) : undefined;
	const running = Object.values(records).filter((session) => {
		const runtime = runtimes[session.id];
		return runtime?.agentId && !["closed", "detached", "error"].includes(runtime.status);
	});
	const projectIds = projects.map((project) => project.id).join("\n");
	const ensure = props.actions.sessions.ensureCatalogsLoaded;
	useEffect(() => {
		ensure(projectIds ? projectIds.split("\n") : []);
	}, [projectIds, ensure]);
	const fail = () => showNotice(t("workspace.navigationFailed"));
	const open = (projectId: string, sessionId: string) => {
		void props.actions.sessions.open(projectId, sessionId).catch(fail);
	};
	const values = [
		{ label: t("overview.workspaces"), value: workspaces.length.toLocaleString(), icon: FolderOpen },
		{ label: t("overview.sessions"), value: sessions.length.toLocaleString(), icon: Layers },
		{ label: t("overview.tokens"), value: usage ? formatTokens(usage.totals.tokens) : "—", icon: Activity },
		{ label: t("overview.cost"), value: usage ? formatCost(usage.totals.cost) + (usage.costKnown ? "" : " *") : "—", icon: Wallet },
	];
	return (
		<div className="h-full min-h-0 overflow-y-auto px-6 py-7 text-foreground" data-testid="home-overview">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex items-start justify-between gap-3">
					<div>
						<p className="mb-1 text-caption text-muted-foreground">{t("overview.brand")}</p>
						<h1 className="text-2xl font-semibold tracking-tight">{t("overview.title")}</h1>
						<p className="mt-2 text-caption text-muted-foreground">{t("overview.subtitle")}</p>
					</div>
					<Button variant="outline" size="sm" disabled={overview.loading} onClick={() => void props.onRefresh().catch(fail)}>
						<RefreshCw className={overview.loading ? "size-3.5 animate-pideck-spin" : "size-3.5"} />
						{t("common.refresh")}
					</Button>
				</header>
				<div className="flex flex-wrap gap-1" aria-label={t("overview.range")}>
					{(["all", "today", "week", "month"] as const).map((value: OverviewRange) => (
						<Button key={value} variant={range === value ? "secondary" : "ghost"} size="sm" aria-pressed={range === value} onClick={() => setRange(value)}>
							{t(value === "all" ? "overview.all" : value === "today" ? "overview.today" : value === "week" ? "overview.week" : "overview.month")}
						</Button>
					))}
				</div>
				<div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
					{values.map(({ label, value, icon: Icon }) => (
						<div key={label} className="rounded-xl border border-border/60 bg-card p-4">
							<div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
								<span>{label}</span>
								<Icon className="size-4" />
							</div>
							<p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
						</div>
					))}
				</div>
				{overview.usageMissing && <p className="rounded-lg bg-muted/60 px-4 py-3 text-caption text-muted-foreground">{t("overview.usageMissing")}</p>}
				{overview.usageError && (
					<p role="alert" className="text-caption text-destructive">
						{t("overview.usageError")}
					</p>
				)}
				{usage && !usage.costKnown && <p className="text-caption text-muted-foreground">{t("usageStats.cards.costUnknown")}</p>}
				{overview.usage && (
					<section className="rounded-xl border border-border/60 bg-card p-4">
						<h2 className="mb-3 text-body font-semibold">{t("overview.trend")}</h2>
						<HomeUsageTrend data={overview.usage} />
					</section>
				)}
				<section className="rounded-xl border border-border/60 bg-card p-4">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-body font-semibold">{t("overview.projectUsage")}</h2>
						<span className="text-micro text-muted-foreground">
							{t("overview.tokens")} / {t("overview.costUnit")}
						</span>
					</div>
					{workspaces.length === 0 && <p className="py-4 text-caption text-muted-foreground">{t("overview.noWorkspaces")}</p>}
					{workspaces.map((project) => {
						const cost = usage?.projects.find((row) => overviewProjectPath(row.project) === overviewProjectPath(project.path));
						return (
							<Button key={project.id} variant="ghost" className="h-auto min-h-12 w-full min-w-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => props.actions.projects.select(project.id)}>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-caption font-medium">{displayProjectDirectoryName(project)}</span>
									<span className="block truncate text-micro text-muted-foreground">{project.path}</span>
								</span>
								<span className="shrink-0 text-caption tabular-nums text-muted-foreground">{cost ? `${formatTokens(cost.tokens)} / ${formatCost(cost.cost)}${usage?.costKnown ? "" : " *"}` : "—"}</span>
								<ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
							</Button>
						);
					})}
				</section>
				<section className="rounded-xl border border-border/60 bg-card p-4">
					<h2 className="mb-3 flex items-center gap-2 text-body font-semibold">
						<Activity className="size-4" />
						{t("overview.running")}
						<span className="text-caption font-normal text-muted-foreground">{running.length}</span>
					</h2>
					{running.length ? (
						running.map((session) => (
							<Button key={session.id} variant="ghost" className="h-9 w-full justify-between gap-3 px-2" onClick={() => open(session.projectId, session.id)}>
								<span className="min-w-0 truncate text-caption">{session.title}</span>
								<span className="text-caption text-primary">
									{pendingRequests[session.id] ? t("overview.pendingRequests", { count: pendingRequests[session.id] }) : runtimes[session.id]?.status === "starting" ? t("overview.starting") : runtimes[session.id]?.status === "running" ? t("workspace.active") : t("overview.waiting")}
								</span>
							</Button>
						))
					) : (
						<p className="py-2 text-caption text-muted-foreground">{t("overview.noRunning")}</p>
					)}
				</section>
				<section className="rounded-xl border border-border/60 bg-card p-4">
					<h2 className="mb-3 flex items-center gap-2 text-body font-semibold">
						<Clock className="size-4" />
						{t("overview.recent")}
					</h2>
					{!sessions.length && <p className="py-4 text-caption text-muted-foreground">{t("workspace.noSessions")}</p>}
					{sessions.slice(0, 12).map((session) => (
						<Button key={session.id} variant="ghost" className="h-auto min-h-12 w-full min-w-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => open(session.projectId, session.id)}>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-caption font-medium">{session.title}</span>
								<span className="block truncate text-micro text-muted-foreground">
									{projects.find((item) => item.id === session.projectId)?.name} · {session.preview || t("workspace.history")}
								</span>
							</span>
							<time className="shrink-0 text-micro text-muted-foreground">{new Date(session.updatedAt).toLocaleDateString()}</time>
						</Button>
					))}
				</section>
			</div>
		</div>
	);
}
