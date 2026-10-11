import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const shared = loadTsCommonJs("src/shared/updateSources.ts");
const main = loadTsCommonJs("src/main/update/updateSources.ts");
test("all persisted source IDs resolve to the current GitHub provider", () => {
	for (const source of ["github", "atomgit", "custom", "hacked", undefined, null, 42]) {
		assert.equal(main.normalizeUpdateSource(source), "github");
		assert.equal(main.updateSourceFeedUrl(source), null);
		assert.equal(main.updateSourceLatestReleaseUrl(source), null);
	}
	assert.equal(main.updateSourceOptions().length, 1);
	assert.equal(main.updateSourceOptions()[0].id, "github");
	assert.equal(shared.UPDATE_SOURCE_MIRRORS.length, 0);
});
test("GitHub release assets belong to TC-Pi", () => {
	assert.equal(shared.gitHubLatestDownloadBase(), "https://github.com/T-Chen-CN/TC-Pi/releases/latest/download");
	assert.equal(shared.buildCustomSourceFeedUrl("https://mirror.example.test"), "https://mirror.example.test/https://github.com/T-Chen-CN/TC-Pi/releases/latest/download");
});
test("custom mirror URL validation retains protocol and trailing-slash checks", () => {
	const normalize = shared.normalizeCustomMirrorHost;
	assert.equal(normalize("  https://a.com///  "), "https://a.com");
	assert.equal(normalize("http://a.com"), "http://a.com");
	for (const input of ["a.com", "ftp://a.com", "", "   ", null, undefined]) assert.equal(normalize(input), null);
});
