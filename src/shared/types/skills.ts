// ── Pi Skills ──────────────────────────────────────────────────────────

export type PiSkillLocation = {
	id: "pi-global" | "agents-global" | "project-pi" | "project-agents";
	label: string;
	path: string;
	rootMarkdownEnabled: boolean;
};

export type PiSkillSummary = {
	id: string;
	name: string;
	description: string;
	path: string;
	dir: string;
	sourceId: PiSkillLocation["id"];
	sourceLabel: string;
	type: "directory" | "markdown";
	/** Pi 禁用模型自动调用时仍可由用户通过 /skill:name 手动调用。 */
	userOnly?: boolean;
	enabled: boolean;
	valid: boolean;
	warnings: string[];
};

export type PiSkillListResult = {
	locations: PiSkillLocation[];
	skills: PiSkillSummary[];
};

/** 技能 SKILL.md 正文读取结果（技能选择器「查看详情 / 插入全文」用）。 */
export type SkillContentResult = {
	/** 截断后的正文（超长时由主进程限制大小，避免渲染层拿全量大文件）。 */
	content: string;
};

export type CreatePiSkillInput = {
	name: string;
	description: string;
	locationId: PiSkillLocation["id"];
};
