export type ProcessMetricKind = "pi";

export type AgentProcessMetric = {
	agentId: string;
	/** 行类型：缺省视为 pi（兼容旧快照） */
	kind?: ProcessMetricKind;

	sessionId?: string;

	sessionTitle?: string;

	pid: number;
	/** 常驻内存（字节）；系统命令采样失败时 undefined */
	memoryBytes?: number;
	/** 该进程采样失败的原因（非致命，仅展示用） */
	error?: string;
};

export type ProcessMetricsSnapshot = {
	agents: AgentProcessMetric[];
	/** 已采样内存之和（字节，失败项不计；Windows 为专用内存，其余平台 RSS） */
	totalAgentBytes: number;
	/** 快照采样时间戳（ms） */
	sampledAt: number;
};
