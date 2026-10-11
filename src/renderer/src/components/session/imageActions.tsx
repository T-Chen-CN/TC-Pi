import { Check, Copy, Download, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { ImageContent } from "../../../../shared/types";
import { loadImageBase64 } from "../../../../shared/imageContentSrc";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { writeClipboardImage } from "../../utils/clipboard";
import { showNotice } from "../../utils/notice";

/** 图片 MIME → 下载扩展名：避免 jpeg 被存成 .png；生图 provider 偶发 octet-stream 兜底 png。 */
function imageDownloadExt(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "image/gif") return "gif";
	return "png";
}

export function ImageActionButtons(props: { image: ImageContent | null | undefined; className?: string; onRemove?: () => void }) {
	const [copied, setCopied] = useState(false);
	// ref 形态的按需取回通道：仅历史生图/落盘引用会走到，普通上传图片在内联分支短路
	/** 取回可复制/可下载的 data URL；内联与 ref 都取不到时返回 null（由调用方提示失败）。 */
	const loadImageDataUrl = useCallback(async (): Promise<string | null> => {
		const payload = await loadImageBase64(props.image);
		if (!payload?.data) return null;
		// 部分 provider 返回 application/octet-stream，但字节仍是 PNG/JPEG：展示/复制统一用图片 MIME 兜底
		const mimeType = payload.mimeType?.startsWith("image/") ? payload.mimeType : "image/png";
		return `data:${mimeType};base64,${payload.data}`;
	}, [props.image]);

	const copyImage = async () => {
		try {
			// 不用 fetch(data:...)（CSP 拦截）；统一走 writeClipboardImage，避免 Electron 失焦时 ClipboardItem 静默失败
			const dataUrl = await loadImageDataUrl();
			if (!dataUrl) throw new Error("Image payload is empty");
			const written = await writeClipboardImage(dataUrl);
			if (!written) throw new Error("Clipboard write rejected");
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			showNotice(t("image.copyFailed"), 2000, "error");
		}
	};

	const saveImage = () => {
		void loadImageDataUrl().then((dataUrl) => {
			if (!dataUrl) {
				showNotice(t("image.saveFailed"), 2000, "error");
				return;
			}
			const link = document.createElement("a");
			link.href = dataUrl;
			const ext = imageDownloadExt(props.image?.mimeType ?? "");
			link.download = `pideck-image-${Date.now()}.${ext}`;
			link.click();
		});
	};

	return (
		<div className={`flex items-center overflow-hidden rounded-md border border-border/70 bg-background/85 shadow-sm backdrop-blur-sm ${props.className ?? ""}`}>
			<Button variant="ghost" size="icon-sm" className="size-7 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground" type="button" onClick={() => void copyImage()} title={t("image.copy")} aria-label={t("image.copy")}>
				{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
			</Button>
			<Button variant="ghost" size="icon-sm" className="size-7 rounded-none border-l border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground" type="button" onClick={saveImage} title={t("image.save")} aria-label={t("image.save")}>
				<Download size={14} aria-hidden="true" />
			</Button>
			{props.onRemove && (
				<Button variant="ghost" size="icon-sm" className="size-7 rounded-none border-l border-border/60 text-muted-foreground hover:bg-muted hover:text-destructive" type="button" onClick={props.onRemove} title={t("message.removeImage")} aria-label={t("message.removeImage")}>
					<Trash2 size={14} aria-hidden="true" />
				</Button>
			)}
		</div>
	);
}
