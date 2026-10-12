import { useEffect, useMemo } from "react";
import { useAtomValue } from "jotai";
import { ArrowRight, FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { SessionRecord } from "../../../../shared/types";
import { currentSessionIdAtom, projectInventoryAtom, sessionRecordsAtom, sidebarRuntimeAtom } from "../../atoms";
import { homeOverviewAtom, homePendingRequestsAtom } from "../../atoms/home-overview-atoms";
import type { SidebarActions } from "../sidebar/SidebarContent";
import { Button } from "../ui-shadcn/button";
import { HomeProviders } from "./HomeProviders";
import { HomeWorkSections } from "./HomeWorkSections";
import { HomeUsageSummary } from "./HomeUsageSummary";
import { buildHomeWork } from "./homeWorkModel";
import { createHomeSession } from "./homeWorkActions";
import { isChatProject } from "../../rendererUtils";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";

/** 首页只组合工作入口与摘要；打开历史和新建仍经过既有的工作区导航。 */
export function HomeOverview(props: { actions: SidebarActions; onRefresh: () => Promise<void> }) {
	const projects = useAtomValue(projectInventoryAtom);
	const records = useAtomValue(sessionRecordsAtom);
	const runtimes = useAtomValue(sidebarRuntimeAtom);
	const pendingRequests = useAtomValue(homePendingRequestsAtom);
	const currentSessionId = useAtomValue(currentSessionIdAtom);
	const overview = useAtomValue(homeOverviewAtom);
	const work = useMemo(() => buildHomeWork({ projects, sessions: Object.values(records), runtimes, pendingRequests, currentSessionId }), [projects, records, runtimes, pendingRequests, currentSessionId]);
	const workspaces = useMemo(() => projects.filter((project) => !isChatProject(project)), [projects]);
	const projectIds = projects.map((project) => project.id).join("\n");
	const ensure = props.actions.sessions.ensureCatalogsLoaded;
	useEffect(() => {
		ensure(projectIds ? projectIds.split("\n") : []);
	}, [projectIds, ensure]);
	const fail = () => showNotice(t("workspace.navigationFailed"));
	const openSession = (session: SessionRecord) => {
		void props.actions.sessions.open(session.projectId, session.id).catch(fail);
	};
	const openProject = (projectId: string) => {
		void Promise.resolve(props.actions.projects.select(projectId)).catch(fail);
	};
	const newSession = () => {
		void createHomeSession({ addWorkspace: props.actions.projects.add, createDraft: props.actions.sessions.createDraft }, work.newSessionProjectId).catch(fail);
	};
	return (
		<div className="@container h-full min-h-0 overflow-y-auto px-4 py-6 text-foreground @xl:px-6" data-testid="home-overview">
			<div className="mx-auto flex max-w-5xl flex-col gap-5">
				<header className="relative z-[930] flex items-start justify-between gap-3 [.custom-titlebar-enabled_&]:[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
					<div>
						<p className="mb-1 text-caption text-muted-foreground">{t("overview.brand")}</p>
						<h1 className="text-2xl font-semibold tracking-tight">{t("overview.title")}</h1>
						<p className="mt-2 text-caption text-muted-foreground">{t("overview.subtitle")}</p>
					</div>
					<Button variant="ghost" size="sm" disabled={overview.loading} onClick={() => void props.onRefresh().catch(fail)}>
						<RefreshCw className={overview.loading ? "size-3.5 animate-pideck-spin" : "size-3.5"} />
						{t("common.refresh")}
					</Button>
				</header>
				<section className="min-w-0 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label={t("overview.quickStart")} data-testid="home-quick-start">
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={!work.resumeSession}
							onClick={() => {
								if (work.resumeSession) openSession(work.resumeSession);
							}}
						>
							<ArrowRight className="size-4" />
							{t("overview.resume")}
						</Button>
						<Button variant="outline" onClick={newSession}>
							<Plus className="size-4" />
							{t("app.newSession")}
						</Button>
						<Button variant="ghost" onClick={() => void props.actions.projects.add().catch(fail)}>
							<FolderOpen className="size-4" />
							{t("overview.openWorkspace")}
						</Button>
					</div>
					<p className="mt-3 truncate text-caption text-muted-foreground" title={work.resumeSession?.title}>
						{work.resumeSession ? t("overview.resumeHint", { title: work.resumeSession.title }) : t("overview.startHint")}
					</p>
				</section>
				<HomeWorkSections work={work} projects={projects} onOpenSession={openSession} onOpenProject={openProject} />
				<HomeUsageSummary workspaces={workspaces} runningCount={work.running.length} onOpenProject={openProject} />
				<HomeProviders />
			</div>
		</div>
	);
}
