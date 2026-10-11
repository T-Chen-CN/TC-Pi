/** 生命周期状态：pending（未开始）/ in_progress（正在推进）/ completed（已完成）。 */
export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoItem = {
	content: string;
	status: TodoStatus;
};
