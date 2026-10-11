/** TC-Pi 文件读取契约：URL 编码、同仓库回退、base64 解码与无镜像请求。 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { gitHubContentsApiUrl, gitHubRawFileUrl, repoFileSourceEntries, decodeGitHubContentsBuffer, decodeGitHubContentsResponse } = loadTsCommonJs("src/main/update/repoContents.ts");

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 构造 GitHub API contents 响应体（content 为 base64）。 */
function envelope(text, extra = {}) {
	return JSON.stringify({
		type: "file",
		encoding: "base64",
		content: Buffer.from(text, "utf8").toString("base64"),
		...extra,
	});
}

test("gitHubContentsApiUrl：路径按段编码保留斜杠，分支进 query 并编码", () => {
	assert.equal(gitHubContentsApiUrl("resources/extensions/pi-deck-todo.ts", "main"), "https://api.github.com/repos/T-Chen-CN/TC-Pi/contents/resources/extensions/pi-deck-todo.ts?ref=main");
	// 文件名带 # / 空格 / 中文时不能拼出坏 URL（# 会被当 fragment 截断路径）
	assert.equal(gitHubContentsApiUrl("docs/我的 文件#1.md", "main"), "https://api.github.com/repos/T-Chen-CN/TC-Pi/contents/docs/%E6%88%91%E7%9A%84%20%E6%96%87%E4%BB%B6%231.md?ref=main");
	// 分支名带斜杠：必须编码进 query，不能泄进路径
	assert.ok(gitHubContentsApiUrl("README.md", "feat/x").endsWith("?ref=feat%2Fx"));
});

test("gitHubRawFileUrl：仍是 raw 直链（GitHub 侧未被前端接管）", () => {
	assert.equal(gitHubRawFileUrl("resources/pi-ai-catalog.json", "main"), "https://raw.githubusercontent.com/T-Chen-CN/TC-Pi/main/resources/pi-ai-catalog.json");
});

test("repoFileSourceEntries：github 源 raw 优先，其余源 GitHub API 优先，两条都在", () => {
	// 注意：模块经 vm 沙箱加载，其数组原型与测试域不同，deepEqual 会因 realm 不同而误报，故比字符串
	const githubFirst = repoFileSourceEntries("CHANGELOG.md", "main", "github");
	assert.equal(githubFirst.map((entry) => entry.id).join(","), "github,github-api");
	assert.equal(githubFirst[0].url, gitHubRawFileUrl("CHANGELOG.md", "main"));
	assert.equal(githubFirst[1].url, gitHubContentsApiUrl("CHANGELOG.md", "main"));

	for (const source of ["atomgit", "custom"]) {
		const entries = repoFileSourceEntries("CHANGELOG.md", "main", source);
		assert.equal(entries.map((entry) => entry.id).join(","), "github-api,github", `${source} 源应 GitHub API 优先`);
		// 源顺序只决定快慢：两个源始终同时存在，任一失败可换下一个
		assert.equal(entries.length, 2);
	}
});

test("decodeGitHubContentsBuffer：base64 还原为同样的字节（含多字节字符）", () => {
	const text = "内置扩展：中文字符 ✅ ---\n";
	const bytes = decodeGitHubContentsBuffer(envelope(text));
	assert.ok(Buffer.isBuffer(bytes));
	assert.equal(bytes.toString("utf8"), text);
	assert.equal(Buffer.compare(bytes, Buffer.from(text, "utf8")), 0, "字节应逐字节一致（sha256 按字节算）");
});

test("decodeGitHubContentsBuffer：HTML / 目录 / 缺字段一律 null（交调用方换源）", () => {
	assert.equal(decodeGitHubContentsBuffer("<!doctype html><html>GitCode</html>"), null);
	assert.equal(decodeGitHubContentsBuffer(JSON.stringify({ type: "dir", content: "" })), null);
	assert.equal(decodeGitHubContentsBuffer(JSON.stringify({ type: "file" })), null);
	assert.equal(decodeGitHubContentsBuffer("null"), null);
	assert.equal(decodeGitHubContentsBuffer("[1,2,3]"), null);
});

test("decodeGitHubContentsResponse：正常解码，形态异常抛错（由调用方逐源兜底）", () => {
	assert.equal(decodeGitHubContentsResponse(envelope("# 更新日志\n")), "# 更新日志\n");
	// base64 序列里的换行（部分网关会插入）不影响解码
	const wrapped = envelope("hello");
	const payload = JSON.parse(wrapped);
	const withNewlines = JSON.stringify({ ...payload, content: payload.content.replace(/(.{4})/g, "$1\n") });
	assert.equal(decodeGitHubContentsResponse(withNewlines), "hello");

	assert.throws(() => decodeGitHubContentsResponse("<!doctype html>"), /not valid JSON/);
	assert.throws(() => decodeGitHubContentsResponse(JSON.stringify({ type: "dir", content: "" })), /unexpected shape/);
	assert.throws(() => decodeGitHubContentsResponse(JSON.stringify({ type: "file", content: 42 })), /unexpected shape/);
});

// 回归守卫：raw 直链是错的（HTML 壳），任何再拼 host+raw 的写法都应被挡下。
test("源码里不再出现 `${host}/.../raw/` 形式的 GitHub API 拼接", () => {
	const rawPathPattern = /\$\{[^}]+\}\/[^`\s]*\/raw\//;
	const offenders = [];
	for (const dir of ["src/main", "src/shared"]) {
		for (const file of listTsFiles(join(repoRoot, dir))) {
			const source = readFileSync(file, "utf8");
			const match = source.match(rawPathPattern);
			if (match) offenders.push(`${file.replace(repoRoot, ".")}: ${match[0]}`);
		}
	}
	assert.deepEqual(offenders, [], `GitHub API 文件下载应统一走 contents API，实际仍有人拼 raw 直链: ${offenders.join(", ")}`);
});

/** 递归列出目录下的 .ts 文件（跳过 node_modules，正则扫描用）。 */
function listTsFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
		else if (entry.endsWith(".ts")) out.push(full);
	}
	return out;
}
