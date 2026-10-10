import type { AppSettings, AgentBackend } from "./types";

/** Features removed from this distribution; saved legacy identifiers remain readable. */
export const REMOVED_MODULE_IDS: readonly string[] = ["dsh", "acp", "imagegen", "im", "pet", "vision", "floating", "cua", "stores"];

/** Product availability is independent of the user's UI visibility preferences. */
export function isRemovedModule(id: string): boolean {
	return REMOVED_MODULE_IDS.includes(id);
}

/** Reject unsupported backends before they can write a draft or spawn a runtime. */
export function requireSupportedBackend(backend: unknown): void {
	if (backend !== undefined && backend !== "pi") throw new Error("This PiDeck distribution only supports the pi backend.");
}

/** Old default preferences may fall back to pi; existing session identities never do. */
export function effectiveProductBackend(_backend?: AgentBackend): "pi" {
	return "pi";
}

/** Project settings without mutating or deleting legacy user data. */
export function productSettings(settings: AppSettings): AppSettings {
	return { ...settings, defaultAgentBackend: "pi", acpEnabled: false, acpTools: [], petEnabled: false, floatingBallEnabled: false, cuaEnabled: false };
}
