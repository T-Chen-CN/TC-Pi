import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { PiConfigFilesService } = loadTsCommonJs("src/main/files/PiConfigFilesService.ts");
const { FileSystemService } = loadTsCommonJs("src/main/fs/FileSystemService.ts");

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-config-tree-"));
	for (const dir of ["prompts", "skills", "agents", "sessions", "install"]) mkdirSync(join(root, dir));
	for (const [name, value] of [
		["settings.json", "{}"],
		["models-store.json", "{}"],
		["AGENTS.md", "rules"],
		["auth.json", "credentials"],
		["run-history.jsonl", "history"],
		["prompts/sample.md", "prompt"],
		["sessions/sample.json", "history"],
	])
		writeFileSync(join(root, name), value);
	return { root, service: new PiConfigFilesService(() => root, new FileSystemService()), clean: () => rmSync(root, { recursive: true, force: true }) };
}

test("global config tree lists settings and resources without sessions or credentials", async () => {
	const { root, service, clean } = fixture();
	try {
		const result = await service.list();
		assert.equal(result.rootPath, root);
		assert.deepEqual(Array.from(result.files, (entry) => entry.name).sort(), ["AGENTS.md", "agents", "models-store.json", "prompts", "settings.json", "skills"].sort());
		assert.equal((await service.list(join(root, "prompts"))).files[0].name, "sample.md");
	} finally {
		clean();
	}
});

test("global config file access rejects traversal, history and pi-managed credentials", async () => {
	const { root, service, clean } = fixture();
	try {
		const boundary = await service.boundary();
		assert.equal(await service.readPath(join(root, "settings.json"), boundary), join(root, "settings.json"));
		for (const path of [join(root, "..", "outside.json"), join(root, "auth.json"), join(root, "sessions", "sample.json")]) await assert.rejects(() => service.readPath(path, boundary));
		await assert.rejects(() => service.writePath(join(root, "auth.json")));
		await assert.rejects(() => service.writePath(root, true));
	} finally {
		clean();
	}
});

test("global config search cannot scan excluded runtime folders", async () => {
	const { root, service, clean } = fixture();
	try {
		const result = await service.search("sample");
		assert.equal(result.length, 1);
		assert.equal(result[0].path, join(root, "prompts", "sample.md"));
	} finally {
		clean();
	}
});

test("global config listing never probes excluded runtime directories", async () => {
	const { root, clean } = fixture();
	const scanned = [];
	const { FileSystemService: FilteredFileSystem } = loadTsCommonJs("src/main/fs/FileSystemService.ts", {
		stubs: {
			"node:fs/promises": {
				...fsPromises,
				readdir: async (path, options) => {
					scanned.push(path);
					return fsPromises.readdir(path, options);
				},
			},
		},
	});
	try {
		await new PiConfigFilesService(() => root, new FilteredFileSystem()).list();
		assert.ok(!scanned.includes(join(root, "sessions")));
		assert.ok(!scanned.includes(join(root, "install")));
		assert.ok(scanned.includes(join(root, "prompts")));
	} finally {
		clean();
	}
});

test("a linked config root is usable but resource links cannot grant access to history", async () => {
	const { root, clean } = fixture();
	const aliasParent = mkdtempSync(join(tmpdir(), "tc-pi-config-alias-"));
	const alias = join(aliasParent, "agent");
	try {
		symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
		symlinkSync(join(root, "sessions"), join(root, "extensions"), process.platform === "win32" ? "junction" : "dir");
		const service = new PiConfigFilesService(() => alias, new FileSystemService());
		const listing = await service.list();
		assert.equal(listing.rootPath, root);
		assert.equal(await service.readPath(join(root, "settings.json")), join(root, "settings.json"));
		assert.equal(await service.writePath(join(alias, "new-settings.json")), join(root, "new-settings.json"));
		await assert.rejects(() => service.readPath(join(alias, "extensions", "sample.json")));
		await assert.rejects(() => service.writePath(join(alias, "extensions", "new.json")));
	} finally {
		rmSync(aliasParent, { recursive: true, force: true });
		clean();
	}
});
