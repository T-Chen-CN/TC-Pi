/**
 * mirrorHealth 更新镜像体检纯逻辑单测。
 * 守护：探测协议（latest.yml 检测 + Range 206 下载预检）、速度分级（ok/slow 阈值 300KB/s）、
 * 各类失败收成 broken 且不抛异常。全部用 fake fetch，不依赖真实网络。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

/** 用 TypeScript transpileModule 加载 TS 源码（项目测试惯例，见 updateSources.test.mjs）。 */
function loadTsModule(filePath, deps) {
	const source = readFileSync(filePath, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: filePath,
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		output,
		{
			module,
			exports: module.exports,
			require: (name) =>
				deps[name] ??
				(() => {
					throw new Error(`unexpected require: ${name}`);
				})(),
			console,
			AbortSignal, // vm 沙箱默认无 AbortSignal，probeMirrorHealth 用 AbortSignal.timeout
		},
		{ filename: filePath },
	);
	return module.exports;
}

const shared = loadTsModule("src/shared/updateSources.ts", {});
const mirrorHealth = loadTsModule("src/main/update/mirrorHealth.ts", {
	"../../shared/updateSources": shared,
});
const { probeMirrorHealth, probeAllMirrors, resolveProbeFileName, SLOW_THRESHOLD_KBPS, PROBE_RANGE_BYTES, PROBE_TIMEOUT_MS } = mirrorHealth;

const MIRROR = { id: "atomgit", host: "https://atomgit.com" };

/**
 * 构造 fake fetch：按 URL 尾部分发 yml / 分片请求，用可控延时推进模拟时钟。
 * 返回 { fetchImpl, clock }；clock.now 记录「当前时刻」，测速 = 分片字节数 / 分片耗时。
 */
function makeFetch(options = {}) {
	const { ymlStatus = 200, ymlBody = "version: 0.7.3\nreleaseDate: 2026-09-03T16:04:00.000Z\n", dlStatus = 206, dlBytes = PROBE_RANGE_BYTES, ymlDelay = 100, dlDelay = 500, throwError = null } = options;
	const clock = { now: 0 };
	const fetchImpl = async (url, _opts) => {
		if (throwError) {
			clock.now += ymlDelay;
			throw throwError;
		}
		if (url.endsWith("/latest.yml")) {
			clock.now += ymlDelay;
			return new Response(ymlBody, { status: ymlStatus });
		}
		clock.now += dlDelay;
		return new Response(new Uint8Array(dlBytes), { status: dlStatus });
	};
	return { fetchImpl, clock };
}

test("探测协议：latest.yml 200 + Range 206 且速度达标 → ok，速度取分片字节/耗时", async () => {
	const { fetchImpl, clock } = makeFetch({ dlDelay: 500 }); // 256KB/500ms = 524KB/s > 阈值
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "ok");
	assert.equal(result.speedKBps, 524);
	assert.equal(result.latencyMs, 100);
	assert.equal(result.id, "atomgit");
	assert.equal(result.error, undefined);
});

test("速度低于阈值 → slow（模拟 ghproxy.net 分片段 ~230KB/s）", async () => {
	const { fetchImpl, clock } = makeFetch({ dlDelay: 1000 }); // 256KB/1000ms = 262KB/s < 300
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "slow");
	assert.equal(result.speedKBps, 262);
	assert.ok(SLOW_THRESHOLD_KBPS > 262 && SLOW_THRESHOLD_KBPS <= 524, "阈值应落在 ok/slow 两用例之间");
});

test("latest.yml 非 200 → broken，保留响应码原因", async () => {
	const { fetchImpl, clock } = makeFetch({ ymlStatus: 404 });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
	assert.match(result.error, /HTTP 404/);
	assert.equal(result.speedKBps, 0);
	// 检测失败不应继续下载预检（时钟只推进了 yml 延时）
	assert.equal(clock.now, 100);
});

test("latest.yml 内容解析不出版本号 → broken（镜像返回了页面而非 feed）", async () => {
	const { fetchImpl, clock } = makeFetch({ ymlBody: "<html>403 Forbidden</html>" });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
	assert.match(result.error, /格式异常/);
});

test("下载预检非 206（镜像不支持 Range / 直接返回 200 全量）→ broken", async () => {
	const { fetchImpl, clock } = makeFetch({ dlStatus: 200 });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
	assert.match(result.error, /HTTP 200/);
});

test("分片字节数过小（<1KB，疑似错误页）→ broken", async () => {
	const { fetchImpl, clock } = makeFetch({ dlBytes: 512, dlStatus: 206 });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
});

test("fetch 超时（AbortError）→ broken，原因「连接超时」", async () => {
	const abortError = new Error("signal is aborted without reason");
	abortError.name = "TimeoutError"; // AbortSignal.timeout 在 Node 中 reject 的 name
	const { fetchImpl, clock } = makeFetch({ throwError: abortError });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
	assert.equal(result.error, "连接超时");
});

test("fetch 网络错误 → broken，原因「连接失败」（不向外抛）", async () => {
	const { fetchImpl, clock } = makeFetch({ throwError: new TypeError("fetch failed") });
	const result = await probeMirrorHealth(fetchImpl, MIRROR, () => clock.now);
	assert.equal(result.status, "broken");
	assert.equal(result.error, "连接失败");
});

test("probeAllMirrors：TC-Pi 没有配置镜像时不请求原作者的源", async () => {
	let calls = 0;
	const results = await probeAllMirrors(async () => {
		calls += 1;
		throw new Error("Unexpected mirror request");
	});
	assert.equal(results.length, 0);
	assert.equal(calls, 0);
});

test("探测加超时保护：单请求最坏耗时不超过 PROBE_TIMEOUT_MS", () => {
	assert.equal(PROBE_TIMEOUT_MS, 10_000);
	assert.ok(PROBE_RANGE_BYTES >= 256 * 1024, "分片应至少 256KB 才有测速意义");
});

test("resolveProbeFileName：优先从 files[].url 提取 setup.exe 文件名", () => {
	const yml = `version: 0.8.0
files:
  - url: PiDeck-0.8.0-setup.exe
    sha512: abc
  - url: PiDeck-0.8.0-portable.exe
    sha512: def
path: PiDeck-0.8.0-setup.exe
`;
	assert.equal(resolveProbeFileName(yml), "PiDeck-0.8.0-setup.exe");
});

test("resolveProbeFileName：支持带路径与查询串的 URL，清洗非法字符", () => {
	const ymlWithPath = `version: 0.8.1
files:
  - url: releases/download/v0.8.1/PiDeck-0.8.1-setup.exe?token=xyz
`;
	assert.equal(resolveProbeFileName(ymlWithPath), "PiDeck-0.8.1-setup.exe");

	// 包含路径穿越字符应触发回退
	const ymlEvil = `version: 0.8.2
files:
  - url: ../../etc/passwd
`;
	assert.equal(resolveProbeFileName(ymlEvil), "TC-Pi-0.8.2-setup.exe");
});

test("resolveProbeFileName：无 url 列表时按 version 规范回退", () => {
	const ymlSimple = `version: 0.9.0\nreleaseDate: 2026-09-03\n`;
	assert.equal(resolveProbeFileName(ymlSimple), "TC-Pi-0.9.0-setup.exe");

	const ymlEmpty = ``;
	assert.equal(resolveProbeFileName(ymlEmpty), "TC-Pi-setup.exe");
});

test("resolveProbeFileName：标准 files 列表读取 TC-Pi 名称，不从版本猜测", () => {
	assert.equal(resolveProbeFileName("version: 0.9.1\nfiles:\n  - url: TC-Pi-0.9.1-win-x64-setup.exe\n"), "TC-Pi-0.9.1-win-x64-setup.exe");
});

test("resolveProbeFileName：改名后仍尊重历史 PiDeck 安装包 URL", () => {
	assert.equal(resolveProbeFileName("version: 0.9.1\nfiles:\n  - url: PiDeck-0.9.1-win-x64-setup.exe\n"), "PiDeck-0.9.1-win-x64-setup.exe");
});
