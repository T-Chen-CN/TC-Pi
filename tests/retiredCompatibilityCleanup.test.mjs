import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("retired backend presentation and image execution modules are absent", () => {
	for (const file of ["src/renderer/src/atoms/ask-echo-atoms.ts", "src/shared/imageGenConfig.ts", "src/shared/imageGenParams.ts", "src/main/images/legacyImages.ts", "src/renderer/src/utils/visionBridgeBlocks.ts", "src/main/compatibility/acpToolConfig.ts"]) assert.equal(existsSync(file), false, file);
});

test("the Pi timeline does not inject DSH ask replies or lock modes for generated-image history", () => {
	const timeline = readFileSync("src/renderer/src/components/session/SessionMessageTimeline.tsx", "utf8");
	const composer = readFileSync("src/renderer/src/hooks/useSessionComposerController.ts", "utf8");
	assert.doesNotMatch(timeline, /injectAskEchoMessage|askEchoBySessionIdAtomFamily/);
	assert.doesNotMatch(composer, /hasImageGenHistory/);
});
