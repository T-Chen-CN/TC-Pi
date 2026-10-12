import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { FileSearchResult, PiConfigFileTree } from "../../shared/types";
import type { FileSystemService } from "../fs/FileSystemService";
import { isPathInsideProject } from "../fs/FileSystemService";
import { createProjectFileReadBoundary, resolveProjectFileReadPath, resolveProjectFileWritePath, type ProjectFileReadBoundary } from "./projectFileAccess";
import { isPiConfigRelativePath } from "./piConfigFilePolicy";

/** 全局配置文件的可信根和访问策略。根由 ConfigManager 提供，不能从 IPC 参数指定。 */
export class PiConfigFilesService {
	constructor(
		private readonly getConfigDir: () => string,
		private readonly fileSystem: FileSystemService,
	) {}

	private root(): string {
		const root = this.getConfigDir();
		if (!isAbsolute(root)) throw new Error("INVALID_PI_CONFIG_DIRECTORY");
		return resolve(root);
	}

	private assertAllowed(root: string, path: string): void {
		if (!isAbsolute(path) || !isPathInsideProject(root, path) || !isPiConfigRelativePath(relative(root, path))) throw new Error("PI_CONFIG_FILE_NOT_ALLOWED");
	}

	/** ConfigManager 的目录本身可以是软链，文件树返回的真实根也属于同一授权域。 */
	private assertBoundaryPath(boundary: ProjectFileReadBoundary, path: string): void {
		if (isPathInsideProject(boundary.projectRoot, path)) this.assertAllowed(boundary.projectRoot, path);
		else this.assertAllowed(boundary.canonicalRoot, path);
	}

	/** 每次访问重新定位实际根，环境切换后的旧路径不能沿用旧授权。 */
	async boundary(): Promise<ProjectFileReadBoundary> {
		return createProjectFileReadBoundary(this.root());
	}

	/** 路径的词法位置和 realpath 都必须属于配置资源，不能用链接绕过 auth.json 排除。 */
	async readPath(path: string, boundary?: ProjectFileReadBoundary): Promise<string> {
		const root = boundary ?? (await this.boundary());
		this.assertBoundaryPath(root, path);
		const canonical = await resolveProjectFileReadPath(root, path);
		this.assertAllowed(root.canonicalRoot, canonical);
		return canonical;
	}

	/** 新建目标沿最近的真实父目录授权；删除、重命名和移动不允许作用于整个配置根。 */
	async writePath(path: string, destructive = false): Promise<string> {
		const root = await this.boundary();
		this.assertBoundaryPath(root, path);
		const canonical = await resolveProjectFileWritePath(root, path);
		this.assertAllowed(root.canonicalRoot, canonical);
		if (destructive && canonical === root.canonicalRoot) throw new Error("PI_CONFIG_ROOT_PROTECTED");
		return canonical;
	}

	/** 可从 OS 导入文件，但不能借复制把 pi 管理的认证文件或整个配置根导出成普通资源。 */
	async copySourcePath(path: string): Promise<string> {
		if (!isAbsolute(path)) throw new Error("Invalid file path");
		const root = await this.boundary();
		const source = await realpath(path);
		if (isPathInsideProject(root.canonicalRoot, source)) {
			this.assertAllowed(root.canonicalRoot, source);
			if (source === root.canonicalRoot) throw new Error("PI_CONFIG_ROOT_PROTECTED");
		}
		return source;
	}

	/** 懒加载只列当前层；不存在的配置目录显示空树，不因浏览行为创建配置。 */
	async list(directory?: string): Promise<PiConfigFileTree> {
		const rootPath = this.root();
		try {
			const boundary = await this.boundary();
			const current = await this.readPath(directory ?? rootPath, boundary);
			const files = await this.fileSystem.listTree(boundary.canonicalRoot, 0, current, isPiConfigRelativePath);
			return { rootPath: boundary.canonicalRoot, files };
		} catch (error) {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { rootPath, files: [] };
			throw error;
		}
	}

	/** 扫描前排除运行时目录，沿用文件搜索的结果数量、目录大小与时间预算。 */
	async search(query: string): Promise<FileSearchResult[]> {
		const root = this.root();
		const results = await this.fileSystem.searchNames(root, query, isPiConfigRelativePath);
		return results;
	}
}
