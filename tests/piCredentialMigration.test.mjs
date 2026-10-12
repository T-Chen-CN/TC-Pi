import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migratePiCredentials } from "../resources/pi-auth-migration.mjs";

test("Pi store migration preserves existing credentials and does not restore credentials after logout", async () => {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-auth-test-"));
	const source = join(root, "old"),
		target = join(root, "new");
	mkdirSync(source);
	mkdirSync(target);
	writeFileSync(join(source, "auth.json"), "opaque to host");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = target;
	try {
		const values = new Map([["existing", { key: "new" }]]);
		let reads = 0;
		const runtime = { refresh: async (input) => assert.equal(input.allowNetwork, false) };
		const loadStorage = async () => ({
			create: (path) =>
				path.startsWith(source)
					? {
							list: async () => [{ providerId: "existing" }, { providerId: "missing" }],
							read: async () => {
								reads++;
								return { key: "migrated" };
							},
						}
					: { read: async (id) => values.get(id), modify: async (id, fn) => values.set(id, await fn(values.get(id))) },
		});
		await migratePiCredentials(runtime, source, loadStorage);
		assert.deepEqual(values.get("existing"), { key: "new" });
		assert.deepEqual(values.get("missing"), { key: "migrated" });
		assert.equal(reads, 1);
		values.delete("missing");
		await migratePiCredentials(runtime, source, loadStorage);
		assert.equal(values.has("missing"), false);
		assert.equal(reads, 1);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("failed credential read-back never publishes verified completion evidence", async () => {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-auth-verify-")),
		source = join(root, "old"),
		target = join(root, "new");
	mkdirSync(source);
	mkdirSync(target);
	writeFileSync(join(source, "auth.json"), "opaque");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = target;
	try {
		const loadStorage = async () => ({ create: (path) => (path.startsWith(source) ? { list: async () => [{ providerId: "test" }], read: async () => ({ key: "secret-test-only" }) } : { read: async () => undefined, modify: async () => {} }) });
		await assert.rejects(migratePiCredentials({ refresh: async () => {} }, source, loadStorage), /read-back verification failed/);
		assert.equal(existsSync(join(target, "credentials-migrated.json")), false);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
test("v0.9.2 evidence upgrades without restoring a previously logged-out provider", async () => {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-auth-upgrade-")),
		source = join(root, "old"),
		target = join(root, "new");
	mkdirSync(source);
	mkdirSync(target);
	writeFileSync(join(source, "auth.json"), "opaque");
	writeFileSync(join(target, "credentials-migrated.json"), '{"version":1}');
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = target;
	try {
		let writes = 0;
		const loadStorage = async () => ({
			create: (path) =>
				path.startsWith(source)
					? {
							list: async () => [{ providerId: "logged-out" }],
							read: async () => {
								throw Error("must not re-import");
							},
						}
					: { read: async () => undefined, modify: async () => writes++ },
		});
		await migratePiCredentials({ refresh: async () => {} }, source, loadStorage);
		assert.equal(writes, 0);
		const evidence = JSON.parse(readFileSync(join(target, "credentials-migrated.json")));
		assert.equal(evidence.version, 2);
		assert.equal(evidence.verified, true);
		assert.equal(evidence.skipped, 1);
		assert.equal(JSON.stringify(evidence).includes("logged-out"), false);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
