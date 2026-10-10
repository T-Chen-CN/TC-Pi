import type { CommitEntry, GitResourceGroups, GitResourceGroupType } from "../../../../../shared/types";

export const WORKING_TREE_HASH = "working-tree";

export function commitRefs(refNames: string[], branches: string[]) {
	const localBranches = new Set(branches);
	const refs = new Map<string, { label: string; kind: "branch" | "remote" | "tag" | "head"; current: boolean }>();
	for (const raw of refNames.flatMap((entry) => entry.split(","))) {
		const ref = raw.trim();
		if (!ref) continue;
		const current = ref === "HEAD" || ref.startsWith("HEAD -> ");
		const label = ref.replace(/^HEAD -> /, "").replace(/^tag: /, "");
		const kind = ref === "HEAD" ? "head" : ref.startsWith("tag: ") ? "tag" : current || localBranches.has(label) ? "branch" : "remote";
		const key = `${kind}:${label}`;
		refs.set(key, { label, kind, current: current || Boolean(refs.get(key)?.current) });
	}
	return [...refs.values()].sort((a, b) => Number(b.current) - Number(a.current));
}

export function isHeadCommit(commit: CommitEntry) {
	return commit.refNames.flatMap((entry) => entry.split(",")).some((entry) => entry.trim() === "HEAD" || entry.trim().startsWith("HEAD -> "));
}

/** The working tree connects to HEAD, which need not be the first commit in --all. */
export function withWorkingTree(commits: CommitEntry[], showWorkingTree: boolean): CommitEntry[] {
	if (!showWorkingTree) return commits;
	const head = commits.find(isHeadCommit);
	return [{ hash: WORKING_TREE_HASH, shortHash: "", message: "", authorName: "", authorEmail: "", authorDate: 0, parents: head ? [head.hash] : [], refNames: [], graph: [] }, ...commits];
}

export function workingTreeSummary(groups: GitResourceGroups) {
	const order: GitResourceGroupType[] = ["merge", "index", "workingTree", "untracked"];
	const files = order.flatMap((group) => groups[group].map((resource) => ({ group, resource })));
	return { files, count: new Set(files.map(({ resource }) => resource.path)).size, staged: groups.index.length, unstaged: groups.workingTree.length + groups.untracked.length, conflicts: groups.merge.length };
}
