import type { AppSettings, AgentBackend } from "./types";

/** Features removed from this distribution; removed identifiers are rejected at public boundaries. */
export const REMOVED_MODULE_IDS: readonly string[] = ["dsh", "acp", "imagegen", "im", "pet", "vision", "floating", "cua", "stores"];

/** Product availability is independent of the user's UI visibility preferences. */
export function isRemovedModule(id: string): boolean {
	return REMOVED_MODULE_IDS.includes(id);
}

/** Reject unsupported backends before they can write a draft or spawn a runtime. */
export function isSupportedBackend(backend: unknown): boolean {
	return backend === undefined || backend === "pi";
}

export function requireSupportedBackend(backend: unknown): void {
	if (!isSupportedBackend(backend)) throw new Error("This TC-Pi distribution only supports the pi backend.");
}

/** Historic runtime flags are readable metadata, never a way to restart removed chat modes. */
export function requireSupportedSessionRuntime(input: { backend?: unknown; noSession?: unknown }): void {
	requireSupportedBackend(input.backend);
	if (input.noSession === true) throw new Error("Anonymous chats are not supported in this TC-Pi distribution.");
}

/** Old default preferences may fall back to pi; existing session identities never do. */
export function effectiveProductBackend(_backend?: AgentBackend): "pi" {
	return "pi";
}

/** Drop settings for removed capabilities when reading or accepting a patch. */
export function stripRemovedSettings<T extends object>(settings: T): T {
	const result = { ...settings };
	for (const key of Object.keys(result)) {
		if (/^(dsh|acp|pet|feishu|im[A-Z]|vision|miniOverlay|floatingBall|cua|imageGen|promptStore|skillStore|skillHub|xue|yao|announcement|feedback)/.test(key) || key === "sessionSortMode") Reflect.deleteProperty(result, key);
	}
	return result;
}

/** Expose only settings that have a current product capability. */
export function productSettings(settings: AppSettings): AppSettings {
	return { ...stripRemovedSettings(settings), defaultAgentBackend: "pi" };
}
