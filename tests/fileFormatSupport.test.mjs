import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { isTextFile, isBinaryExtension, isImageFile, isPdfFile } = loadTsCommonJs("src/renderer/src/utils/isTextFile.ts");

test("image and PDF formats are previewable but excluded from text editing", () => {
	for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf"]) {
		assert.equal(isTextFile(`sample.${extension}`), false);
		assert.equal(isImageFile(`sample.${extension}`), extension !== "pdf");
		assert.equal(isPdfFile(`sample.${extension}`), extension === "pdf");
	}
});

test("Blender and binary glTF files cannot be opened as UTF-8 editable text", () => {
	for (const path of ["model.blend", "model.glb", "MODEL.GLB"]) {
		assert.equal(isBinaryExtension(path), true, path);
		assert.equal(isTextFile(path), false, path);
		assert.equal(isImageFile(path), false, path);
	}
});

test("hidden config, extensionless files and textual glTF remain editable", () => {
	for (const path of [".gitignore", ".env", "Dockerfile", "Makefile", "file.json", "file.JSON", "model.gltf", "unknown.custom", "中文文件.txt"]) assert.equal(isTextFile(path), true, path);
});
