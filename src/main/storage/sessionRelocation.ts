import { closeSync, existsSync, openSync, readSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { encodeSessionDirName } from "../projects/userDataNameMigration";
import { repairUserDataSessionHeaders } from "../projects/userDataSessionHeaderMigration";

/** Read only the bounded native header; never deserialize or alter message history. */
function sessionCwd(file: string): string | undefined {
	const fd = openSync(file, "r");
	try {
		const buffer = Buffer.alloc(64 * 1024);
		const size = readSync(fd, buffer, 0, buffer.length, 0);
		const newline = buffer.subarray(0, size).indexOf(10);
		if (newline < 0) return undefined;
		const value: unknown = JSON.parse(buffer.toString("utf8", 0, newline));
		return value && typeof value === "object" && "type" in value && value.type === "session" && "cwd" in value && typeof value.cwd === "string" ? value.cwd : undefined;
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

/** Relocate copied installation-owned sessions and return exact directory mappings for catalogs. */
export function relocateInstallationSessions(root: string, mappings: ReadonlyArray<readonly [string, string]>): Array<readonly [string, string]> {
	const result: Array<readonly [string, string]> = [];
	for (const directory of readdirSync(root, { withFileTypes: true })) {
		if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
		const source = join(root, directory.name);
		const files = readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
		for (const [oldRoot, newRoot] of mappings) repairUserDataSessionHeaders(source, oldRoot, newRoot, process.platform, true);
		const cwd = files.map((file) => sessionCwd(join(source, file.name))).find(Boolean);
		if (!cwd) continue;
		const encoded = encodeSessionDirName(cwd);
		if (encoded === directory.name) continue;
		// Only encoded-cwd layouts belong to Pi. Custom session directories retain their names.
		if (!directory.name.startsWith("--") || !directory.name.endsWith("--")) continue;
		const target = join(root, encoded);
		if (!existsSync(target)) renameSync(source, target);
		else
			for (const file of files) {
				const destination = join(target, file.name);
				if (existsSync(destination)) throw new Error("Session relocation collision; source data retained");
				renameSync(join(source, file.name), destination);
			}
		result.push([source, target]);
	}
	const parents: Array<readonly [string, string]> = [...result];
	for (const [from, to] of result) for (const [oldRoot, newRoot] of mappings) if (from.startsWith(newRoot)) parents.unshift([from.replace(newRoot, oldRoot), to]);
	parents.push(...mappings);
	for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) repairUserDataSessionHeaders(join(root, entry.name), root, root, process.platform, true, parents);
	return result;
}
