import type { CommitEntry } from "../../../../../shared/types";
import { Twistie } from "./GitResourceTree";
import { commitRefs } from "./gitGraphModel";

export function GitCommitSummary(props: { commit: CommitEntry; branches: string[]; expanded: boolean; time: string }) {
	const refs = commitRefs(props.commit.refNames, props.branches);
	return (
		<span className="flex min-w-0 flex-col gap-1 overflow-hidden">
			<span className="flex min-w-0 items-center gap-1.5">
				<Twistie open={props.expanded} />
				<span className="min-w-0 flex-1 truncate text-sm" title={props.commit.message}>
					{props.commit.message}
				</span>
				<span className="flex max-w-[55%] shrink-0 items-center gap-1 overflow-x-auto">
					{refs.map((ref) => (
						<span
							key={`${ref.kind}:${ref.label}`}
							data-ref-kind={ref.kind}
							className={`git-graph-ref max-w-[130px] shrink-0 truncate rounded-sm border px-1 text-[10px] leading-4 ${ref.current ? "border-[var(--git-modified)] text-[var(--git-modified)]" : ref.kind === "tag" ? "border-[var(--git-conflict)] text-[var(--git-conflict)]" : "border-[var(--git-panel-border)] text-[var(--git-desc-fg)]"}`}
							title={ref.current ? `HEAD → ${ref.label}` : ref.label}
						>
							{ref.current && ref.kind !== "head" ? `HEAD → ${ref.label}` : ref.label}
						</span>
					))}
				</span>
			</span>
			<span className="flex min-w-0 items-center gap-2 pl-4 text-xs leading-4 text-[var(--git-desc-fg)]">
				<code className="git-graph-hash shrink-0 font-mono">{props.commit.shortHash}</code>
				<span className="min-w-0 flex-1 truncate">{props.commit.authorName}</span>
				<time className="shrink-0" dateTime={new Date(props.commit.authorDate).toISOString()} title={new Date(props.commit.authorDate).toLocaleString()}>
					{props.time}
				</time>
			</span>
		</span>
	);
}
