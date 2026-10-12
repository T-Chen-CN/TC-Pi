import { useAtomValue } from "jotai";
import { Boxes, ChevronDown, ShieldCheck } from "lucide-react";
import { homeOverviewAtom, homeOverviewRangeAtom } from "../../atoms/home-overview-atoms";
import { sessionRecordsAtom } from "../../atoms";
import { overviewUsage } from "./homeOverviewModel";
import { ProviderUsageInline } from "../app/ProviderUsageInline";
import { formatCost, formatTokens } from "../app/usageStats/format";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui-shadcn/collapsible";

/** 供应商卡片只展示状态，余额查询继续遵守既有的显式启用设置。 */
export function HomeProviders() {
	const overview = useAtomValue(homeOverviewAtom);
	const range = useAtomValue(homeOverviewRangeAtom);
	const records = useAtomValue(sessionRecordsAtom);
	const usage = overview.usage ? overviewUsage(overview.usage, range) : undefined;
	const lastModel = Object.values(records)
		.filter((session) => session.model)
		.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.model;
	const providers = [...new Set([...overview.providers.map((provider) => provider.id), ...(usage?.providers.map((provider) => provider.provider) ?? [])])];
	return (
		<section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border/60 bg-card p-4 text-foreground" data-testid="home-providers" aria-label={t("overview.providers")}>
			<h2 className="mb-4 flex items-center gap-2 text-body font-semibold">
				<Boxes className="size-4" />
				{t("overview.providers")}
			</h2>
			<div className="grid min-w-0 gap-3 rounded-lg bg-muted/40 p-3 @xl:grid-cols-2">
				<div className="min-w-0">
					<p className="text-micro text-muted-foreground">{t("overview.defaultModel")}</p>
					<p className="mt-1 break-all text-caption font-medium">{overview.defaultModel ?? t("overview.unset")}</p>
				</div>
				<div className="min-w-0">
					<p className="text-micro text-muted-foreground">{t("overview.lastModel")}</p>
					<p className="mt-1 break-all text-caption font-medium">{lastModel ? `${lastModel.provider}/${lastModel.modelId}` : "—"}</p>
				</div>
			</div>
			{overview.configError && (
				<p role="alert" className="mb-3 text-caption text-destructive">
					{t("overview.configError")}
				</p>
			)}
			{!providers.length && <p className="text-caption text-muted-foreground">{overview.loading ? t("common.loading") : t("overview.noProviders")}</p>}
			{providers.length > 0 && (
				<p className="mt-3 truncate text-micro text-muted-foreground" title={providers.join(" · ")}>
					{providers.join(" · ")} · {t("overview.authConfigured")} {overview.providers.filter((provider) => provider.authenticated).length}/{providers.length}
				</p>
			)}
			<Collapsible className="mt-3" data-testid="home-provider-details">
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm" className="group w-full justify-between text-muted-foreground">
						{t("overview.providerDetails")}
						<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="mt-4 border-t border-border/60 pt-4">
						<div className="flex flex-col gap-3">
							{providers.map((id) => {
								const provider = overview.providers.find((item) => item.id === id);
								const consumed = usage?.providers.find((item) => item.provider === id);
								return (
									<section key={id} className="shrink-0 rounded-xl border border-border/60 bg-card p-3">
										<div className="flex items-center justify-between gap-2">
											<h3 className="min-w-0 truncate text-caption font-semibold" title={id}>
												{id}
											</h3>
											<ShieldCheck className={provider?.authenticated ? "size-3.5 shrink-0 text-primary" : "size-3.5 shrink-0 text-muted-foreground"} />
										</div>
										<p className="mt-1 text-micro text-muted-foreground">{provider?.authenticated ? t("overview.authConfigured") : t("overview.authUnset")}</p>
										<p className="mt-3 text-caption tabular-nums">{consumed ? `${formatTokens(consumed.tokens)} ${t("overview.tokenUnit")} · ${formatCost(consumed.cost)}${usage?.costKnown ? "" : " *"}` : t("overview.noUsage")}</p>
										{provider?.models.length ? <p className="mt-2 break-all text-micro text-muted-foreground">{provider.models.join(" · ")}</p> : null}
										<div className="mt-2 overflow-x-auto">
											<ProviderUsageInline provider={id} variant="card" backend="pi" />
										</div>
									</section>
								);
							})}
						</div>
						{overview.usage?.byModel.length ? (
							<section className="mt-6">
								<h2 className="mb-3 text-caption font-semibold">{t("overview.modelUsage")}</h2>
								{overview.usage.byModel.slice(0, 8).map((model) => (
									<div key={`${model.provider}/${model.model}`} className="mb-3">
										<p className="truncate text-caption" title={`${model.provider}/${model.model}`}>
											{model.model}
										</p>
										<p className="text-micro tabular-nums text-muted-foreground">
											{model.provider} · {formatTokens(model.tokens)} {t("overview.tokenUnit")}
										</p>
									</div>
								))}
							</section>
						) : null}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}
