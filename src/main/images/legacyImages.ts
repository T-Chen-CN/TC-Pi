import { ipcMain, protocol } from "electron";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ipcChannels } from "../../shared/ipc";
import type { ImageBlobPayload } from "../../shared/types/imagegen";

const MAX_BYTES = 32 * 1024 * 1024;
const REF_PATTERN = /^[0-9a-f]{64}\.(png|jpe?g|webp|gif|bmp|avif)$/;

/** Reads previously saved attachments without starting or configuring image generation. */
export async function readLegacyImage(root: string, ref: unknown): Promise<ImageBlobPayload | null> {
	if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return null;
	try {
		const path = join(root, ref);
		const info = await lstat(path);
		if (!info.isFile() || info.size > MAX_BYTES) return null;
		const bytes = await readFile(path);
		if (bytes.length > MAX_BYTES) return null;
		const extension = ref.slice(ref.lastIndexOf(".") + 1);
		const mimeType = `image/${extension === "jpg" ? "jpeg" : extension}`;
		return { data: bytes.toString("base64"), mimeType };
	} catch {
		return null;
	}
}

export function registerLegacyImages(root: string): void {
	ipcMain.handle(ipcChannels.imagesReadBlob, (_event, ref: unknown) => readLegacyImage(root, ref));
	protocol.handle("pideck-img", async (request) => {
		try {
			const url = new URL(request.url);
			if (url.hostname !== "blob") return new Response("forbidden", { status: 403 });
			const image = await readLegacyImage(root, decodeURIComponent(url.pathname.slice(1)));
			if (!image) return new Response("not found", { status: 404 });
			return new Response(Buffer.from(image.data, "base64"), { headers: { "Content-Type": image.mimeType } });
		} catch {
			return new Response("forbidden", { status: 403 });
		}
	});
}
