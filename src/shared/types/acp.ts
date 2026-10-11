/** Saved ACP tool configuration, retained solely to read older settings. */
export type AcpToolConfig = {
	/** 稳定 id（randomUUID）；会话记录 acpToolId 引用它，删除工具后旧会话只读降级。 */
	id: string;
	/** 显示名（如 "Gemini CLI"）；用户可改。 */
	name: string;
	/** 可执行命令（如 "gemini"、"npx"）；Windows .cmd 垫片由 PiLocator 启动通道还原。 */
	command: string;
	/** 启动参数（如 ["--acp"]）。 */
	args: string[];
	/** 追加注入子进程的环境变量（如 codex-acp 需要 ZAI_CODING_KEY）；键名限 [A-Za-z0-9_]，值不落日志。 */
	env?: Record<string, string>;
	/** 禁用后不出现在新建会话选择中；已建会话不受影响。 */
	enabled: boolean;
};

export type AcpToolValidation = {
	ok: boolean;
	/** 拒绝时的 i18n key（渲染层本地化）。 */
	reasonKey?: "acp.toolNameRequired" | "acp.toolCommandRequired" | "acp.toolDuplicateName" | "acp.toolInvalidCharacters";
};
