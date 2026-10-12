# 安装目录内的运行环境

状态：实现完成，Windows 核心验收通过，随 v0.9.2 交付。基线 `ba5e1ac7`；旧数据原件保留。

## 目标与边界

TC-Pi 管理的运行时、配置、授权、会话、浏览器数据、缓存、日志和临时文件集中到安装目录。Pi 仍负责凭据及 Agent 循环；项目源码、项目自带配置和外部软件保持原归属。开发版使用项目内隔离目录。目录不可写时明确失败，不回退到 AppData。

## 能力对照与门禁

| 能力 | 原位置 | 目标 | 门禁 |
| --- | --- | --- | --- |
| 桌面配置、目录与草稿 | AppData/PiDeck、开发分支目录 | data/desktop | 首启、恢复、分支隔离、旧数据不覆盖新数据 |
| 浏览器数据 | userData 下 Chromium 目录 | data/browser | cookies、localStorage、partition；ready 前配置 |
| Pi 配置、授权、会话、资源 | ~/.pi/agent | data/pi | RPC、认证、增强、扫描、导入、预热池同源；凭据仅 Pi 写 |
| Node/Pi/Git/shell | 全局安装或 userData/pi-runtime | runtimes | 无全局依赖的 Windows 用户仍可启动和工具往返 |
| 语音运行时 | userData/voice-runtime | runtimes/voice | 既有模型检测与按需安装 |
| 缓存、日志、临时文件 | AppData、系统临时目录 | data/cache、logs、temp | 下载、npm、jiti、模型 trace、更新器均纳入 |
| 首次迁移 | 桌面目录及共享 Pi | 新目录 | 幂等、路径重写、失败不切换、保留原件、凭据通过 Pi |
| 安装升级卸载 | NSIS 默认整目录清理 | 仅替换程序；保留 data/runtimes | 首装、覆盖升级、更新器升级、卸载保留数据 |
| 目录移动 | 多处绝对路径 | 启动时按根重新定位 | 移动后配置、资源、历史引用可恢复 |

## 阶段

1. 单一纯路径契约、启动装配、进程环境与独立 Pi 路径。
2. 接入配置、资源、扫描、导入、运行时安装、Git、更新缓存。
3. 迁移与路径重定位、安装升级保护。
4. 针对性测试、类型/格式/全量测试、构建及隔离桌面验收。

以下记录已完成的验证；跨平台整包验证不算作本次完成范围。

## 实际行为

Windows 安装版与便携版都采用可写的程序目录：

```text
TC-Pi/
  TC-Pi.exe
  resources/                 随包资源与 Electron 依赖
  runtimes/                  Node、Pi、Git、语音运行时
  data/
    desktop/                 桌面设置、工作区、会话目录、草稿
    pi/                      Pi 设置、授权、资源、历史与统计
    browser/                 Chromium 会话、cookies 与 partition
    backups/                 配置备份
    cache/                   npm、jiti、Node、模型与更新缓存
    logs/                    应用/RPC 日志、模型请求快照、崩溃记录
    temp/                    下载与临时文件
```

- 开发版位于项目 `.tc-pi-dev/<分支环境>/`；测试显式目录完整隔离，不触发真实配置迁移。
- 首次复制旧 AppData 配置与共享 Pi 文件，之后由 `data/storage-layout.json` 记录完成状态。授权只经 Pi SDK 的 AuthStorage 在认证助手中迁移；不覆盖新授权，登出后不重新导入。
- Node/npm/Pi 使用私有入口；Windows Git/Bash 使用 PortableGit。缺失 Git 在启动或 Pi 安装时准备，官方归档先校验固定 SHA256，再解压与探测。首次准备依赖需要网络；Git 下载失败记入日志，保留应用其余能力。
- Pi 的 `npmCommand`、Windows `shellPath` 和技能规则在 Pi 文件锁内更新；历史消息正文保持原字节，目录与 fork 头部引用、catalog 路径、信任目录键随迁移重定位，会话身份保持不变。
- NSIS 覆盖安装、自动更新和普通卸载保留 `data/`、`runtimes/`；明确调用卸载器 `--delete-local-data` 才清除二者。应用无写权限时停止并报错，不回退 AppData。
- 关闭程序后可整体移动安装目录；重新启动按记录的旧根重写安装内路径。手写脚本中的硬编码路径、外部项目路径和审计日志正文不做替换。
- macOS 数据放在签名 `.app` 旁的 `TC-Pi/`，Linux AppImage 按原文件目录定位；这两平台仅做路径单测，未在本机进行整包验收，Git/shell 仍使用系统组件。WSL 运行时属于外部平台，配置与终端使用 `data/pi-wsl/` 范围；WSL 桌面认证仍不支持，需要在对应终端重新登录，旧 Linux 授权不自动导入。

## 验证记录

- 类型检查、格式检查、生产构建、针对性单测通过；全量单测 `7061` 项，`7059` 通过、`2` 跳过、无失败。
- 隔离 Electron 验证 userData/sessionData/temp/logs 与 Pi/npm/runtime 均属于指定根。
- 实际 PortableGit 下载哈希、解压、Git/Bash 版本探测通过；剔除系统 Node/Pi/Git PATH 后，私有 Node + Pi 的 RPC 握手、命令查询和 bash 工具调用通过。
- 上述运行环境移至含空格的目录后，再次完成 RPC/bash 验证。
- 真实 Pi SDK 使用合成凭据完成迁移、登出与不恢复旧凭据验证，无真实模型请求。
- 使用独立 NSIS appId/GUID 在工作区测试目录首装、覆盖安装、卸载：旧程序文件被移除，两份 data/runtime 标记均保留，未覆盖用户正式安装。
- 界面基线已有失败：`workspace-layout` 的会话行 hover/取消置顶，以及独立聊天仍断言“无需工作目录”的旧文案；在 `ba5e1ac7` 独立工作树复现，未扩展修复布局业务。
- 其余相关 Electron 界面验收 `9` 项通过，包括使用私有 PortableGit 的工作区刷新、发现和创建 worktree。测试夹具同步为私有 Node/Pi/Git 与 Pi 配置目录，未给生产代码增加全局运行时回退。
