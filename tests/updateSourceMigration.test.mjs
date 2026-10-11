import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { migrateUpdateSourceToGitHub } = loadTsCommonJs("src/main/settings/SettingsStore.ts");
for (const oldSource of ["atomgit", "custom", "ghfast", undefined, 42]) {
	test(`legacy source ${String(oldSource)} migrates to GitHub`, () => {
		const settings = { updateSource: oldSource, updateSourceAtomgitMigrated: true };
		assert.equal(migrateUpdateSourceToGitHub(settings), true);
		assert.equal(settings.updateSource, "github");
		assert.equal("updateSourceAtomgitMigrated" in settings, false);
		assert.equal(migrateUpdateSourceToGitHub(settings), false);
	});
}
test("GitHub choice stays intact without repeating a migration", () => {
	const settings = { updateSource: "github" };
	assert.equal(migrateUpdateSourceToGitHub(settings), false);
	assert.equal(settings.updateSource, "github");
});
