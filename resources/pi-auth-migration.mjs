import { dirname, join, resolve } from "node:path";
import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readFileSync, lstatSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

/** Copy missing credentials using Pi stores only; never serialize credentials into host protocol or logs. */
export async function migratePiCredentials(runtime, legacyAgentDir = process.env.TC_PI_LEGACY_AGENT_DIR, loadStorage = loadPiAuthStorage) {
	try { return await migrateCredentials(runtime, legacyAgentDir, loadStorage); }
	catch { throw new Error("Pi credential migration read-back verification failed"); }
}

/** Keep SDK parse errors inside the helper: their text may include fragments of an authentication file. */
async function migrateCredentials(runtime, legacyAgentDir, loadStorage) {
	if (!legacyAgentDir || !process.env.PI_CODING_AGENT_DIR || resolve(legacyAgentDir) === resolve(process.env.PI_CODING_AGENT_DIR)) return;
	const marker = join(process.env.PI_CODING_AGENT_DIR, "credentials-migrated.json");
	if (!existsSync(join(legacyAgentDir, "auth.json"))) return;
	for (const path of [legacyAgentDir, process.env.PI_CODING_AGENT_DIR, join(legacyAgentDir, "auth.json"), join(process.env.PI_CODING_AGENT_DIR, "auth.json"), marker]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Pi credential migration path is redirected");
	for (const file of [join(legacyAgentDir, "auth.json"), join(process.env.PI_CODING_AGENT_DIR, "auth.json")]) if (existsSync(file) && lstatSync(file).size > 8 * 1024 * 1024) throw new Error("Pi credential migration size limit exceeded");
	if (existsSync(marker) && lstatSync(marker).size > 4096) throw new Error("Invalid credential migration evidence");
	const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : undefined;
	if (previous?.version === 2 && previous.verified) return;
	const AuthStorage = await loadStorage();
	const source = AuthStorage.create(join(legacyAgentDir, "auth.json"));
	const target = AuthStorage.create(join(process.env.PI_CODING_AGENT_DIR, "auth.json"));
	let copied = 0, retained = 0, skipped = 0, verified = true;
	for (const metadata of await source.list()) {
		if (await target.read(metadata.providerId)) { retained++; continue; }
		// A prior completion marker protects logout semantics, even when upgrading old evidence.
		if (previous) { retained++; skipped++; continue; }
		const credential = await source.read(metadata.providerId);
		if (credential) {
			await target.modify(metadata.providerId, async (existing) => existing ?? credential);
			if (!isDeepStrictEqual(credential, await target.read(metadata.providerId))) throw new Error("Pi credential migration read-back verification failed");
			copied++;
		} else { retained++; verified = false; }
	}
	await runtime.refresh({ allowNetwork: false });
	// Completion is persisted by the Pi host: logging out later must not resurrect old credentials.
	const temporary = `${marker}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify({ version: 2, verified, copied, retained, skipped }), { flag: "wx" });
		renameSync(temporary, marker);
	} finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Authentication-only SDK storage access; avoid ModelRuntime's private credential field. */
async function loadPiAuthStorage() {
	const entry = process.env.PIDECK_PI_SDK_ENTRY;
	if (!entry) throw new Error("Pi authentication storage entry is unavailable");
	const module = await import(pathToFileURL(join(dirname(entry), "core", "auth-storage.js")).href);
	if (typeof module.AuthStorage?.create !== "function") throw new Error("Pi authentication storage API is unavailable");
	return module.AuthStorage;
}
