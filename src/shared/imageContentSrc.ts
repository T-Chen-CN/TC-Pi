import type { ImageContent } from "./types/session";
/** Resolve Pi's native inline image content without a legacy file protocol. */
export function imageContentSrc(image: Pick<ImageContent, "data" | "mimeType"> | null | undefined): string | null {
	return image?.data ? `data:${image.mimeType};base64,${image.data}` : null;
}
/** Missing or empty inline bytes are never rendered as a broken image. */
export function hasImageSource(image: Pick<ImageContent, "data"> | null | undefined): boolean {
	return Boolean(image?.data);
}
/** Return inline bytes used by image clipboard and download actions. */
export async function loadImageBase64(image: ImageContent | null | undefined): Promise<Pick<ImageContent, "data" | "mimeType"> | null> {
	return image?.data ? { data: image.data, mimeType: image.mimeType } : null;
}
/** Only native images with bytes can be attached when resending a message. */
export async function hydrateImageContents(images: readonly ImageContent[] | undefined): Promise<ImageContent[]> {
	return (images ?? []).filter((image) => Boolean(image.data)).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
