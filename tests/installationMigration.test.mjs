import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { resolveInstallPaths } = loadTsCommonJs("src/main/storage/installPaths.ts");
const { migrateInstallationStorage } = loadTsCommonJs("src/main/storage/installationMigration.ts");
const { encodeSessionDirName } = loadTsCommonJs("src/main/projects/userDataNameMigration.ts");
const { buildSessionOriginKey } = loadTsCommonJs("src/shared/sessionIdentity.ts");
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-storage-test-"));
	const old = join(root, "old-desktop"),
		pi = join(root, "old-pi"),
		cwd = join(old, "chat-workspace");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(pi);
	writeFileSync(join(old, "settings.json"), JSON.stringify({ path: cwd, external: "E:\\project" }));
	writeFileSync(join(pi, "auth.json"), "NEVER COPY THIS");
	writeFileSync(join(pi, "trust.json"), JSON.stringify({ [cwd]: false, "E:\\project": true }));
	const encoded = encodeSessionDirName(cwd);
	mkdirSync(join(pi, "sessions", encoded), { recursive: true });
	const body = '\r\n{"type":"message","text":"old paths in messages stay unchanged"}\r\n';
	writeFileSync(join(pi, "sessions", encoded, "session.jsonl"), JSON.stringify({ type: "session", cwd }) + body);
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "installed", "app.exe"), appPath: "unused" });
	for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });
	return { root, old, pi, cwd, body, encoded, paths };
}
test("copy migration relocates only native session headers and preserves source and message bytes", () => {
	const f = fixture();
	migrateInstallationStorage(f.paths, { desktopSources: [f.old], piSource: f.pi });
	const cwd = join(f.paths.desktop, "chat-workspace");
	const target = join(f.paths.piSessions, encodeSessionDirName(cwd), "session.jsonl");
	assert.ok(existsSync(target));
	const raw = readFileSync(target, "utf8");
	assert.equal(JSON.parse(raw.split("\r\n")[0]).cwd, cwd);
	assert.ok(raw.endsWith(f.body));
	assert.equal(JSON.parse(readFileSync(join(f.pi, "sessions", f.encoded, "session.jsonl"), "utf8").split("\r\n")[0]).cwd, f.cwd);
	assert.equal(existsSync(join(f.paths.piAgent, "auth.json")), false);
	assert.equal(JSON.parse(readFileSync(join(f.paths.desktop, "settings.json"))).external, "E:\\project");
	assert.equal(JSON.parse(readFileSync(join(f.paths.piAgent, "trust.json")))[cwd], false);
	assert.equal(JSON.parse(readFileSync(join(f.paths.piAgent, "trust.json")))["E:\\project"], true);
});
test("repeated startup preserves destination settings", () => {
	const f = fixture();
	const input = { desktopSources: [f.old], piSource: f.pi };
	migrateInstallationStorage(f.paths, input);
	writeFileSync(join(f.paths.desktop, "settings.json"), '{"new":true}');
	migrateInstallationStorage(f.paths, input);
	assert.deepEqual(JSON.parse(readFileSync(join(f.paths.desktop, "settings.json"))), { new: true });
});

test("catalog identities stay stable while file paths, origin keys and fork parent references relocate", () => {
	const f = fixture();
	const filePath = join(f.pi, "sessions", f.encoded, "session.jsonl");
	writeFileSync(join(f.old, "session-catalog.json"), JSON.stringify([{ id: filePath, filePath, originKey: buildSessionOriginKey({ source: "pi", environment: "native", filePath }) }]));
	writeFileSync(join(f.pi, "sessions", f.encoded, "fork.jsonl"), JSON.stringify({ type: "session", cwd: f.cwd, parentSession: filePath }) + f.body);
	migrateInstallationStorage(f.paths, { desktopSources: [f.old], piSource: f.pi });
	const target = join(f.paths.piSessions, encodeSessionDirName(join(f.paths.desktop, "chat-workspace")), "session.jsonl");
	const entry = JSON.parse(readFileSync(join(f.paths.desktop, "session-catalog.json")))[0];
	assert.equal(entry.id, filePath);
	assert.equal(entry.filePath, target);
	assert.equal(entry.originKey, buildSessionOriginKey({ source: "pi", environment: "native", filePath: target }));
	const fork = JSON.parse(readFileSync(join(target, "..", "fork.jsonl"), "utf8").split("\r\n")[0]);
	assert.equal(fork.parentSession, target);
});
test("moving the whole installation repairs desktop references and encoded session directories", () => {
	const f = fixture();
	migrateInstallationStorage(f.paths, { desktopSources: [f.old], piSource: f.pi });
	const moved = join(f.root, "moved");
	renameSync(f.paths.root, moved);
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(moved, "app.exe"), appPath: "unused" });
	migrateInstallationStorage(paths, { desktopSources: [f.old], piSource: f.pi });
	const cwd = join(paths.desktop, "chat-workspace");
	assert.equal(JSON.parse(readFileSync(join(paths.desktop, "settings.json"))).path, cwd);
	assert.ok(existsSync(join(paths.piSessions, encodeSessionDirName(cwd), "session.jsonl")));
});
