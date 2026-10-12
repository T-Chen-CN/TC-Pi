---
layout: home
# 首页 title/description：面向「pi desktop / pi 桌面客户端 / AI 编码助手桌面」等核心搜索词，
# 覆盖全局默认值（VitePress home 布局不会从正文提取描述）。
title: TC-Pi - pi desktop 桌面工作台 | 多项目 pi Agent 客户端
description: TC-Pi 是开源的 pi desktop 桌面工作台（pi 桌面客户端），在统一窗口管理多个 pi AI 编码助手会话、Git、终端与模型配置，支持导入 Codex/Claude 会话，覆盖 Windows、macOS、Linux。

hero:
  name: TC-Pi
  text: 多项目 pi Agent <span class="keep-together">桌面工作台</span>
  tagline: 在统一的桌面工作区中管理本地 pi 编码助手会话、配置、Git 和终端，支持 Windows、macOS、Linux，让本地 AI 编码工作流更稳定高效。
  actions:
    - theme: brand
      text: 下载最新版本
      link: https://github.com/T-Chen-CN/TC-Pi/releases
    - theme: alt
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 源码仓库
      items:
        - text: GitHub 仓库（海外）
          link: https://github.com/T-Chen-CN/TC-Pi

features:
  - icon: 🗂️
    title: 多项目工作区
    details: 添加、搜索、拖动排序和切换本地项目目录，每个 Agent 会话都保持项目级隔离，同时运行多个 pi Agent。
  - icon: 🕘
    title: 会话历史与恢复
    details: 恢复历史会话，按时间线查看工具调用和回答细节，并回放历史会话中的修改内容，支持 Codex 和 Claude 会话导入。
  - icon: 🌿
    title: Git 集成
    details: 实时分支显示和切换，文件树展示 Git 状态，VS Code 风格三面板（变更/历史/比较），AI 提交摘要生成，branch graph 可视化，cherry-pick/revert/reset/drop 操作，worktree 工作区支持。
  - icon: 💬
    title: 对话 & 引用
    details: "& 会话引用快捷输入，跨会话上下文注入。消息队列在 Agent 忙碌时排队发送。会话大纲面板快速跳转。"
  - icon: 📝
    title: 文件编辑器
    details: 中间文档区支持多标签预览、编辑与 Diff；主界面和独立聊天可浏览 Pi Agent 全局配置文件。
  - icon: 🧰
    title: 内置工具
    details: 内置浏览器（多标签/全屏/设备预设）、草稿本、外部编辑器集成、浮动快捷操作栏、内置终端。
  - icon: 🖥️
    title: 内嵌终端 Dock
    details: 当前 Agent 绑定独立终端 tab，支持 PowerShell/cmd/sh fallback、多 tab、主题切换、拖拽高度、右键复制。
  - icon: ⚙️
    title: 配置与插件管理
    details: 可视化编辑 Models、Auth、Settings，全局和项目级 Skills 与 Extension 管理，斜线命令和模板快速插入。
  - icon: 🌐
    title: 跨平台下载
    details: Windows 安装包通过 GitHub Releases 发布；源码开发支持 Windows、macOS、Linux。v0.9.3 在 Windows 完成整包验收。
---

::: info
TC-Pi v0.9.3 将运行环境与应用数据集中到安装目录，配置、授权与历史位于 `data/`，私有运行时位于 `runtimes/`，覆盖升级保留这两个目录。迁移经过完整校验后自动清理应用专属旧副本，共享或未验证文件保留，弹窗说明结果。下载与更新使用 TC-Pi Releases，功能以 [当前功能手册](/guide/feature-reference) 为准。
:::


<figure class="home-showcase">
  <img src="/images/overview.png" alt="TC-Pi 工作区与对话界面截图">
  <figcaption>工作区、会话、文件抽屉、Git 分支和工具调用集中在同一个桌面窗口中。</figcaption>
</figure>

<p class="version-badge"><a href="/changelog">v0.9.3</a> 已发布 · <a href="/guide/getting-started#下载安装">下载安装</a> · <a href="/changelog">查看更新日志</a></p>

## 面向本地开发的桌面控制台

`TC-Pi` 不是 pi 的分支。它是一个轻量 Electron 外壳，通过启动多个 `pi --mode rpc` 进程，把项目管理、会话管理、配置管理和桌面交互整合起来，Agent 能力仍由 pi 原生提供。

<div class="info-strip">
  <div>
    <strong>一个 Agent Tab</strong>
    一个独立 pi RPC 进程，避免不同项目和对话互相污染。
  </div>
  <div>
    <strong>一个工作台</strong>
    聊天、文件、历史、配置、终端和 Git 信息都在同一个桌面布局里。
  </div>
  <div>
    <strong>一个下载入口</strong>
    预构建包统一发布到 GitHub Releases，发现新版本后应用内会提示。
  </div>
</div>

## 截图预览

<div class="screenshot-grid">
  <div class="screenshot-card">
    <img src="/images/config.png" alt="配置管理界面">
    <strong>配置管理</strong>
    <span>可视化编辑模型、认证、设置和 Skills。</span>
  </div>
  <div class="screenshot-card">
    <img src="/images/slash-commands.png" alt="斜线命令与会话历史">
    <strong>命令与历史</strong>
    <span>内置斜线命令建议，快速恢复历史会话。</span>
  </div>
  <div class="screenshot-card">
    <img src="/images/files.png" alt="文件树与会话操作">
    <strong>文件抽屉</strong>
    <span>查看项目文件、Git 状态和本次会话修改。</span>
  </div>
  <div class="screenshot-card">
    <img src="/images/terminal.png" alt="终端 Dock 界面">
    <strong>终端 Dock</strong>
    <span>为当前 Agent 保留独立终端 tab。</span>
  </div>
</div>

## 反馈与交流

请通过 [TC-Pi Issues](https://github.com/T-Chen-CN/TC-Pi/issues) 提交问题或建议。此分支基于 [ayuayue/PiDeck](https://github.com/ayuayue/PiDeck)，保留上游项目与依赖的许可证及作者署名。

## 下一步

- 想直接使用：前往 [下载安装](/guide/getting-started#下载安装)。
- 想从源码运行：查看 [快速开始](/guide/getting-started#从源码运行)。
- 想了解功能边界：查看 [功能介绍](/guide/features)。
