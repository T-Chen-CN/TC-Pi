import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("public desktop API and IPC no longer expose announcement or issue feedback operations", () => {
	for (const path of ["src/shared/ipc.ts", "src/preload/index.ts", "src/renderer/src/previewApi.ts"]) {
		assert.doesNotMatch(read(path), /announcement(?:List|Refresh|Mark|Changed)|\bannouncements\s*:|appFeedback|feedbackEnvironment|getFeedbackProjectContext|healthCheck\s*:|healthExport(?:Report|Bundle)\s*:/, path);
	}
});

test("application startup has no announcement service, polling, or feedback overlay", () => {
	for (const path of ["src/main/index.ts", "src/renderer/src/App.tsx", "src/renderer/src/components/app/AppBootstrap.tsx", "src/renderer/src/components/overlays/SessionActionOverlays.tsx"]) {
		assert.doesNotMatch(read(path), /AnnouncementService|registerAnnouncementIpc|useAnnouncements?\w+|FeedbackDialog|setFeedbackOpen|handleFeedbackCreateSession|EnvironmentDoctor|LogBundleExporter/, path);
	}
});

test("settings keep the old announcement preference readable without an interactive control", () => {
	assert.match(read("src/shared/types/settings.ts"), /announcementNotificationEnabled\??\s*:\s*boolean/);
	for (const path of ["src/renderer/src/components/app/settings/NotificationTab.tsx", "src/renderer/src/utils/settingsFieldAnchors.ts", "src/renderer/src/components/app/settings/unsavedChangesSummary.ts"]) {
		assert.doesNotMatch(read(path), /announcementNotification|notification-announcement/, path);
	}
});

test("release checks no longer require the removed announcement generator", () => {
	for (const path of ["package.json", ".github/workflows/ci.yml", "scripts/release-preflight.mjs"]) {
		assert.doesNotMatch(read(path), /build-announcements|(?:build|check):announcements/, path);
	}
});

test("startup no longer installs the obsolete feedback report skill", () => {
	assert.doesNotMatch(read("src/main/index.ts"), /installPideckDoctorTemplate/);
	assert.doesNotMatch(read("src/main/skills/SkillManager.ts"), /installPideckDoctorTemplate/);
	assert.doesNotMatch(read("resources/skills/skills-manifest.json"), /pideck-doctor/);
});
