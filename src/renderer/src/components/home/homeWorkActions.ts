type HomeSessionActions = {
	addWorkspace: () => Promise<string | undefined>;
	createDraft: (projectId: string) => Promise<void>;
};

/** 有工作区直接新建；空首页先选目录，取消目录选择时不创建任何会话。 */
export async function createHomeSession(actions: HomeSessionActions, projectId?: string): Promise<void> {
	const target = projectId ?? (await actions.addWorkspace());
	if (target) await actions.createDraft(target);
}
