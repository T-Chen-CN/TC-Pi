import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** 生成可被浏览器真实解码的合成样本，避免只检查后缀或依赖用户文件。 */
export async function seedMediaSamples(window: Page, root: string): Promise<void> {
	const rasterSamples = await window.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Cannot create raster fixture");
		context.fillStyle = "#ff0000";
		context.fillRect(0, 0, 32, 32);
		return ["png", "jpeg", "webp"].map((format) => ({ format, base64: canvas.toDataURL(`image/${format}`).split(",")[1] }));
	});
	for (const { format, base64 } of rasterSamples) {
		writeFileSync(join(root, `sample.${format}`), Buffer.from(base64, "base64"));
		if (format === "jpeg") writeFileSync(join(root, "sample.jpg"), Buffer.from(base64, "base64"));
		if (format === "png") {
			const png = Buffer.from(base64, "base64");
			const header = Buffer.alloc(22);
			header.writeUInt16LE(1, 2);
			header.writeUInt16LE(1, 4);
			header[6] = header[7] = 32;
			header.writeUInt16LE(1, 10);
			header.writeUInt16LE(32, 12);
			header.writeUInt32LE(png.length, 14);
			header.writeUInt32LE(22, 18);
			writeFileSync(join(root, "sample.ico"), Buffer.concat([header, png]));
		}
	}
	const bmp = Buffer.alloc(54 + 32 * 32 * 3);
	bmp.write("BM");
	bmp.writeUInt32LE(bmp.length, 2);
	bmp.writeUInt32LE(54, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(32, 18);
	bmp.writeInt32LE(32, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(24, 28);
	for (let i = 54; i < bmp.length; i += 3) bmp[i + 2] = 255;
	writeFileSync(join(root, "sample.bmp"), bmp);
	writeFileSync(join(root, "sample.gif"), Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
	writeFileSync(join(root, "sample.pdf"), createPdfSample());
}

/** 单页 PDF 含可搜索文字；xref 按实际字节计算，不以错误文件冒充 PDF 支持。 */
function createPdfSample(): Buffer {
	const stream = "BT /F1 24 Tf 40 200 Td (FORMAT AUDIT PDF) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [i, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf);
}
