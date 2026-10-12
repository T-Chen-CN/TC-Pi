import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { resolveInstallPaths } = loadTsCommonJs("src/main/storage/installPaths.ts");
const { migrateInstallationStorage } = loadTsCommonJs("src/main/storage/installationMigration.ts");
const { finishInstallationMigration } = loadTsCommonJs("src/main/storage/migrationCompletion.ts");

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-cleanup-test-"));
	const old = join(root, "old-desktop"),
		pi = join(root, "shared-pi");
	mkdirSync(join(old, "drafts"), { recursive: true });
	mkdirSync(pi);
	writeFileSync(join(old, "settings.json"), JSON.stringify({ path: join(old, "drafts") }));
	writeFileSync(join(old, "drafts", "input.md"), "keep draft text");
	writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {} }));
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "installed", "app.exe"), appPath: "unused" });
	for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
	const input = { desktopSources: [old], piSource: pi };
	migrateInstallationStorage(paths, input);
	return { root, old, pi, paths, input };
}
const complete = (f, probeRuntime = async () => ({ ok: true })) => finishInstallationMigration(f.paths, f.input, probeRuntime);

test("verified migration deletes only application-owned legacy copies and retains shared Pi", async () => {
	const f = fixture();
	const report = await complete(f);
	assert.equal(existsSync(join(f.old, "settings.json")), false);
	assert.equal(existsSync(join(f.old, "drafts")), false);
	assert.equal(existsSync(join(f.pi, "models.json")), true);
	assert.equal(readFileSync(join(f.paths.desktop, "drafts", "input.md"), "utf8"), "keep draft text");
	assert.equal(report.verified, true);
	assert.equal(report.items.find((item) => item.source === join(f.pi, "models.json")).reason, "shared");
	assert.ok(report.items.some((item) => item.cleaned > 0));
});
test("destination corruption prevents every automatic deletion", async () => {
	const f = fixture();
	writeFileSync(join(f.paths.desktop, "drafts", "input.md"), "corrupted");
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	assert.equal(existsSync(join(f.old, "drafts", "input.md")), true);
});
test("a changed source or newly added file is retained without deleting its neighbours", async () => {
	const f = fixture();
	writeFileSync(join(f.old, "drafts", "later.md"), "not migrated");
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	assert.equal(existsSync(join(f.old, "drafts", "later.md")), true);
});
test("runtime failure retains data and a later successful probe can finish cleanup", async () => {
	const f = fixture();
	const first = await complete(f, async () => ({ ok: false, reason: "runtime" }));
	assert.equal(first.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	const second = await complete(f);
	assert.equal(second.verified, true);
	assert.equal(existsSync(join(f.old, "settings.json")), false);
});
test("source paths outside the trusted legacy roots cannot authorize deletion", async () => {
	const f = fixture();
	const report = await finishInstallationMigration(f.paths, { desktopSources: [], piSource: f.pi }, async () => ({ ok: true }));
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
test("a replaced destination directory link cannot authorize cleanup", async () => {
	const f = fixture();
	const external = join(f.root, "external");
	mkdirSync(external);
	writeFileSync(join(external, "models.json"), '{"providers":{}}');
	const linked = join(f.paths.piAgent, "linked");
	symlinkSync(external, linked, process.platform === "win32" ? "junction" : "dir");
	// Tampering with the journal must not let a matching external file pass validation.
	const file = join(f.paths.data, "migration-audit.json");
	const audit = JSON.parse(readFileSync(file, "utf8"));
	const group = audit.groups.find((group) => group.source === join(f.pi, "models.json"));
	group.destination = join(linked, "models.json");
	writeFileSync(file, JSON.stringify(audit));
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
test("already migrated v0.9.2 installations gain verification without overwriting edits", async () => {
	const f = fixture();
	const { unlinkSync } = await import("node:fs");
	unlinkSync(join(f.paths.data, "migration-audit.json"));
	writeFileSync(join(f.paths.desktop, "settings.json"), '{"new":true}');
	migrateInstallationStorage(f.paths, f.input);
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.deepEqual(JSON.parse(readFileSync(join(f.paths.desktop, "settings.json"))), { new: true });
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});

test("source edits during the runtime probe are caught before any deletion", async () => {
	const f = fixture();
	const report = await complete(f, async () => {
		writeFileSync(join(f.old, "drafts", "input.md"), "new source edit");
		return { ok: true };
	});
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
test("a running old desktop prevents cleanup", async () => {
	const f = fixture();
	mkdirSync(join(f.old, "instance-locks"));
	writeFileSync(join(f.old, "instance-locks", "old.lock"), JSON.stringify({ pid: process.pid }));
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.equal(report.items[0].reason, "in-use");
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
test("old credentials require Pi SDK read-back evidence and stay shared after verification", async () => {
	const f = fixture();
	writeFileSync(join(f.pi, "auth.json"), "opaque to host");
	let report = await complete(f);
	assert.equal(report.credentials, "pending");
	assert.equal(existsSync(join(f.old, "settings.json")), true);
	writeFileSync(join(f.paths.piAgent, "credentials-migrated.json"), '{"version":2,"verified":true}');
	report = await complete(f);
	assert.equal(report.credentials, "verified");
	assert.equal(existsSync(join(f.old, "settings.json")), false);
	assert.equal(readFileSync(join(f.pi, "auth.json"), "utf8"), "opaque to host");
});
test("an interrupted cleanup resumes from verified destination hashes", async () => {
	const f = fixture();
	const file = join(f.paths.data, "migration-audit.json");
	const audit = JSON.parse(readFileSync(file, "utf8"));
	const { digestFile } = loadTsCommonJs("src/main/storage/migrationEvidence.ts");
	const group = audit.groups.find((group) => group.source === join(f.old, "drafts"));
	group.cleanupStarted = true;
	for (const entry of group.files.filter((entry) => entry.kind === "file")) entry.targetDigest = digestFile(join(group.destination, entry.relative)).digest;
	writeFileSync(file, JSON.stringify(audit));
	const { unlinkSync } = await import("node:fs");
	unlinkSync(join(f.old, "drafts", "input.md"));
	const report = await complete(f);
	assert.equal(report.verified, true);
	assert.equal(existsSync(join(f.old, "drafts")), false);
	assert.equal(report.items.find((item) => item.source === group.source).cleaned, 1);
});
test("unselected data is retained and reported without being called migrated", async () => {
	const f = fixture();
	writeFileSync(join(f.old, "private-notes.txt"), "not selected for migration");
	const report = await complete(f);
	assert.equal(existsSync(join(f.old, "private-notes.txt")), true);
	assert.ok(report.unknown.includes(join(f.old, "private-notes.txt")));
});
test("no migration work means no completion notice is requested", async () => {
	const f = fixture();
	assert.equal(
		await finishInstallationMigration(f.paths, { ...f.input, skipMigration: true }, async () => {
			throw Error("must not probe");
		}),
		undefined,
	);
});

test("native history bytes, catalog paths and fork references pass validation including v0.9.2 retrofit", async () => {
	for (const retrofit of [false, true]) {
		const f = fixture();
		const { unlinkSync } = await import("node:fs");
		unlinkSync(join(f.paths.data, "storage-layout.json"));
		unlinkSync(join(f.paths.data, "migration-audit.json"));
		const { encodeSessionDirName } = loadTsCommonJs("src/main/projects/userDataNameMigration.ts");
		const cwd = join(f.old, "drafts"),
			folder = join(f.pi, "sessions", encodeSessionDirName(cwd));
		mkdirSync(folder, { recursive: true });
		const file = join(folder, "parent.jsonl"),
			body = '\r\n{"type":"message","id":"message-stable","content":"你好"}\r\n';
		writeFileSync(file, JSON.stringify({ type: "session", id: "stable", cwd }) + body);
		writeFileSync(join(folder, "fork.jsonl"), JSON.stringify({ type: "session", id: "fork", cwd, parentSession: file }) + body);
		writeFileSync(join(f.old, "session-catalog.json"), JSON.stringify([{ id: "stable", filePath: file }]));
		migrateInstallationStorage(f.paths, f.input);
		if (retrofit) {
			unlinkSync(join(f.paths.data, "migration-audit.json"));
			migrateInstallationStorage(f.paths, f.input);
		}
		const report = await complete(f);
		assert.equal(report.verified, true, JSON.stringify(report));
		const moved = join(f.paths.piSessions, encodeSessionDirName(join(f.paths.desktop, "drafts")), "parent.jsonl");
		assert.ok(readFileSync(moved, "utf8").endsWith(body));
		assert.equal(existsSync(file), true);
		assert.equal(existsSync(join(f.old, "session-catalog.json")), false);
	}
});
test("malformed native history prevents cleanup even if both copies have the same bad bytes", async () => {
	const f = fixture();
	const { unlinkSync } = await import("node:fs");
	unlinkSync(join(f.paths.data, "storage-layout.json"));
	unlinkSync(join(f.paths.data, "migration-audit.json"));
	mkdirSync(join(f.pi, "sessions", "custom"), { recursive: true });
	writeFileSync(join(f.pi, "sessions", "custom", "bad.jsonl"), JSON.stringify({ type: "session", cwd: f.old }) + "\nNOT JSON\n");
	migrateInstallationStorage(f.paths, f.input);
	const report = await complete(f);
	assert.equal(report.verified, false);
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
test("moving the installation repairs audit targets and still permits safe cleanup", async () => {
	const f = fixture();
	const { renameSync } = await import("node:fs");
	const root = join(f.root, "moved with spaces");
	renameSync(f.paths.root, root);
	const paths = resolveInstallPaths({ isPackaged: true, exePath: join(root, "app.exe"), appPath: "unused" });
	migrateInstallationStorage(paths, f.input);
	const report = await finishInstallationMigration(paths, f.input, async () => ({ ok: true }));
	assert.equal(report.verified, true);
	assert.equal(existsSync(join(f.old, "settings.json")), false);
});
test("an old desktop starting during the runtime probe is detected before deletion", async () => {
	const f = fixture();
	const report = await complete(f, async () => {
		mkdirSync(join(f.old, "instance-locks"));
		writeFileSync(join(f.old, "instance-locks", "started.lock"), JSON.stringify({ pid: process.pid }));
		return { ok: true };
	});
	assert.equal(report.verified, false);
	assert.equal(report.items[0].reason, "in-use");
	assert.equal(existsSync(join(f.old, "settings.json")), true);
});
