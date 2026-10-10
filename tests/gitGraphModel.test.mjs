import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { commitRefs, isHeadCommit, withWorkingTree, workingTreeSummary } = loadTsCommonJs("src/renderer/src/components/app/git/gitGraphModel.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const commit = (hash, refNames = []) => ({ hash, refNames, parents: [], message: hash });

test("working tree connects to the actual HEAD even when another branch has a newer commit", () => {
	const commits = [commit("feature-tip", ["feature/topic"]), commit("main-tip", ["HEAD -> main"]), commit("root")];
	const rows = withWorkingTree(commits, true);
	assert.equal(rows[0].hash, "working-tree");
	assert.deepEqual(plain(rows[0].parents), ["main-tip"]);
	assert.equal(rows[1], commits[0]);
	assert.equal(commits.length, 3, "does not mutate the server response");
	assert.equal(withWorkingTree(commits, false), commits);
});

test("detached HEAD is a current commit and working trees without a visible HEAD have no invented parent", () => {
	assert.equal(isHeadCommit(commit("detached", ["tag: v1, HEAD"])), true);
	assert.deepEqual(plain(withWorkingTree([commit("detached", ["HEAD"])], true)[0].parents), ["detached"]);
	assert.deepEqual(plain(withWorkingTree([commit("other", ["origin/main"])], true)[0].parents), []);
	assert.deepEqual(plain(withWorkingTree([], true)[0].parents), []);
	assert.equal(isHeadCommit(commit("ordinary", ["HEAD-feature"])), false);
});

test("shows all local, remote and tag decorations while deduplicating the current branch", () => {
	const refs = commitRefs(["main, HEAD -> main, origin/main, tag: v1.0", "feature/topic", "HEAD -> main"], ["main", "feature/topic"]);
	assert.deepEqual(plain(refs), [
		{ label: "main", kind: "branch", current: true },
		{ label: "origin/main", kind: "remote", current: false },
		{ label: "v1.0", kind: "tag", current: false },
		{ label: "feature/topic", kind: "branch", current: false },
	]);
});

test("counts files once but preserves staged and unstaged diffs for the same file", () => {
	const groups = { merge: [{ path: "conflict" }], index: [{ path: "both", letter: "M" }], workingTree: [{ path: "both", letter: "M" }], untracked: [{ path: "new", letter: "?" }] };
	const summary = workingTreeSummary(groups);
	assert.equal(summary.count, 3);
	assert.equal(summary.staged, 1);
	assert.equal(summary.unstaged, 2);
	assert.equal(summary.conflicts, 1);
	assert.deepEqual(plain(summary.files.map(({ group }) => group)), ["merge", "index", "workingTree", "untracked"]);
	assert.equal(workingTreeSummary({ merge: [], index: [], workingTree: [], untracked: [] }).count, 0);
});
