import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./mock-pi-fixture";
import { armStartupOverlayDismissal } from "./startupOverlays";
import { seedMediaSamples } from "./fileFormatFixtures";

const root = mkdtempSync(join(tmpdir(), "pideck-seed-formats-"));
const textSamples = [
	["sample.json", '{"message":"format audit"}\n'],
	["sample.gltf", '{"asset":{"version":"2.0"}}\n'],
	[".gitignore", "node_modules/\n"],
	["UPPER.JSON", '{"message":"format audit"}\n'],
	[".env", 'MESSAGE="format audit"\n'],
	["unknown.custom", "format audit\n"],
	["empty.txt", ""],
	["中文文件.txt", "format audit\n"],
	...["txt", "log", "csv", "graphql", "gql", "ps1"].map((ext) => [`sample.${ext}`, "format audit\n"]),
	...["ts", "tsx", "js", "jsx", "mjs", "cjs"].map((ext) => [`sample.${ext}`, 'const message = "format audit";\n']),
	["sample.jsonc", '{// format audit\n"message":true}\n'],
	...["yaml", "yml"].map((ext) => [`sample.${ext}`, 'message: "format audit"\n']),
	...["css", "scss", "less"].map((ext) => [`sample.${ext}`, "/* format audit */\nbody { color: red; }\n"]),
	["sample.xml", "<message>format audit</message>\n"],
	...["sh", "bash", "zsh"].map((ext) => [`sample.${ext}`, 'echo "format audit"\n']),
	["sample.py", 'message = "format audit"\n'],
	["sample.rb", 'message = "format audit"\n'],
	["sample.go", "package main\n// format audit\n"],
	["sample.rs", "// format audit\nfn main() {}\n"],
	["sample.java", "// format audit\nclass Sample {}\n"],
	...["c", "c++", "cpp", "h", "hpp"].map((ext) => [`sample.${ext}`, "// format audit\nint value = 1;\n"]),
	["sample.sql", "-- format audit\nSELECT 1;\n"],
	["sample.proto", '// format audit\nsyntax = "proto3";\n'],
	...["toml", "ini", "cfg", "env"].map((ext) => [`sample.${ext}`, 'message = "format audit"\n']),
	["Dockerfile", "# format audit\nFROM scratch\n"],
	["Makefile", "# format audit\n"],
];
const renderedSamples = [
	["sample.md", "# format audit\n\nMarkdown **preview**.\n"],
	["sample.mdx", "# format audit\n\nMDX Markdown preview.\n"],
	["sample.html", "<!doctype html><h1>format audit</h1>"],
	["sample.htm", "<!doctype html><h1>format audit</h1>"],
	["sample.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><title>format audit</title><rect width="32" height="32" fill="red"/></svg>'],
];
for (const [name, content] of [...textSamples, ...renderedSamples]) writeFileSync(join(root, name), content);
writeFileSync(join(root, "invalid.json"), '{"message":}');
for (const ext of ["blend", "glb", "docx", "xlsx", "pptx", "zip", "mp3", "mp4"]) writeFileSync(join(root, `unsupported.${ext}`), Buffer.from([0x42, 0, 0xff, 0x54]));
test.use({ seedProjects: [{ id: "format-audit", name: "format-audit", path: root }], seedSettings: { language: "zh-CN", theme: "light", maxEditorFileSizeMB: 5 } });

test.beforeEach(async ({ window }) => {
	window.on("pageerror", (error) => process.stderr.write(`format audit page error: ${error.message}\n`));
	window.on("requestfailed", (request) => process.stderr.write(`format audit request failed: ${request.url()} ${request.failure()?.errorText}\n`));
	// 同一隔离 Electron profile 可额外验收正在运行的开发服务器，避免操纵用户窗口。
	if (process.env.PIDECK_FORMATS_RENDERER_URL) {
		await window.goto(process.env.PIDECK_FORMATS_RENDERER_URL);
		await armStartupOverlayDismissal(window);
	}
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 30_000 });
	await seedMediaSamples(window, root);
	await window.getByRole("button", { name: "选择工作区", exact: true }).click();
	await window.getByTestId("workspace-inline-list").getByRole("button", { name: "format-audit", exact: true }).click();
});

test("JSON and gitignore open without a late editor module fetch taking down the application", async ({ window }) => {
	const errors: string[] = [];
	window.on("pageerror", (error) => errors.push(error.message));
	// 复现用户遇到的延迟模块请求失败；核心文本编辑器应在启动时已就绪。
	await window.route("**/*CodeMirrorEditor*", (route) => route.abort("failed"));
	const files = window.getByTestId("file-region");
	for (const name of ["sample.json", ".gitignore"]) {
		await window.getByTestId("workspace-file-explorer").getByText(name, { exact: true }).click();
		await expect(files.locator(".cm-content:visible")).toBeVisible();
		await expect(window.getByText("界面渲染异常", { exact: true })).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});

test("every advertised text language opens, edits and saves through the central file tree", async ({ window }) => {
	test.setTimeout(180_000);
	const errors: string[] = [];
	window.on("pageerror", (error) => errors.push(error.message));
	const files = window.getByTestId("file-region");
	for (const [name, content] of textSamples) {
		await test.step(name, async () => {
			await window.getByTestId("workspace-file-explorer").getByText(name, { exact: true }).click();
			const editor = files.locator(".cm-content:visible");
			await expect(editor.locator(".cm-line")).toHaveText(content.split("\n"));
			await editor.click();
			await window.keyboard.press("ControlOrMeta+End");
			await window.keyboard.press("Enter");
			await window.keyboard.insertText("format edit audit");
			await window.keyboard.press("ControlOrMeta+s");
			await expect.poll(() => readFileSync(join(root, name), "utf8")).toBe(content + "\nformat edit audit");
			await files.getByRole("button", { name: `关闭标签页 ${name}`, exact: true }).click();
			// 样本跨测试共享，仅恢复自己的临时文件内容。
			writeFileSync(join(root, name), content);
		});
	}
	expect(errors).toEqual([]);
});

test("Markdown, HTML and SVG preview, switch to source, edit and save", async ({ window }) => {
	const files = window.getByTestId("file-region");
	for (const [name, content] of renderedSamples) {
		await test.step(name, async () => {
			await window.getByTestId("workspace-file-explorer").getByText(name, { exact: true }).click();
			if (/\.mdx?$/.test(name)) await expect(files.getByRole("heading", { name: "format audit", exact: true })).toBeVisible();
			else if (/\.html?$/.test(name)) await expect(files.frameLocator('iframe[title="HTML 预览"]').getByRole("heading", { name: "format audit" })).toBeVisible();
			else await expect.poll(() => files.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 32)).toBe(true);
			await files.getByRole("button", { name: "源码", exact: true }).click();
			const editor = files.locator(".cm-content:visible");
			await expect(editor.locator(".cm-line")).toHaveText(content.split("\n"));
			await editor.click();
			await window.keyboard.press("ControlOrMeta+End");
			await window.keyboard.press("Enter");
			await window.keyboard.insertText("format edit audit");
			await window.keyboard.press("ControlOrMeta+s");
			await expect.poll(() => readFileSync(join(root, name), "utf8")).toBe(content + "\nformat edit audit");
			await files.getByRole("button", { name: `关闭标签页 ${name}`, exact: true }).click();
			writeFileSync(join(root, name), content);
		});
	}
});

test("every advertised image format is decoded, rather than merely mounting an img element", async ({ window }) => {
	const files = window.getByTestId("file-region");
	for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]) {
		await test.step(ext, async () => {
			const name = `sample.${ext}`;
			await window.getByTestId("workspace-file-explorer").getByText(name, { exact: true }).click();
			const image = files.getByRole("img", { name, exact: true });
			await expect(image).toBeVisible();
			await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === (element.alt.endsWith(".gif") ? 1 : 32))).toBe(true);
			await expect(files.locator(".cm-editor")).toHaveCount(0);
			await files.getByRole("button", { name: `关闭标签页 ${name}`, exact: true }).click();
		});
	}
});

test("PDF displays its actual page in Chromium's native viewer", async ({ window, app }) => {
	await window.getByTestId("workspace-file-explorer").getByText("sample.pdf", { exact: true }).click();
	const preview = window.getByTestId("file-region").locator('iframe[title="PDF 预览"]');
	await expect(preview).toBeVisible();
	// Chromium PDF guest 的 DOM 不属于公开的 webContents；直接检查已绘制页面。
	// 样本仅一页白纸与黑色标题，检查正文区域的纸张/字形，避开顶部工具条。
	await expect
		.poll(async () => {
			const bytes = Array.from(await preview.screenshot());
			return app.evaluate(({ nativeImage }, imageBytes) => {
				const image = nativeImage.createFromBuffer(Buffer.from(imageBytes));
				const { width, height } = image.getSize();
				const bitmap = image.toBitmap();
				let paper = 0;
				let glyphs = 0;
				for (let y = Math.floor(height * 0.2); y < height * 0.65; y++) {
					for (let x = Math.floor(width * 0.4); x < width - 20; x++) {
						const pixel = (y * width + x) * 4;
						const sum = bitmap[pixel] + bitmap[pixel + 1] + bitmap[pixel + 2];
						if (sum > 750) paper++;
						if (sum < 90) glyphs++;
					}
				}
				return paper > 10_000 && glyphs > 100;
			}, bytes);
		})
		.toBe(true);
	await expect(window.getByTestId("file-region").locator(".cm-editor:visible")).toHaveCount(0);
	await window.screenshot({ path: ".tmp/workspace-layout/format-audit-pdf.png" });
});

test("unsupported binary formats stay out of the text editor and preserve their bytes", async ({ window }) => {
	const files = window.getByTestId("file-region");
	for (const ext of ["blend", "glb", "docx", "xlsx", "pptx", "zip", "mp3", "mp4"]) {
		const name = `unsupported.${ext}`;
		await window.getByTestId("workspace-file-explorer").getByText(name, { exact: true }).click();
		await expect(files.getByText(`${ext} 是二进制文件，不支持编辑`, { exact: true })).toBeVisible();
		await expect(files.locator(".cm-editor")).toHaveCount(0);
		expect(readFileSync(join(root, name))).toEqual(Buffer.from([0x42, 0, 0xff, 0x54]));
		await files.getByRole("button", { name: `关闭标签页 ${name}`, exact: true }).click();
	}
});

test("invalid JSON is diagnosed locally while JSONC comments are accepted", async ({ window }) => {
	const files = window.getByTestId("file-region");
	await window.getByTestId("workspace-file-explorer").getByText("invalid.json", { exact: true }).click();
	await expect(files.locator(".cm-lint-marker-error:visible").first()).toBeVisible();
	await window.getByTestId("workspace-file-explorer").getByText("sample.jsonc", { exact: true }).click();
	await expect(files.locator(".cm-content:visible")).toBeVisible();
	// CodeMirror 的默认 lint delay 为 750ms，检查最终诊断而不是尚未运行的瞬态。
	await window.waitForTimeout(1000);
	await expect(files.locator(".cm-lint-marker-error:visible")).toHaveCount(0);
	await expect(window.getByText("界面渲染异常", { exact: true })).toHaveCount(0);
});
