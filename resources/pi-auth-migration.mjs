import { dirname, join, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Copy missing credentials using Pi stores only; never serialize credentials into host protocol or logs. */
export async function migratePiCredentials(runtime, legacyAgentDir = process.env.TC_PI_LEGACY_AGENT_DIR, loadStorage = loadPiAuthStorage) {
	if (!legacyAgentDir || !process.env.PI_CODING_AGENT_DIR || resolve(legacyAgentDir) === resolve(process.env.PI_CODING_AGENT_DIR)) return;
	const marker = join(process.env.PI_CODING_AGENT_DIR, "credentials-migrated.json");
	if (existsSync(marker) || !existsSync(join(legacyAgentDir, "auth.json"))) return;
	const AuthStorage = await loadStorage();
	const source = AuthStorage.create(join(legacyAgentDir, "auth.json"));
	const target = AuthStorage.create(join(process.env.PI_CODING_AGENT_DIR, "auth.json"));
	for (const metadata of await source.list()) {
		if (await target.read(metadata.providerId)) continue;
		const credential = await source.read(metadata.providerId);
		if (credential) await target.modify(metadata.providerId, async (existing) => existing ?? credential);
	}
	await runtime.refresh({ allowNetwork: false });
	// Completion is persisted by the Pi host: logging out later must not resurrect old credentials.
	try { writeFileSync(marker, JSON.stringify({ version: 1 }), { flag: "wx" }); }
	catch (error) { if (error?.code !== "EEXIST") throw error; }
}

/** Authentication-only SDK storage access; avoid ModelRuntime's private credential field. */
async function loadPiAuthStorage() {
	const entry = process.env.PIDECK_PI_SDK_ENTRY;
	if (!entry) throw new Error("Pi authentication storage entry is unavailable");
	const module = await import(pathToFileURL(join(dirname(entry), "core", "auth-storage.js")).href);
	if (typeof module.AuthStorage?.create !== "function") throw new Error("Pi authentication storage API is unavailable");
	return module.AuthStorage;
}
