import { useState, type ReactNode } from "react";
import type { GitResourceGroups, GitResourceGroupType } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { ResourceRow, Twistie } from "./GitResourceTree";
import { workingTreeSummary } from "./gitGraphModel";

export function GitWorkingTreeRow(props: { groups: GitResourceGroups; lane: ReactNode; continuation: ReactNode; onOpenDiff: (group: GitResourceGroupType, path: string) => void | Promise<void> }) {
	const [expanded, setExpanded] = useState(false);
	const summary = workingTreeSummary(props.groups);
	return (
		<div role="listitem" className="git-working-tree-row">
			<button
				type="button"
				className="git-history-row grid h-[52px] w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 pr-2.5 pl-0.5 text-left hover:bg-[var(--git-panel-hover)] focus-visible:shadow-[inset_var(--focus-ring)] focus-visible:outline-none"
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
			>
				{props.lane}
				<span className="min-w-0">
					<span className="flex items-center gap-1 text-sm font-medium">
						<Twistie open={expanded} />
						{t("git.uncommittedChanges")}
						<span className="ml-auto text-xs text-[var(--git-desc-fg)]">{t("git.filesChanged", { count: summary.count })}</span>
					</span>
					<span className="block truncate pl-4 text-xs text-[var(--git-desc-fg)]" title={t("git.workingTreeHint")}>
						{t("git.workingTreeCounts", { staged: summary.staged, unstaged: summary.unstaged, conflicts: summary.conflicts })}
					</span>
				</span>
			</button>
			{expanded &&
				summary.files.map(({ group, resource }) => (
					<div key={`${group}:${resource.path}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pr-2 pl-0.5">
						{props.continuation}
						<div className="min-w-0">
							<ResourceRow path={resource.path} status={resource.status} letter={resource.letter} onOpen={() => props.onOpenDiff(group, resource.path)} />
						</div>
						<span className="text-[10px] text-[var(--git-desc-fg)]">{t(group === "index" ? "git.stagedChanges" : group === "merge" ? "git.mergeChanges" : group === "untracked" ? "git.untrackedChanges" : "git.changes")}</span>
					</div>
				))}
		</div>
	);
}
