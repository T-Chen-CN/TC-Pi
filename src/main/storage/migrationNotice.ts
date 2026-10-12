import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";
import type { MigrationReport, MigrationReportItem } from "./migrationCompletion";

export type MigrationCopyText = (key: MainProcessTranslationKey, params?: Record<string, string | number>) => string;

/** Explain cleaned, retained, unverified and unselected data separately; never claim a failed copy succeeded. */
export function migrationNoticeDetail(report: MigrationReport, root: string, reportPath: string, copy: MigrationCopyText): string {
	const lines = [copy("mainMigration.destination", { path: root })];
	const row = (item: MigrationReportItem, count: number): string =>
		copy("mainMigration.item", { category: copy(`mainMigration.category.${item.category}`), count, source: item.source, destination: item.destination, reason: item.reason ? copy(`mainMigration.reason.${item.reason}`) : copy("mainMigration.reason.complete") });
	function section(key: MainProcessTranslationKey, items: MigrationReportItem[], count: (item: MigrationReportItem) => number): void {
		lines.push("", copy(key));
		if (!items.length) lines.push(copy("mainMigration.none"));
		else for (const item of items) lines.push(row(item, count(item)));
	}
	section(
		"mainMigration.cleaned",
		report.items.filter((item) => item.cleaned > 0 || item.removed),
		(item) => item.cleaned,
	);
	section(
		"mainMigration.retained",
		report.items.filter((item) => item.verified && !item.removed),
		(item) => item.retained,
	);
	section(
		"mainMigration.unverified",
		report.items.filter((item) => !item.verified && !item.removed),
		(item) => item.retained,
	);
	if (report.credentials) lines.push("", copy(report.credentials === "verified" ? "mainMigration.credentialsVerified" : "mainMigration.credentialsPending"));
	if (report.credentialsSkipped) lines.push(copy("mainMigration.credentialsSkipped", { count: report.credentialsSkipped }));
	if (report.unknown.length) lines.push("", copy("mainMigration.unselected"), ...report.unknown.slice(0, 30));
	lines.push("", copy("mainMigration.report", { path: reportPath }));
	return lines.join("\n");
}

/** Suppress identical notices across restarts; a later runtime install or cleanup retry produces a new result. */
export function migrationNoticeFingerprint(report: MigrationReport): string {
	return JSON.stringify({ verified: report.verified, credentials: report.credentials, credentialsSkipped: report.credentialsSkipped, items: report.items.map(({ source, cleaned, retained, removed, reason, verified }) => ({ source, cleaned, retained, removed, reason, verified })), unknown: report.unknown });
}
