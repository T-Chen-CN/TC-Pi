import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { projectInventoryAtom } from "./project-atoms";
import { sessionIdsByProjectAtom, sessionRuntimeByIdAtom, sessionRuntimeUiByIdAtom } from "./session-atoms";
import { countPendingAsksForSessions } from "../utils/askUi";

/** 根工作区汇总其 Worktree；待确认只能来自同一进程与同一代次。 */
export const workspaceProjectStatusAtomFamily = atomFamily((projectId: string) =>
	atom((get) => {
		const idsByProject = get(sessionIdsByProjectAtom);
		const runtimes = get(sessionRuntimeByIdAtom);
		const ui = get(sessionRuntimeUiByIdAtom);
		const projectIds = [
			projectId,
			...get(projectInventoryAtom)
				.filter((project) => project.worktreeParentId === projectId)
				.map((project) => project.id),
		];
		let pending = 0;
		let running = false;
		let live = false;
		for (const id of projectIds.flatMap((id) => idsByProject[id] ?? [])) {
			const runtime = runtimes[id];
			if (!runtime?.agentId || ["closed", "detached", "error"].includes(runtime.status)) continue;
			live = true;
			const state = ui[id];
			const count = state && state.agentId === runtime.agentId && state.runtimeGeneration === runtime.runtimeGeneration ? countPendingAsksForSessions([id], { [id]: state }) : 0;
			pending += count;
			if (count === 0 && ["starting", "running"].includes(runtime.status)) running = true;
		}
		return { pending, running, live };
	}),
);
