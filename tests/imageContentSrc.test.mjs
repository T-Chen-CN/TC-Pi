import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { imageContentSrc, hasImageSource, loadImageBase64, hydrateImageContents } = loadTsCommonJs("src/shared/imageContentSrc.ts");
test("native Pi image bytes produce a data URL and remain available to clipboard actions", async () => {
	const image = { type: "image", data: "QUJD", mimeType: "image/png" };
	assert.equal(imageContentSrc(image), "data:image/png;base64,QUJD");
	assert.equal(hasImageSource(image), true);
	assert.equal(JSON.stringify(await loadImageBase64(image)), JSON.stringify({ data: "QUJD", mimeType: "image/png" }));
});
test("missing inline bytes and retired references are unavailable", async () => {
	for (const image of [null, undefined, {}, { data: "", mimeType: "image/png" }, { ref: "retired.png", mimeType: "image/png" }]) {
		assert.equal(imageContentSrc(image), null);
		assert.equal(hasImageSource(image), false);
		assert.equal(await loadImageBase64(image), null);
	}
});
test("resending retains native image bytes and discards entries without bytes", async () => {
	const image = { type: "image", data: "QUJD", mimeType: "image/png" };
	assert.equal(JSON.stringify(await hydrateImageContents([image, { type: "image", ref: "retired.png", mimeType: "image/png" }])), JSON.stringify([image]));
	assert.equal(JSON.stringify(await hydrateImageContents(undefined)), "[]");
});
