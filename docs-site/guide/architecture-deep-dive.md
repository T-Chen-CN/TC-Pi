# 当前版本架构

TC-Pi 使用 Electron、React、TypeScript 与 Vite。主进程负责窗口、Pi 子进程、文件、Git、终端与设置；渲染层负责工作台界面；preload 暴露最小桌面 API。

## Pi 与宿主边界

Pi 负责模型请求、工具调用及会话存储，TC-Pi 经 stdio JSON-RPC 管理它。认证使用专用认证子进程；提示词增强使用单条补全侧车；GUI 扩展桥承载声明式 UI 与模型请求快照。它们均有独立的用途和生命周期边界。

会话记录 ID 跨重启稳定，agentId 只表示当前进程。运行时操作与事件绑定 sessionId、agentId 和 runtimeGeneration，拒绝迟到结果。

## 跨层契约

共享类型在 shared/types，IPC 通道集中在 shared/ipc.ts。handler 按领域注册，preload 仅转发和订阅；渲染层通过 desktopApi 调用桌面能力，跨组件状态使用 Jotai。

## 工作台与内容

左侧文件树、中间文件预览或编辑、固定右侧会话区和可隐藏工具侧栏组成工作台。窗口布局不依附某个工作区，会话内容按工作区隔离。

Pi 原生图片使用内联字节。弃用后端会话与旧图片引用不再加载。Markdown 由统一引擎渲染；文件访问、插件读取和 IPC 输入各自在边界验证路径与资源预算。

## 内置内容与更新

内置扩展随包分发，热更新按文件 SHA-256 校验。覆盖层只接受当前随包文件集合，旧覆盖层不能重新引入已移除的扩展。扩展只使用 Node、Pi 提供或相对导入的依赖。

完整维护规则见仓库 AGENTS.md 和 docs/maintenance-domains.md。
