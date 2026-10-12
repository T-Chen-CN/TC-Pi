# TC-Pi

[English](README.en.md)

基于 [ayuayue/PiDeck](https://github.com/ayuayue/PiDeck) 的本地二次开发版本。TC-Pi 是 Electron 桌面工作台，通过 stdio JSON-RPC 管理 pi Agent，提供工作区、会话、文件与开发工具管理。
当前维护仓库：[T-Chen-CN/TC-Pi](https://github.com/T-Chen-CN/TC-Pi)。应用更新从本仓库的 [Releases](https://github.com/T-Chen-CN/TC-Pi/releases) 获取。

[![Version](https://img.shields.io/badge/version-0.9.1-blue)](https://github.com/T-Chen-CN/TC-Pi/releases/latest)

> **最新版本 v0.9.1**（2026-10-12）

### v0.9.1 更新亮点
- 🚀 **文件为中心的工作台**
- 🚀 **Pi Agent 全局配置文件树**
- 🚀 **使用总览与会话管理**
- 🚀 **Git 提交图谱**
- ✨ **精简 Agent 与附加功能**
- ✨ **TC-Pi 发布与自动更新**
- ✨ **窗口布局稳定性**
- ✨ **文本预览与文件授权**

[查看完整更新日志 →](CHANGELOG.zh-CN.md)

---

## 当前功能

| 板块 | 能力 |
| --- | --- |
| 文件工作台 | 左侧文件树；中间文件预览与编辑；文件标签页；目录、搜索、刷新与外部编辑器入口。主界面和独立聊天显示 Pi Agent 全局配置文件，工作区显示项目文件。 |
| 工作区 | 添加、选择、移除工作区；Git worktree 管理；独立聊天。 |
| 会话 | 当前工作区的会话标签页、会话选择、创建、搜索、归档、恢复、导入与导出。会话列表按创建时间倒序固定排序。 |
| pi Agent | 模型与思考档位、流式对话、工具调用、运行与停止、计划和目标模式、提问审批、子代理与待办。 |
| Git | 工作区变更、暂存、提交、分支、提交图谱和差异查看。 |
| 开发工具 | 终端、内置浏览器、草稿本、扩展提供的面板。工具侧栏默认隐藏。 |
| 本地资源 | 本地提示词、Skills、pi 扩展、MCP 配置、宿主插件；保留已启用资源的管理和内置内容维护。 |
| 设置 | 模型供应商与认证、代理、安全、语音、外观、快捷键、备份、诊断、进程与用量统计。 |
| 自动化与 Web | 定时任务、本机 Web 服务及远程会话浏览。 |

布局以文件为中心：左侧文件管理、中间预览/编辑、右侧固定会话区以及可隐藏的工具侧栏。切换工作区只改变内容，窗口布局保持一致；当前工作区有忙碌 Agent 时，切换前需确认终止。

## 精简范围

此版本移除了 DSH、ACP、独立生图、在线资源商店及中文提示词数据库、飞书机器人、桌宠、视觉桥、悬浮小窗和 Windows CUA。原侧栏的公告与反馈入口也已移除。

仅加载当前 Pi 会话；弃用后端的历史适配和旧图片引用协议已移除。不会清理用户磁盘数据。

## 本地开发

依赖版本以 package.json 为准；运行环境为 Electron、React、TypeScript 和 Vite。

```sh
npm install
npm run dev
```

应用还需要安装并配置 pi CLI。模型调用、工具执行和原生会话文件读写由 pi 负责。

```sh
npm run typecheck
node --test tests/<相关>.test.mjs
npm test
npm run check:format
npm run build:fast
npm run test:e2e
```

开发时优先运行相关测试；跨域改动运行全量回归。Electron 端到端测试使用 Playwright 和独立的 mock pi 环境。

## 目录与开发约束

src/main 管理桌面能力与进程，src/preload 暴露最小 API，src/renderer 管理界面，src/shared 保存跨层契约。开发规则见根目录 AGENTS.md；精简对照和审计记录见 docs/feature-pruning-plan.txt 与 docs/feature-pruning-audit-2026-10-11.txt。

## 下载与更新

从 [TC-Pi Releases](https://github.com/T-Chen-CN/TC-Pi/releases/latest) 下载当前版本。Windows 安装版使用 `setup.exe`，便携版使用 `portable.exe` 或 `win.zip`。首次使用仍需安装并配置 pi CLI。

应用与内置内容从 TC-Pi 获取更新。Windows 安装版支持应用内下载和安装更新，便携版通过 Releases 手动更新。原作者的上游安装包不包含此分支的修改。

## License

MIT。保留原项目及依赖的许可证与作者署名。
