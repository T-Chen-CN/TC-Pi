import type { ReactNode } from "react";

export type RuntimeHandle = {
	agentId: string;
	runtimeGeneration: number;
};

export function sameRuntimeHandle(left: RuntimeHandle | undefined, right: RuntimeHandle | undefined): boolean {
	return left?.agentId === right?.agentId && left?.runtimeGeneration === right?.runtimeGeneration;
}

export function isCoherentComposerRuntimeUi(runtime: RuntimeHandle | undefined, runtimeUi: { agentId: string; runtimeGeneration: number } | undefined): boolean {
	return Boolean(runtime && runtimeUi && runtimeUi.agentId === runtime.agentId && runtimeUi.runtimeGeneration === runtime.runtimeGeneration);
}
