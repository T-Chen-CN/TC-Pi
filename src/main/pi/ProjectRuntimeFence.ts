/** 工作区关闭后拒绝后台重建；重新进入也不放行上次退出前的在途创建。 */
export class ProjectRuntimeFence {
	private readonly generations = new Map<string, number>();
	private readonly paused = new Set<string>();

	/** 返回当前创建代次；已经离开的工作区不能启动进程。 */
	capture(projectId: string): number {
		if (this.paused.has(projectId)) throw new Error("Workspace Agent processes are paused");
		return this.generations.get(projectId) ?? 0;
	}
	/** 检查异步准备期间有没有发生工作区退出。 */
	valid(projectId: string, generation: number): boolean {
		return !this.paused.has(projectId) && (this.generations.get(projectId) ?? 0) === generation;
	}
	/** 暂停后，所有旧的创建代次永久失效。 */
	pause(projectId: string): void {
		this.paused.add(projectId);
		this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1);
	}
	/** 用户重新进入工作区后允许新的创建。 */
	resume(projectId: string): void {
		this.paused.delete(projectId);
	}
	/** 后台预热使用只读门禁，不需要通过抛错回退。 */
	isPaused(projectId: string): boolean {
		return this.paused.has(projectId);
	}
}
