---
title: 快速开始 | TC-Pi 安装与首次配置 | pi desktop 入门
description: TC-Pi（pi desktop 桌面客户端）快速上手：下载安装 Windows/macOS/Linux 安装包、首次启动环境自检、一键安装 Node 与 pi CLI、创建第一个 Agent 会话。
---

# 快速开始

TC-Pi 是一个用于管理多个 [pi](https://pi.dev) 编码 Agent 会话的桌面工作台。它负责桌面端工作流，Agent 能力仍由 pi CLI 提供。

## 环境要求

- Windows 版安装到当前用户可写的目录。
- 首次准备依赖需要网络；在应用内安装私有 Node/Pi 运行时。
- 在配置管理中完成供应商登录或 API Key 配置。
- 从源码开发需要 Node.js 与 npm，版本以 `package.json` 为准。

## 下载安装

Windows 安装版与便携版发布在 GitHub Releases；v0.9.4 已完成 Windows 整包验证，macOS、Linux 本次仅验证路径策略：

[打开 GitHub Releases](https://github.com/T-Chen-CN/TC-Pi/releases)

安装向导可选择仅当前用户或所有用户；所有用户安装会按需申请 Windows 管理员权限。安装后首次启动时，TC-Pi 会复制旧配置与历史，通过完整校验后自动清理应用专属旧副本；共享配置、冲突或未验证文件保留，弹窗说明迁移与清理结果；缺少 Node/Pi 时通过环境安装入口准备。Windows Git/Bash 使用校验 SHA256 的私有 PortableGit。

配置、Pi 授权与会话、浏览器数据、缓存和日志存入安装目录的 `data/`；运行时存入 `runtimes/`。覆盖升级和普通卸载保留二者。安装目录不可写时会停止启动，请安装到可写目录。关闭程序后可整体移动目录，外部项目与脚本硬编码路径不自动迁移。WSL 使用独立配置范围，需要在对应终端重新登录。

## 从源码运行

```bash
git clone https://github.com/T-Chen-CN/TC-Pi.git
cd TC-Pi
npm install
npm run make-icon
npm run dev
```

## 基本工作流

1. 启动应用。
2. 添加一个本地项目目录。
3. 在项目里创建 Agent 会话。
4. 选择模型和思考等级。
5. 在聊天输入框中发送任务，或使用 `/`、`@`、`!` 提升输入效率。

## 浏览器预览模式

开发 UI 时可以直接打开浏览器预览：

```bash
npm run preview
```

Renderer 在 `window.piDesktop` 不可用时会降级为 mock 数据，适合调试布局和响应式表现。真实 Agent、会话和文件操作仍需要在 Electron 环境中验证。
