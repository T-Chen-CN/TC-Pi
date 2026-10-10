import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
import { quickMessageHookHost as hookHost } from "./helpers/quickMessageHookHost.mjs";

const empty = () => ({ merge: [], index: [], workingTree: [], untracked: [] });
const settle = async () => {
	for (let index = 0; index < 8; index++) await Promise.resolve();
};
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function harness(overrides = {}) {
	const host = hookHost();
	const events = new Map();
	const timers = new Map();
	const surface = { hidden: false, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name) };
	const window = {
		...surface,
		setInterval: (callback) => {
			const id = timers.size + 1;
			timers.set(id, callback);
			return id;
		},
		clearInterval: (id) => timers.delete(id),
	};
	const { useGitGraphUpdates } = loadTsCommonJs("src/renderer/src/hooks/useGitGraphUpdates.ts", { stubs: { react: host.react }, globals: { document: surface, window } });
	const unwatched = [];
	let listener;
	let watches = 0;
	let options = {
		projectId: "project",
		repoScopeKey: "repo-a",
		open: true,
		getStatus: async () => empty(),
		refreshWorkspace: () => {},
		refreshHistory: () => {},
		watchRefs: async () => {
			watches++;
			return "watch-a";
		},
		unwatchRefs: async (id) => unwatched.push(id),
		onRefsChanged: (callback) => {
			listener = callback;
			return () => {
				listener = undefined;
			};
		},
		...overrides,
	};
	return {
		events,
		timers,
		surface,
		unwatched,
		render: (update = {}) => {
			options = { ...options, ...update };
			return host.render(() => useGitGraphUpdates(options));
		},
		unmount: host.unmount,
		emitRefs: (id) => listener?.(id),
		get watches() {
			return watches;
		},
	};
}

test("shares Changes status and reads latest callbacks without resubscribing on wrapper renders", async () => {
	let reads = 0;
	let refreshes = 0;
	let workspaceRefreshes = 0;
	const groups = empty();
	const hook = harness({
		groups,
		getStatus: async () => {
			reads++;
			return empty();
		},
		refreshHistory: () => refreshes++,
	});
	const first = hook.render();
	await settle();
	assert.equal(first.groups, groups);
	assert.equal(reads, 0);
	assert.equal(hook.timers.size, 0);
	hook.render({
		watchRefs: async () => "unused",
		refreshHistory: () => {
			refreshes += 10;
		},
		refreshWorkspace: () => workspaceRefreshes++,
	});
	hook.emitRefs("other-repo");
	assert.equal(refreshes, 0);
	hook.emitRefs("watch-a");
	assert.equal(refreshes, 10);
	assert.equal(hook.watches, 1);
	first.refreshWorkingTree();
	assert.equal(workspaceRefreshes, 1);
	hook.unmount();
	assert.deepEqual(hook.unwatched, ["watch-a"]);
	assert.equal(hook.events.size, 0);
});

test("history-only status avoids overlapping requests and discards responses from a previous repository", async () => {
	const oldRequest = deferred();
	const newGroups = { ...empty(), untracked: [{ path: "new-repo-file" }] };
	let reads = 0;
	const hook = harness({
		getStatus: () => {
			reads++;
			return oldRequest.promise;
		},
	});
	hook.render();
	const timer = [...hook.timers.values()][0];
	timer();
	timer();
	assert.equal(reads, 1, "slow requests do not overlap");
	hook.render({ repoScopeKey: "repo-b", getStatus: async () => newGroups });
	await settle();
	oldRequest.resolve({ ...empty(), untracked: [{ path: "stale-file" }] });
	await settle();
	assert.equal(hook.render().groups, newGroups);
	hook.surface.hidden = true;
	let historyRefreshes = 0;
	hook.render({ refreshHistory: () => historyRefreshes++ });
	hook.events.get("focus")();
	assert.equal(historyRefreshes, 0);
	hook.surface.hidden = false;
	hook.events.get("visibilitychange")();
	assert.equal(historyRefreshes, 1);
	hook.unmount();
	assert.equal(hook.timers.size, 0);
	assert.equal(hook.events.size, 0);
});

test("a watcher id arriving after the graph closes is immediately unsubscribed", async () => {
	const pendingWatch = deferred();
	const hook = harness({ watchRefs: () => pendingWatch.promise });
	hook.render();
	hook.render({ open: false });
	pendingWatch.resolve("late-watch");
	await settle();
	assert.deepEqual(hook.unwatched, ["late-watch"]);
	assert.equal(hook.events.size, 0);
	assert.equal(hook.timers.size, 0);
	hook.unmount();
});
