// ── pi Prompt Templates ─────────────────────────────────────────────────

/** pi Prompt Template，对应 ~/.pi/agent/prompts/<name>.md */
export type PiPromptTemplateSummary = {
	name: string;
	path: string;
	description: string;
	content: string;
	userCreated: boolean;
	/** 模板范围：global (~/.pi/agent/prompts/) 或 project (.pi/prompts/) */
	scope?: "global" | "project";
	/** 是否启用（未在 PiDeck settings 的 disabledPrompts 列表中）；缺省视为启用 */
	enabled?: boolean;
};

export type PiPromptTemplateListResult = {
	templates: PiPromptTemplateSummary[];
	globalDir: string;
};

export type CreatePiPromptTemplateInput = {
	name: string;
	description: string;
};
