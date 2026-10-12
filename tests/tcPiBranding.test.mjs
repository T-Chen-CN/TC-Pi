import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));
const require = createRequire(import.meta.url);

test("application and package metadata expose TC-Pi while preserving installed identity", () => {
	const lock = JSON.parse(read("package-lock.json"));
	assert.equal(pkg.name, "tc-pi");
	assert.equal(pkg.build.productName, "TC-Pi");
	assert.match(pkg.description, /^TC-Pi\b/);
	assert.equal(lock.name, pkg.name);
	assert.equal(lock.packages[""].name, pkg.name);
	assert.equal(pkg.build.appId, "com.ayuayue.pi-desktop");
	assert.deepEqual(pkg.build.protocols[0].schemes, ["pideck"]);
	assert.equal(pkg.build.protocols[0].name, "TC-Pi Agent Link");
	assert.equal(pkg.build.icon, "build/icon");
});

test("every UI locale presents TC-Pi across brand, overview and accessibility copy", () => {
	for (const [file, key] of [
		["zh-CN", "zhCN"],
		["en-US", "enUS"],
		["zh-TW", "zhTW"],
	]) {
		const dictionary = loadTsCommonJs(`src/renderer/src/i18n/rendererCopy.${file}.ts`)[key];
		assert.equal(dictionary["app.brandName"], "TC-Pi");
		assert.match(dictionary["overview.brand"], /^TC-Pi\b/);
		assert.match(dictionary["about.title"], /TC-Pi/);
		for (const [copyKey, value] of Object.entries(dictionary)) assert.doesNotMatch(value, /\bPiDeck\b/, `${file}: ${copyKey}`);
	}
});

test("tray and operating-system menu copy use the renamed product in every locale", () => {
	const { mainProcessT } = loadTsCommonJs("src/shared/i18n/mainProcessCopy.ts");
	for (const locale of ["zh-CN", "en-US", "zh-TW"]) {
		for (const key of ["tray.version", "tray.upToDateTitle", "tray.restart", "tray.quit", "shellMenu.openWithPiDeck", "shellMenu.quickTask"]) assert.match(mainProcessT(locale, key, { version: "0.9.1" }), /TC-Pi/);
	}
});

test("desktop startup, Web title and installed PWA expose the same product name", () => {
	assert.match(read("src/renderer/index.html"), /<title>TC-Pi<\/title>/);
	assert.match(read("src/renderer/index.html"), /<strong\s+class="boot-title">TC-Pi<\/strong>/);
	assert.match(read("src/renderer/web.html"), /<title>TC-Pi Web<\/title>/);
	const manifest = JSON.parse(read("src/renderer/public/manifest.webmanifest"));
	assert.equal(manifest.name, "TC-Pi");
	assert.equal(manifest.short_name, "TC-Pi");
});

test("development packages use TC-Pi filenames and retain their upgrade/protocol identity", () => {
	const { buildDevConfig } = require("../scripts/dist-dev.js");
	const config = buildDevConfig(pkg);
	assert.equal(config.productName, "TC-Pi Dev");
	assert.equal(config.appId, "com.ayuayue.pi-desktop-dev");
	assert.deepEqual(config.protocols[0].schemes, ["pideck-dev"]);
	for (const target of ["win", "nsis", "portable", "mac", "linux"]) assert.match(config[target].artifactName, /^TC-Pi-Dev-/);
});

test("rebranding does not relocate existing installed or development user data", () => {
	const paths = loadTsCommonJs("src/main/portableUserData.ts");
	const dev = loadTsCommonJs("src/main/devIsolation.ts");
	assert.equal(paths.PACKAGED_USER_DATA_NAME, "pi-desktop");
	assert.equal(paths.PACKAGED_USER_DATA_NAME_NEW, "PiDeck");
	assert.equal(dev.DEFAULT_DEV_USER_DATA_NAME, "pi-desktop-dev");
});

test("README identifies the new product and preserves the original upstream attribution", () => {
	for (const file of ["README.md", "README.en.md"]) {
		const text = read(file);
		assert.match(text, /^# TC-Pi\s/m);
		assert.match(text, /\[ayuayue\/PiDeck\]\(https:\/\/github\.com\/ayuayue\/PiDeck\)/);
	}
});

test("pixel wordmark supports every character of TC-Pi and retains the original Pi glyphs", () => {
	const { getWordmarkGlyph } = loadTsCommonJs("src/renderer/src/components/app/wordmarkGlyphs.ts");
	for (const character of "TC-Pi") {
		const glyph = getWordmarkGlyph(character);
		assert.ok(glyph, character);
		assert.equal(glyph.length, 7, character);
		assert.ok(glyph.flat().includes(1), character);
		assert.ok(
			glyph.every((row) => row.length === glyph[0].length),
			character,
		);
	}
	assert.deepEqual(Array.from(getWordmarkGlyph("P")[0]), [1, 1, 1, 1, 0]);
	assert.deepEqual(Array.from(getWordmarkGlyph("i")[0]), [1, 1, 0]);
});
