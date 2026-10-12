import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { usesPiConfigFiles, fileEditorOwner, PI_CONFIG_EDITOR_OWNER } = loadTsCommonJs("src/renderer/src/utils/fileExplorerSource.ts");
const { workspacePageAtom, piConfigDocumentVisibleAtom } = loadTsCommonJs("src/renderer/src/atoms/workspace-navigation-atoms.ts");
const { fileAccessScopeKey } = loadTsCommonJs("src/shared/types/piConfigFiles.ts");

test("home shows global configuration even while a workspace remains selected", () => {
	const project = { id: "workspace" };
	assert.equal(usesPiConfigFiles("home", project), true);
	assert.equal(fileEditorOwner("home", project), PI_CONFIG_EDITOR_OWNER);
});
test("independent chat and an empty window share the global config owner", () => {
	assert.equal(fileEditorOwner("workspace", { id: "chat", kind: "chat" }), PI_CONFIG_EDITOR_OWNER);
	assert.equal(fileEditorOwner("workspace", null), PI_CONFIG_EDITOR_OWNER);
});
test("workspace view binds its own file tree and document cache", () => {
	assert.equal(usesPiConfigFiles("workspace", { id: "workspace" }), false);
	assert.equal(fileEditorOwner("workspace", { id: "workspace" }), "project:workspace");
	assert.notEqual(fileEditorOwner("workspace", { id: PI_CONFIG_EDITOR_OWNER }), PI_CONFIG_EDITOR_OWNER);
});
test("clicking home restores the overview without destroying a global document", () => {
	const store = createStore();
	store.set(piConfigDocumentVisibleAtom, true);
	assert.equal(store.get(workspacePageAtom), "home");
	store.set(workspacePageAtom, "home");
	assert.equal(store.get(piConfigDocumentVisibleAtom), false);
});
test("config and project authorization cannot share a file cache identity", () => {
	const config = fileAccessScopeKey({ kind: "pi-config" });
	assert.notEqual(config, fileAccessScopeKey({ projectId: "pi-agent-config" }));
	assert.notEqual(config, fileAccessScopeKey());
});
