import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

test("native image removal hashes match the main process snapshot guard", async () => {
	const sandbox = createTsSandbox({ globals: { crypto: webcrypto, TextEncoder } });
	const { imageContentHash } = sandbox("src/renderer/src/utils/imageContentHash.ts");
	for (const data of ["QUJD", "", "中文"]) assert.equal(await imageContentHash(data), createHash("sha256").update(data).digest("hex"));
});

test("catalog loads current Pi sessions and drops retired backend or anonymous records", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pideck-current-catalog-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, "catalog.json");
	const record = { id: "pi", projectId: "project", title: "Current", source: "pi", environment: "native", status: "active", createdAt: 1, updatedAt: 1 };
	const sessions = [record, ...["dsh", "acp", "imagegen"].map((backend) => ({ ...record, id: backend, backend })), { ...record, id: "anonymous", noSession: true }];
	await writeFile(file, JSON.stringify({ version: 1, sessions }));
	const { SessionCatalog } = loadTsCommonJs("src/main/sessions/SessionCatalog.ts", { stubs: { "../logging/sharedLogger": { getAppLogger: () => null } } });
	const catalog = new SessionCatalog(file);
	await catalog.load();
	assert.deepEqual(
		[...catalog.listEntries()].map((entry) => entry.id),
		["pi"],
	);
	await assert.rejects(catalog.createDraft({ projectId: "project", title: "Old", environment: "native", backend: "dsh" }), /only supports the pi backend/);
	await assert.rejects(catalog.update("pi", { backend: "acp" }), /only supports the pi backend/);
	assert.equal(catalog.get("pi").title, "Current");
});
