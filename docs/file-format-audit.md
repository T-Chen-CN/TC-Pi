# 中央文件区域格式验收

状态：已通过开发版与构建版验收（2026-10-11，`feat/file-preview-workbench`）；修改尚未提交。

验收从左侧文件树进入中央区域，使用隔离 Electron profile 与合成文件，检查实际内容、编辑、保存后的磁盘字节，以及图片解码和 PDF 页面绘制。格式声明与源码分支不单独作为通过依据。

| 格式 | 实际能力 | 验收方式 |
| --- | --- | --- |
| JSON、JSONC、YAML/YML、XML、TOML、INI、CFG、ENV | 查看源码、编辑、保存；JSON 有严格语法诊断，JSONC 不套用严格 JSON 校验 | 逐个打开、编辑、保存、比对磁盘；无效 JSON 与带注释 JSONC 单独检查 |
| JS/JSX/MJS/CJS、TS/TSX、CSS/SCSS/LESS | 查看源码、编辑、保存、语言高亮 | 逐个编辑保存 |
| Python、Ruby、Go、Rust、Java、C/C++/H/HPP、SQL、Proto、SH/Bash/Zsh、Dockerfile | 查看源码、编辑、保存、语言高亮 | 逐个编辑保存 |
| TXT、LOG、CSV、GraphQL/GQL、PowerShell、Makefile、`.gitignore`、未知文本后缀、GLTF | 纯文本查看、编辑、保存 | 逐个编辑保存；CSV 不渲染表格，GLTF 不渲染三维模型 |
| MD、MDX | Markdown 预览、切源码编辑保存 | 预览标题、切源码、编辑保存；MDX 不执行 React/JSX |
| HTML、HTM | 沙箱预览、切源码编辑保存 | 检查 iframe 内标题及保存；相对路径资源不自动映射到工作区 |
| SVG | 图片预览、切源码编辑保存 | 检查图像实际解码尺寸及保存 |
| PNG、JPG、JPEG、GIF、WebP、BMP、ICO | 图片预览 | 检查 `complete` 和 `naturalWidth`；不挂文本编辑器 |
| PDF | Chromium 原生阅读器预览 | 检查实际绘制的纸张/字形并核对截图；不支持文档编辑 |
| BLEND、GLB、DOCX、XLSX、PPTX、ZIP、MP3、MP4 | 不支持内置预览/编辑 | 检查内联提示、无文本编辑器、原始字节未变 |

另验收大写 JSON 后缀、隐藏配置、中文文件名、无扩展名和空文件。61 个可用文件样本中，53 个验证了编辑保存；8 个图片/PDF 样本验证了实际预览。无效 JSON 和 8 个不支持的二进制样本另测。

边界：文本读取按 UTF-8；文件大小默认上限 5 MiB，可在开发者设置中调整。未知后缀只允许按文本尝试读取，不能据此宣称支持任意二进制文件或专有格式。语言高亮不是编译、运行或全面语法校验。

本次修复：核心编辑器从 `React.lazy` 改为随工作台加载，避免首次打开文件的延迟模块失败缓存到应用级错误边界；renderer 使用独立预构建缓存，并在启动阶段预构建所有编辑器依赖。诊断中原开发服务的 CodeMirror deps 请求返回 504，具体导致旧共享缓存失效的外部入口未确认。图片/PDF 不再额外挂空文本编辑器；BLEND/GLB 加入二进制拦截；JSON 诊断按输入语言 id 判定，不依赖语言包的空 `language.name`。

回归入口：`e2e/file-format-support.spec.ts`；开发版指定 `PIDECK_FORMATS_RENDERER_URL`，默认验证 `out/renderer` 构建产物。`tests/fileFormatSupport.test.mjs`、`tests/editorDependencyPrebuild.test.mjs` 与既有编辑器测试保护格式分类和预构建配置。

验证结果：类型检查、格式检查、`build:fast`、29 项针对性单测通过。完整格式矩阵在开发版与构建版各通过 7 项端到端测试；重新启动完整开发版后，实际 5281 服务再次通过 JSON/`.gitignore` 检查；Git 差异、工作区文件历史、工具宽度、保存失败保护共 4 项回归通过，合计 19 项端到端检查。PDF 页面截图已核对。

取舍：核心编辑器提前加载使主入口未压缩 JS 从约 4.18 MB 增至 5.80 MB，换取文件主入口不再依赖首次打开时的延迟模块请求；差异渲染及其 Shiki/WASM 依赖继续按需加载。未测量启动时延，不能据此宣称性能无变化。
