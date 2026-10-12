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
	const model = read("components/home/homeWorkModel.ts");
	// 首页策略迁入纯模型后，仍以 catalog 为来源、限定最近十二条并走稳定会话导航。
	assert.match(home, /buildHomeWork\(\{\s*projects,\s*sessions:\s*Object\.values\(records\)/);
	assert.match(model, /recentSessions:\s*sessions\.slice\(0,\s*12\)/);
	assert.match(home, /actions\.sessions\.open\(session\.projectId,\s*session\.id\)/);
	assert.match(model, /input\.pendingRequests\[session\.id\]/);
	assert.doesNotMatch(home + model, /recent-session-atoms|collectRecentActivityRows|growRecentVisible|canCollapseRecent/);
});
