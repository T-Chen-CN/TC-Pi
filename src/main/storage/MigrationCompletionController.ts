import { dialog, type BrowserWindow } from "electron";
import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { InstallPaths } from "./installPaths";
import { assertMigrationPath } from "./migrationEvidence";
import { readMigrationAudit, writeMigrationAudit } from "./migrationAudit";
import { finishInstallationMigration, type MigrationReport, type MigrationSources, type RuntimeProbeResult } from "./migrationCompletion";
import { migrationNoticeDetail, migrationNoticeFingerprint, type MigrationCopyText } from "./migrationNotice";

/** Own verification, cleanup, result persistence and one informational native dialog per changed outcome. */
export class MigrationCompletionController {
	private readonly abort = new AbortController();
	private operation?: Promise<void>;
	private notice?: Promise<void>;
	private report?: MigrationReport;
	private lastFingerprint?: string;
	constructor(private readonly deps: { paths: InstallPaths; sources: MigrationSources; probe: (signal: AbortSignal) => Promise<RuntimeProbeResult>; window: () => BrowserWindow | null; copy: MigrationCopyText; warn: () => void }) {}

	/** Installer callbacks share one owner; a request arriving mid-probe rechecks after that probe finishes. */
	async run(): Promise<void> {
		if (this.abort.signal.aborted || this.deps.sources.skipMigration) return;
		if (this.operation) {
			await this.operation;
			return this.run();
		}
		const operation = this.runOnce();
		this.operation = operation;
		try {
			await operation;
		} finally {
			if (this.operation === operation) this.operation = undefined;
		}
	}
	private async runOnce(): Promise<void> {
		try {
			const report = await finishInstallationMigration(this.deps.paths, this.deps.sources, async () => {
				const result = await this.deps.probe(this.abort.signal);
				return this.abort.signal.aborted ? { ok: false } : result;
			});
			if (!report || this.abort.signal.aborted) return;
			this.report = report;
			assertMigrationPath(this.deps.paths.root, this.deps.paths.data);
			const file = join(this.deps.paths.data, "migration-result.json");
			// Never follow a replaced report file to an external location.
			try {
				assertMigrationPath(this.deps.paths.root, file);
			} catch (error) {
				if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
			}
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				writeFileSync(temporary, JSON.stringify(report, null, 2), { flag: "wx" });
				renameSync(temporary, file);
			} finally {
				if (existsSync(temporary)) unlinkSync(temporary);
			}
			await this.notify();
		} catch {
			this.deps.warn();
			if (!this.abort.signal.aborted) {
				this.report = { verified: false, items: [], unknown: [...this.deps.sources.desktopSources, this.deps.sources.piSource].filter(existsSync) };
				await this.notify();
			}
		}
	}

	/** Call once after createWindow too: verification can finish before the first window exists. */
	async notify(): Promise<void> {
		if (this.notice) return this.notice;
		const report = this.report,
			window = this.deps.window();
		if (!report || !window || window.isDestroyed() || this.abort.signal.aborted) return;
		let audit;
		try {
			audit = readMigrationAudit(this.deps.paths);
		} catch {
			/* Invalid evidence is explained without authorizing cleanup or replacing it. */
		}
		const fingerprint = migrationNoticeFingerprint(report);
		if (audit?.noticeFingerprint === fingerprint || this.lastFingerprint === fingerprint) return;
		const notify = async (): Promise<void> => {
			try {
				await dialog.showMessageBox(window, {
					type: report.verified ? "info" : "warning",
					title: this.deps.copy("mainMigration.title"),
					message: this.deps.copy(report.verified ? "mainMigration.complete" : "mainMigration.pending"),
					detail: migrationNoticeDetail(report, this.deps.paths.root, join(this.deps.paths.data, "migration-result.json"), this.deps.copy),
					buttons: [this.deps.copy("mainMigration.close")],
					noLink: true,
				});
				if (this.abort.signal.aborted) return;
				this.lastFingerprint = fingerprint;
				const latest = readMigrationAudit(this.deps.paths);
				if (latest) {
					latest.noticeFingerprint = fingerprint;
					writeMigrationAudit(this.deps.paths, latest);
				}
			} catch {
				this.deps.warn();
			}
		};
		this.notice = notify();
		try {
			await this.notice;
		} finally {
			this.notice = undefined;
		}
	}
	/** Quit cancels only the private verification process; no background Agent is borrowed or stopped. */
	dispose(): void {
		this.abort.abort();
	}
}
