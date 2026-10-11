# PiDeck

[简体中文](README.md)

This local development fork is based on [ayuayue/PiDeck](https://github.com/ayuayue/PiDeck). PiDeck is an Electron workbench that manages pi Agents through stdio JSON-RPC and provides workspace, session, file, and development tool management.
Maintained at [T-Chen-CN/TC-Pi](https://github.com/T-Chen-CN/TC-Pi). Application updates use this repository’s [Releases](https://github.com/T-Chen-CN/TC-Pi/releases).


## Current features

| Area | Capabilities |
| --- | --- |
| File workbench | Left file tree; central preview and editing; file tabs; directory selection, search, refresh, and external editor integration. |
| Workspaces | Add, select, and remove workspaces; Git worktrees; independent chat. |
| Sessions | Tabs and selection scoped to the current workspace; creation, search, archive, restore, import, and export. Lists use fixed descending creation order. |
| pi Agent | Models and thinking levels, streaming conversations, tool calls, run/stop, plan and goal modes, questions and approvals, subagents and todos. |
| Git | Changes, staging, commits, branches, commit graph, and diffs. |
| Development tools | Terminal, browser, scratchpad, and extension panels. The tool sidebar starts hidden. |
| Local resources | Local prompts, Skills, pi extensions, MCP configuration, and host plugins; management of enabled resources and built-in content maintenance. |
| Settings | Providers and authentication, proxies, security, voice, appearance, shortcuts, backups, diagnostics, processes, and usage statistics. |
| Automation and Web | Scheduled tasks, local Web service, and remote session browsing. |

The file-first layout consists of the file sidebar, central preview/editor, persistent session pane, and optional tool sidebar. Workspace switching changes content while retaining window layout. Switching away from a workspace with a busy Agent requires confirmation to terminate it.

## Removed features

This version removes DSH, ACP, standalone image generation, online resource stores and the Chinese prompt database, Feishu bots, desktop pets, the vision bridge, floating windows, and Windows CUA. The previous sidebar announcement and feedback entries are also removed.

Only current Pi sessions are loaded. Retired backend history adapters and image reference protocols have been removed; user files on disk are not deleted.

## Local development

Dependency versions are defined in package.json. The stack is Electron, React, TypeScript, and Vite.

```sh
npm install
npm run dev
```

Install and configure pi CLI separately. pi owns model requests, tool execution, and native session file reading/writing.

```sh
npm run typecheck
node --test tests/<relevant>.test.mjs
npm test
npm run check:format
npm run build:fast
npm run test:e2e
```

Use targeted tests during development and full regression for cross-domain changes. Electron end-to-end tests use Playwright and an isolated mock pi environment.

## Architecture and development rules

src/main owns desktop capabilities and processes, src/preload exposes the minimal API, src/renderer owns UI, and src/shared contains cross-layer contracts. See root AGENTS.md for development rules and docs/feature-pruning-plan.txt / docs/feature-pruning-audit-2026-10-11.txt for pruning records.

App and built-in content update sources still use upstream configuration. Migration to a personal repository will be handled separately. This document does not announce a published installer.

## License

MIT. Original project and dependency license notices and attribution are retained.
