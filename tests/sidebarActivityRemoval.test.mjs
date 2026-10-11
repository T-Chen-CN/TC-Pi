import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../src/renderer/src/${path}`, import.meta.url), "utf8");

test("removed activity views and usage-history storage have no modules or update hooks", () => {
	for (const path of ["components/sidebar/ActiveSessionsTree.tsx", "components/sidebar/RecentSessionsSection.tsx", "components/sidebar/activitySessionsModel.ts", "atoms/recent-session-atoms.ts", "utils/sidebarNavTab.ts"]) {
		assert.equal(existsSync(new URL(`../src/renderer/src/${path}`, import.meta.url)), false, path);
	}
	assert.doesNotMatch(read("atoms/session-atoms.ts"), /recent-session-atoms|touchRecentSession|forgetRecentSession/);
	assert.doesNotMatch(read("atoms/app-ui-atoms.ts") + read("hooks/useSidebarController.ts") + read("components/sidebar/AppSidebar.tsx"), /sidebarNavTab|settingsNavTab|persistNavTab|ActiveSessionsTree|RecentSessionsSection/);
});

test("home retains catalog-based recent sessions and active runtime navigation", () => {
	const home = read("components/home/HomeOverview.tsx");
	assert.match(home, /workspaceSessions\(Object\.values\(records\)\)/);
	assert.match(home, /sessions\.slice\(0,\s*12\)/);
	assert.match(home, /open\(session\.projectId,\s*session\.id\)/);
	assert.match(home, /pendingRequests\[session\.id\]/);
	assert.doesNotMatch(home, /recent-session-atoms|collectRecentActivityRows|growRecentVisible|canCollapseRecent/);
});
