import { Activity, ArrowUpRight, CircleAlert, Clock, FolderOpen } from "lucide-react";
import type { Project, SessionRecord } from "../../../../shared/types";
import { displayProjectDirectoryName } from "../../rendererUtils";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import type { buildHomeWork, HomeTask } from "./homeWorkModel";

type HomeWorkSectionsProps = {
	work: ReturnType<typeof buildHomeWork>;
	projects: readonly Project[];
	onOpenSession: (session: SessionRecord) => void;
	onOpenProject: (projectId: string) => void;
};

/** 任务状态明确区分需要用户处理、正在执行和正在启动。 */
function HomeTaskRow({ task, onOpen }: { task: HomeTask; onOpen: (session: SessionRecord) => void }) {
	const label = task.state === "pending" ? t("overview.pendingRequests", { count: task.pendingCount }) : task.state === "error" ? t("overview.taskFailed") : task.state === "starting" ? t("overview.starting") : t("overview.executing");
	return (
		<Button variant="ghost" className="h-auto min-h-10 w-full shrink-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => onOpen(task.session)}>
			<span className="min-w-0 truncate text-caption font-medium">{task.session.title}</span>
			<span className={task.state === "error" ? "shrink-0 text-micro text-destructive" : "shrink-0 text-micro text-primary"}>{label}</span>
		</Button>
	);
}

/** 首页的工作入口优先于统计；列表限高滚动，避免历史增长挤走下方内容。 */
export function HomeWorkSections({ work, projects, onOpenSession, onOpenProject }: HomeWorkSectionsProps) {
	return (
		<>
			{work.attention.length > 0 && (
				<section className="min-w-0 rounded-xl border border-primary/25 bg-primary/5 p-4" data-testid="home-attention">
					<h2 className="mb-2 flex items-center gap-2 text-body font-semibold">
						<CircleAlert className="size-4 text-primary" />
						{t("overview.attention")}
						<span className="text-caption font-normal text-muted-foreground">{work.attention.length}</span>
					</h2>
					<div className="flex max-h-48 flex-col overflow-y-auto">
						{work.attention.map((task) => (
							<HomeTaskRow key={task.session.id} task={task} onOpen={onOpenSession} />
						))}
					</div>
				</section>
			)}
			{work.running.length > 0 && (
				<section className="min-w-0 rounded-xl border border-border/60 bg-card p-4" data-testid="home-running">
					<h2 className="mb-2 flex items-center gap-2 text-body font-semibold">
						<Activity className="size-4 text-primary" />
						{t("overview.runningTasks")}
						<span className="text-caption font-normal text-muted-foreground">{work.running.length}</span>
					</h2>
					<div className="flex max-h-48 flex-col overflow-y-auto">
						{work.running.map((task) => (
							<HomeTaskRow key={task.session.id} task={task} onOpen={onOpenSession} />
						))}
					</div>
				</section>
			)}
			<div className="grid min-w-0 gap-4 @2xl:grid-cols-2">
				<section className="min-w-0 rounded-xl border border-border/60 bg-card p-4" data-testid="home-workspaces">
					<h2 className="mb-3 flex items-center gap-2 text-body font-semibold">
						<FolderOpen className="size-4 text-muted-foreground" />
						{t("overview.recentWorkspaces")}
					</h2>
					{!work.recentWorkspaces.length && <p className="py-4 text-caption text-muted-foreground">{t("overview.noWorkspaces")}</p>}
					<div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
						{work.recentWorkspaces.map(({ project, lastSession, activeCount }) => (
							<Button key={project.id} variant="ghost" className="h-auto min-h-16 w-full min-w-0 shrink-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => onOpenProject(project.id)}>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-caption font-medium">{displayProjectDirectoryName(project)}</span>
									<span className="mt-1 block truncate text-micro text-muted-foreground" title={project.path}>
										{project.path}
									</span>
									{lastSession && <span className="mt-1 block truncate text-micro text-muted-foreground">{lastSession.title}</span>}
								</span>
								{activeCount > 0 && <span className="shrink-0 text-micro text-primary">{t("overview.workspaceActive", { count: activeCount })}</span>}
								<ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
							</Button>
						))}
					</div>
				</section>
				<section className="min-w-0 rounded-xl border border-border/60 bg-card p-4" data-testid="home-recent-sessions">
					<h2 className="mb-3 flex items-center gap-2 text-body font-semibold">
						<Clock className="size-4 text-muted-foreground" />
						{t("overview.recent")}
					</h2>
					{!work.recentSessions.length && <p className="py-4 text-caption text-muted-foreground">{t("workspace.noSessions")}</p>}
					<div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
						{work.recentSessions.map((session) => (
							<Button key={session.id} variant="ghost" className="h-auto min-h-12 w-full min-w-0 shrink-0 justify-between gap-3 px-2 py-2 text-left" onClick={() => onOpenSession(session)}>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-caption font-medium">{session.title}</span>
									<span className="mt-1 block truncate text-micro text-muted-foreground">
										{projects.find((project) => project.id === session.projectId)?.name} · {session.preview || t("workspace.history")}
									</span>
								</span>
								<time className="shrink-0 text-micro text-muted-foreground" dateTime={new Date(session.updatedAt).toISOString()}>
									{new Date(session.updatedAt).toLocaleDateString()}
								</time>
							</Button>
						))}
					</div>
				</section>
			</div>
		</>
	);
}
