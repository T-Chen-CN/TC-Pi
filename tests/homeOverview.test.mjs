import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { overviewUsage, overviewProviders, overviewProjectPath } = loadTsCommonJs("src/renderer/src/components/home/homeOverviewModel.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const totals = (tokens, sessions = []) => ({ tokens, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: tokens / 100, turns: 1, sessions });
const day = (date, tokens, sessions) => ({ day: date, totals: totals(tokens, sessions), byProvider: [{ provider: "custom", tokens, cost: tokens / 100, turns: 1 }], byModel: [], byProject: [{ project: "C:\\work\\project", tokens, cost: tokens / 100, turns: 1 }] });
const data = () => ({
	window: { since: 1, to: 2 },
	totals: totals(0),
	activeDays: 3,
	today: totals(0),
	thisWeek: totals(0),
	thisMonth: totals(0),
	daily: [day("2026-09-01", 100, ["past"]), day("2026-10-05", 20, ["shared"]), day("2026-10-11", 30, ["shared", "latest"])],
	heatmap: [],
	heatmapStart: "2026-01-01",
	byModel: [],
	byProject: [],
	costKnown: false,
	recordCount: 3,
});

test("range aggregation includes the boundary, deduplicates sessions and groups full workspace paths", () => {
	const result = overviewUsage(data(), "week", new Date(2026, 9, 11));
	assert.equal(result.totals.tokens, 50);
	assert.deepEqual(plain(result.totals.sessions), ["shared", "latest"]);
	assert.equal(result.projects[0].cost, 0.5);
	assert.equal(result.providers[0].tokens, 50);
	assert.equal(result.costKnown, false, "unknown pricing remains unknown");
	assert.equal(overviewUsage(data(), "today", new Date(2026, 9, 11)).totals.tokens, 30);
	assert.equal(overviewUsage(data(), "all", new Date(2026, 9, 11)).totals.tokens, 150);
});
test("empty periods produce bounded empty aggregates without mutating the input", () => {
	const input = data();
	const before = JSON.stringify(input);
	const result = overviewUsage(input, "today", new Date(2026, 10, 1));
	assert.equal(result.totals.tokens, 0);
	assert.equal(result.projects.length, 0);
	assert.equal(JSON.stringify(input), before);
});
test("provider summaries discard credentials and handle malformed model configuration", () => {
	const result = overviewProviders({ custom: { apiKey: "secret-config", models: [{ id: "model" }, null, {}] }, broken: null }, { custom: { type: "api_key", key: "secret-auth" }, login: { type: "oauth", access: "secret-token" }, empty: {} });
	assert.deepEqual(plain(result.find((provider) => provider.id === "custom")), { id: "custom", models: ["model"], authenticated: true });
	assert.equal(result.find((provider) => provider.id === "login").authenticated, true);
	assert.equal(result.find((provider) => provider.id === "empty").authenticated, false);
	assert.doesNotMatch(JSON.stringify(result), /secret/);
});
test("workspace usage matches Windows path variants while preserving Unix case", () => {
	assert.equal(overviewProjectPath("C:\\Work\\Project\\"), overviewProjectPath("c:/work/project"));
	assert.equal(overviewProjectPath("\\\\server\\Share\\Project"), overviewProjectPath("//SERVER/share/project/"));
	assert.notEqual(overviewProjectPath("/work/Project"), overviewProjectPath("/work/project"));
});
