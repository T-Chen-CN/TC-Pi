import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
