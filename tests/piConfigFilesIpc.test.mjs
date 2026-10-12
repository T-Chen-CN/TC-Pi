import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "tc-pi-config-ipc-"));
	mkdirSync(join(root, "prompts"));
	writeFileSync(join(root, "settings.json"), "{}");
	writeFileSync(join(root, "auth.json"), "pi-managed fixture");
	const handlers = new Map();
	const { registerFilesIpc } = loadTsCommonJs("src/main/ipc/filesIpc.ts", { stubs: { electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, app: {}, dialog: {}, shell: {} } } });
	const { FileSystemService } = loadTsCommonJs("src/main/fs/FileSystemService.ts");
	registerFilesIpc({ fileSystemService: new FileSystemService(), projectStore: { get: () => undefined }, settingsStore: { get: () => ({}) }, appLogger: { info: () => Promise.resolve(), error: () => Promise.resolve() }, getMainWindow: () => null, openExternalUrl: async () => undefined, getPiConfigDir: () => root });
	return { root, invoke: (channel, ...args) => handlers.get(channel)(null, ...args), clean: () => rmSync(root, { recursive: true, force: true }) };
}
const scope = { kind: "pi-config" };

test("IPC lists and edits current Pi configuration without a ProjectStore record", async () => {
	const { root, invoke, clean } = fixture();
	try {
		assert.equal((await invoke("files:pi-config-list")).rootPath, root);
		assert.equal(await invoke("files:read-content", join(root, "settings.json"), undefined, scope), "{}");
		await invoke("files:write-content", join(root, "settings.json"), '{"changed":true}', scope);
		assert.equal(readFileSync(join(root, "settings.json"), "utf8"), '{"changed":true}');
	} finally {
		clean();
	}
});
test("IPC rejects renderer-supplied config roots and protects credentials from copy or write", async () => {
	const { root, invoke, clean } = fixture();
	try {
		await assert.rejects(() => invoke("files:read-content", join(root, "settings.json"), undefined, { kind: "pi-config", rootPath: root }));
		await assert.rejects(() => invoke("files:write-content", join(root, "auth.json"), "replaced", scope));
		await assert.rejects(() => invoke("files:copy", [join(root, "auth.json")], join(root, "prompts"), scope));
		assert.equal(readFileSync(join(root, "auth.json"), "utf8"), "pi-managed fixture");
		assert.equal(existsSync(join(root, "prompts", "auth.json")), false);
	} finally {
		clean();
	}
});
test("IPC creates and renames config files but refuses a root rename or auth destination", async () => {
	const { root, invoke, clean } = fixture();
	try {
		const created = await invoke("files:create", root, "custom.json", "file", scope);
		assert.equal(created, join(root, "custom.json"));
		await invoke("files:rename", created, "custom-models.json", scope);
		await assert.rejects(() => invoke("files:rename", join(root, "custom-models.json"), "auth.json", scope));
		await assert.rejects(() => invoke("files:delete", root, true, scope));
		assert.equal(existsSync(join(root, "custom-models.json")), true);
	} finally {
		clean();
	}
});
