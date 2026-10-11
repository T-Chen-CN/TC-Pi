/** Hash the inline image bytes snapshot to reject stale single-image edits. */
export async function imageContentHash(data: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
