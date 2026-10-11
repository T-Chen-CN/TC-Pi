export type ToolActivityCategory = "read" | "readImage" | "search" | "write" | "edit" | "commands" | "code" | "webSearch" | "webFetch" | "subagents" | "plan" | "questions" | "tools";

/** 某类别在本组内出现的次数（按工具调用计）。 */
export interface ActivityCount {
	kind: ToolActivityCategory;
	count: number;
}

/** 精确匹配集合：命中即该类，避免 `includes` 式误伤（如 `web_search` 不该落进 search）。 */
const EXACT_CATEGORY: Readonly<Record<string, ToolActivityCategory>> = {
	read_image: "readImage",
	read: "read",
	run_code: "code",
	web_search: "webSearch",
	grep: "search",
	glob: "search",
	search: "search",
	find: "search",
	ls: "search",
	list: "search",
	write: "write",
	create: "write",
	edit: "edit",
	multi_edit: "edit",
	apply_patch: "edit",
	patch: "edit",
	bash: "commands",
	shell: "commands",
	pwsh: "commands",
	powershell: "commands",
	exec_command: "commands",
	write_stdin: "commands",
	run: "commands",
	web_fetch: "webFetch",
	fetch: "webFetch",
	fetch_content: "webFetch",
	url: "webFetch",
	http: "webFetch",
	subagent: "subagents",
	agent: "subagents",
	task: "subagents",
	todo: "plan",
	todo_write: "plan",
	todolist: "plan",
	create_goal: "plan",
	update_goal: "plan",
	get_goal: "plan",
	plan: "plan",
	ask_question: "questions",
	ask_user_question: "questions",
	request_user_input: "questions",
};

/** 前缀匹配：顺序即优先级，先命中先归类。 */
const PREFIX_CATEGORY: ReadonlyArray<readonly [string, ToolActivityCategory]> = [
	["terminal_", "commands"],
	["subagent_", "subagents"],
];

export function toolActivityCategory(toolName: string): ToolActivityCategory {
	const key = toolName.trim().toLowerCase();
	if (!key) return "tools";
	if (key.endsWith("_inspect")) return "search";
	const exact = EXACT_CATEGORY[key];
	if (exact) return exact;
	for (const [prefix, category] of PREFIX_CATEGORY) {
		if (key.startsWith(prefix)) return category;
	}
	return "tools";
}

/** 一组工具名 → 类别计数（同一工具名多次调用按次计数；名字为空的不计）。 */
export function activityCountsFromToolNames(toolNames: readonly string[]): ActivityCount[] {
	const tally = new Map<ToolActivityCategory, number>();
	for (const name of toolNames) {
		if (!name.trim()) continue;
		const kind = toolActivityCategory(name);
		tally.set(kind, (tally.get(kind) ?? 0) + 1);
	}
	return rankActivityCounts([...tally].map(([kind, count]) => ({ kind, count })));
}

/**
 * 类别计数排序：次数降序；同次数保留传入（即成员出现）顺序。
 * 组头只取前几个类别，所以顺序必须稳定，否则流式增量时组头文字会来回跳。
 */
export function rankActivityCounts(counts: readonly ActivityCount[]): ActivityCount[] {
	return counts
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => right.entry.count - left.entry.count || left.index - right.index)
		.map((wrapped) => wrapped.entry);
}

/** 组头展示的类别（按排序取前 max 个）。 */
export function topActivityKinds(counts: readonly ActivityCount[], max = 3): ToolActivityCategory[] {
	return counts
		.filter((entry) => entry.count > 0)
		.slice(0, max)
		.map((entry) => entry.kind);
}

/**
 * 类别文案的 i18n key（`phase` 区分进行时与已完成）。
 *
 * 返回**模板字面量联合**而不是 `string`：13 类 × 2 态 = 26 个字面量，每个都真实存在于
 * locale 字典里，因此它本身就是 `TranslationKey` 的子集，调用方可以直接 `t(...)`
 * 而不需要 `as` 断言（AGENTS.md 禁止用 `as` 绕过类型错误）。
 */
export type ActivityCategoryLabelKey = `timeline.processGroup.${"running" | "done"}.${ToolActivityCategory}`;

export function activityCategoryLabelKey(kind: ToolActivityCategory, phase: "running" | "done"): ActivityCategoryLabelKey {
	return `timeline.processGroup.${phase}.${kind}`;
}
