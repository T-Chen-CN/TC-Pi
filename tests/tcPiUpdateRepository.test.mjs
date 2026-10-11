import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
import { planAtomgitMirror } from "../scripts/atomgit-mirror.mjs";

const shared = loadTsCommonJs("src/shared/updateSources.ts");
const settings = loadTsCommonJs("src/main/settings/SettingsStore.ts");
const sources = loadTsCommonJs("src/main/update/repoContents.ts");

test("packaged and runtime updates both target TC-Pi", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	assert.equal(shared.UPDATE_REPO_OWNER, "T-Chen-CN");
	assert.equal(shared.UPDATE_REPO, "TC-Pi");
	assert.equal(pkg.build.publish.owner, shared.UPDATE_REPO_OWNER);
	assert.equal(pkg.build.publish.repo, shared.UPDATE_REPO);
	assert.doesNotMatch(readFileSync("src/main/index.ts", "utf8"), /installAtomgitNoCacheBypass/);
});

test("retired mirror settings migrate to GitHub even after the old migration ran", () => {
	const record = { updateSource: "atomgit", updateSourceAtomgitMigrated: true };
	assert.equal(settings.migrateUpdateSourceToGitHub(record), true);
	assert.equal(record.updateSource, "github");
	assert.equal(settings.migrateUpdateSourceToGitHub(record), false);
});

test("repository content fetches stay in TC-Pi for every saved source", () => {
	for (const source of ["github", "atomgit", "custom"]) {
		const entries = sources.repoFileSourceEntries("resources/extensions/manifest.json", "main", source);
		assert.ok(entries.length > 0);
		for (const entry of entries) {
			const url = new URL(entry.url);
			assert.ok(["raw.githubusercontent.com", "api.github.com"].includes(url.hostname));
			assert.ok(url.pathname.includes("/T-Chen-CN/TC-Pi/"));
		}
	}
});

test("pushing TC-Pi cannot implicitly publish to the upstream mirror", () => {
	const plan = planAtomgitMirror({ remoteName: "origin", remoteUrl: "https://github.com/T-Chen-CN/TC-Pi.git", stdin: `refs/heads/main ${"1".repeat(40)} refs/heads/main ${"0".repeat(40)}`, env: {} });
	assert.equal(plan.action, "skip");
});

test("release workflows can publish with the current repository token", () => {
	for (const file of ["release.yml", "build-dev.yml", "release-linux-manual.yml"]) {
		const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
		assert.match(workflow, /permissions\s*:\s*\r?\n\s*contents\s*:\s*write/, file);
		assert.match(workflow, /secrets\.RELEASE_PAT\s*\|\|\s*github\.token/, file);
	}
});
