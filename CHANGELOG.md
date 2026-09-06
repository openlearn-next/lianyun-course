# Changelog — lianyun-course (恋云课程)

All notable changes to the **恋云课程 (Lianyun Course) Plugin** (`lianyun-course`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.5] - 2026-09-06

### Fixed
- **manifest.main 路径错误**：`manifest.main` 之前写作 `'dist/index.js'`，但 `@openlearn/plugin-sdk@3.4.x` 的 `cli.mjs` 打包时把 `index.js`、`manifest.json`、`frontend.js` **平铺在 zip 根目录**，并不带 `dist/` 前缀。运行时按 `manifest.main` 查找入口抛 `Entry file "dist/index.js" specified in manifest not found in ZIP package`。改为 `'index.js'` 后重新 build，路径与 zip 内文件位置一致。
- **SDK `node:fs` / `node:path` 透传进 bundle**：上传时 OpenLearn 平台端 `openlearn-token-enforcer` 拒绝 plugin bundle 包含除相对路径与 `@openlearn/*` 之外的任何 import。根因是 `@openlearn/plugin-sdk@3.4.3` 的 `cli.mjs` 在 `onResolve` 钩子里把 `@openlearn/plugin-sdk` 解析到了 SDK 自身文件路径，导致 esbuild 把 SDK 整段 inline 进 plugin bundle；SDK 内部 `server/utils/logger.ts` 顶层 `import pino from "pino"` / `import fs from "node:fs"` / `import path from "node:path"` 跟着透传出来。修复方式为给 SDK 打 patch（`patches/@openlearn__plugin-sdk@3.4.3.patch`），让 `onResolve` 返回 `{ path: '@openlearn/plugin-sdk', external: true }`，SDK 恢复 external 状态，bundle 体积从 7.7 MB 降至 1.3 MB。已在 `pnpm-workspace.yaml` 配置 `patchedDependencies`，`pnpm install --no-frozen-lockfile` 后会自动应用。

## [1.2.4] - 2026-07-27

### Security
- **教师审核身份验证**：`evaluate_submission` 现在从 `command.actorId` 读取操作者身份，调用 `ICapabilityService.check(actorId, 'research:review')` 验证后才执行。缺失 actorId 或未授能力返回 `{ success: false, error }`。其余 8 个写/读/导出命令（create_activity / update_phase / delete_activity / save_groups / submit_work / trigger_export / get_activities / get_classes）同样按 READ/WRITE/REVIEW/EXPORT 四类能力隔离。前端在 `activate()` 中重写 `invokeCommand` 自动注入 `actorId`，从 `hostCtx.actorId/userId/user.id` 读取。
- **AI Action 不再产生副作用**：原 `research-check-completeness` Action 复用 `commandType: 'research.submit_work'`，调用 Agent 误触发会创建真实提交单。现拆为独立 `research.check_completeness` 只读命令，Action capability 从 `research:write` 降为 `research:read`。

### Fixed
- **背景初始化从未触发**：`initServicesAndDb()` 在 1.2.0 被定义但全文件无调用，导致 DB schema、积分维度、Activity Provider 全部不生效。在 `activate` 末尾补 `void initServicesAndDb().catch(...)`。
- **班级账本隔离**：`addPoints` 第二参数原本固定传 `activity_id`，导致积分账本按班级聚合时跨课题串账。新建活动接受 `classId` payload 并写入 `plugin_research_activities.class_id` 列（带 `ALTER TABLE` 向后兼容）；终审时按 `activity_id` 反查 `class_id` 作为账本隔离键。
- **ZIP 导出 handler 未注册**：原本 `research_zip_export` 只有 spawn 没有 handler，导出任务永远在队列中等待。现抽出顶层 `buildActivityZip`（用 jszip 打包 `manifest/activity/groups/submissions/reviews.json` 与 README），在 `initServicesAndDb` 里 `registerHandler` 注册；`trigger_export` 在 spawn 失败或 handler 未注册时走同步 fallback，保证用户不会看到“点导出后无反应”。ZIP 字节流写入 `IStorageService` 供平台统一路由下载。
- **前端 mutating handler 全部过服务端**：`handleCreateProject` / `handleDeleteProject` / `handleTeacherEvaluate` 原本只更新本地 state，刷新页面即丢失。现全部调对应服务端命令；新增 `research.delete_activity` 命令（级联删评审→提交→分组→活动）。启动时调用 `refreshActivities` 从 `research.get_activities` 拉取真实列表。
- **能力配置字段错误**：`PointsDimensionSpec` 的 `category` 误传 `collaboration/engagement`，正确枚举为 `'builtin' | 'plugin'`；`provider` 改为 `pluginId`，补必填 `defaultWeight`。
- **清单 main 字段缺失**：SDK schema 要求 `manifest.main` 必填，补 `main: 'dist/index.js'`。
- **清单 requires 不全**：补全 5 个运行时依赖的 Token（IDatabase / IProcessService / IPointsLedgerService / IPointsDimensionRegistry / IActivityRegistry）。
- **manifest.version 脱节**：服务清单仍是 1.2.2，package.json 与 dist 已 bump 到 1.2.4。

### Changed
- **avatar 不再按姓名猜性别**：服务端 `s.name.endsWith('娜/洋/敏/婷/琳/静')` 判定与前端同学头像推测全部移除；后端返回 `avatar: undefined`，前端 UI 兑底改为中性 `🎓`。
- **`pointsConfig` 终于生效**：`evaluate_submission` 读 `activities.config.pointsConfig.approvedBonusPoints` 发放积分，不再硬编码 50。
- **随机分组换加密源**：`handleAutoRandomGrouping` 改用 `crypto.getRandomValues` + 拒绝采样避免模偏，不支持时降级 `Math.random`。明确注释 Fisher–Yates 公平性。
- **事件 id 加固**：新增 `makeEventId()`，优先 `crypto.randomUUID`，降级 `crypto.getRandomValues` + 拒绝采样，避免同毫秒内 id 冲突。
- **空 catch 全部记录**：12 处 `catch {}` 改为 `ctx.log?.warn(...)` 带具体上下文；区分“Memory fallback”真实降级与异常路径。
- **deactivate 签名修正**：移除误导性 `_ctx` 参数，与 SDK `deactivate?: () => Promise<void>` 对齐。
- **前端模块级 `let ctx` 替换为 React Context**：新增 `PluginHostContext` + `useHost()` hook，`activate()` 通过 `withHostCtx` 把每个注册组件包裹 Provider，内部组件必须经 `useHost()` 获取 ctx。避免多实例 / 热重载 / React 严格模式下模块级全局互相覆盖。
- **教师白板『推进课题阶段』按钮接入真实逻辑**：抽屉打开时拉取真实活动列表 + 下拉选择 + 调 `research.update_phase`，用 `computeNextPhase` 按 PHASE_ORDER 顺序推进一步；不再 alert。
- **`ResearchWorkspaceMainView` 拆分第一步**：抽出 `CreateProjectModal` 独立组件（约 160 行），用 `useReducer` 替代 5 个散乱 useState；原主组件从 1170 减为 1067 行。后续 GroupingGrid / TeacherReviewPanel 等拆分计划在 1.3.x 进行。
- **README/CHANGELOG** 同步更新（包含测试运行说明、`@openlearn/plugin-test-kit` 弃用等）。

### Added
- **测试可跑**：加 `vitest` 依赖 + `npm test` / `npm run test:watch` 脚本；自写 `__tests__/helpers/mock-context.ts`（含内存 SQLite + capability mock）替代不存在的 `@openlearn/plugin-test-kit`。测试从 7 个增至 **16 个**，覆盖状态机 5 个分支 + 8 个服务端命令 + 1 个端到端 SQLite 路径 + 2 个能力校验拒绝路径。
- **`makeEventId()`** 与 **`assertCapability()`** 作为顶级 helper 抽出。
- **点扩展点包裹 `withHostCtx`**：使每个注册组件拿到独立的 Provider 范围。

### Removed
- **`package-lock.json`**：项目已切 pnpm，不需 npm lockfile。同时在 `.gitignore` 加 `package-lock.json` 与 `logs/` 防止污染。
- **4 个不必要 useState**：newTitle / newDesc / newEnableGrouping / newMaxMembers / newEnablePeerReview / selectedFileTypes 全部从主组件挪入 `CreateProjectModal`。

---

## [1.2.3] - 2026-07-27

### Fixed
- **构建失败：3 个 SDK Token 未导出** — 升级 `@openlearn/plugin-sdk` 从 `^3.2.0` 到 `^3.4.3`。SDK 3.2.0 发布的 `dist/index.d.ts` 已过期，缺失 `IPointsLedgerServiceToken` / `IPointsDimensionRegistryToken` / `IActivityRegistryToken` 三个 DI Token（源码侧已在使用），导致 `npx openlearn-plugin-sdk build` 报 `No matching export`。3.4.3 已补全 28 个 Token，与官方 DI 字典（https://openlearn-next-v2.readthedocs.io/zh-cn/latest/api/di-tokens.html）一致。

### Changed
- **API 形状对齐**：按 3.4.3 字典修正三处调用形状
  - `pointsDimensionRegistry.registerDimension()` 为**同步方法**，移除错误的 `await ... .catch(() => {})` 写法（`void` 返回值无 `.catch`，原写法会在激活时抛 TypeError）。
  - `activityRegistry.register(...)` → `activityRegistry.registerProvider(defineActivityProvider({ descriptor, onInitialize, onStart, onPause, onResume, onFinish, onDispose }))`。新 API 钩子前缀由 `initialize/start/pause/resume/finish/dispose` 改为 `on*`，且方法名变更为 `registerProvider`。
  - `pointsLedger.addPoints(...)` 第二参数官方命名为 `classId`；本插件继续以 `activity_id` 作为写入键（不增加 classId 解析失败面），并在调用处加注释说明。
- **平台最低版本要求**：`engines.openlearn` 与 README 前置条件从 `>= 0.1.0` 收紧至 `>= 0.1.12`（三个新 Token 均为 0.1.12 引入）。

---

## [1.2.2] - 2026-07-26

### Changed
- **Plugin Rename**: Plugin identity renamed from `@aymwoo/plugin-research-workflow` to `lianyun-course`（恋云课程）. All manifest IDs, extension point IDs, UI labels, and repository URLs updated accordingly. Git repository migrated to `github.com/openlearn-next/lianyun-course`.
- **课题列表与详情分页**: 点击「进入管理」按钮后进入独立的课题详情页，不再同时展示课题列表。详情页顶部增加面包屑导航（`← 返回课题列表`）。

### Removed
- **预设班级数据名册**: 移除前端 `MOCK_CLASSES` 硬编码班级数据与服务端 seed class 注入逻辑及 fallback mock 数据。班级名册现在完全依赖平台 SQLite 或 `/api/classes` 接口实时获取。

### Added
- **README.md**: 新增项目文档，涵盖安装、功能概览、扩展点、命令/事件/Action 参考、权限与数据库表说明。

---

## [1.2.1] - 2026-07-26

### Changed
- **Removed default example topics**: The two hardcoded demo activities (`act_demo_1` "AI 智能助教在 STEAM 教学中的应用与创新探究" and `act_demo_2` "微水体生态系统水质多参数实时采集与可视化分析项目") along with their seeded groups and submissions are no longer injected. The plugin now starts with an empty topic list.

### Added
- **课题列表管理 (Project List & Management)**: Replaced the cramped topic selector with a dedicated management list showing each topic's phase, description, group count and submission count. Each row is clickable to enter management; teacher role gets a **🗑️ 删除** button with a confirmation dialog that also removes the topic's associated groups and submissions. An empty-state prompt guides teachers to create the first topic.

---

## [1.2.0] - 2026-07-26

### Added
- **Class Rosters & Platform SQLite Direct Access**: Integrated `research.get_classes` command handler querying OpenLearn SQLite tables (`classes`, `students`, `class_students`) for real class and student rosters.
- **Multi-Strategy Auto-Grouping**: Support automatic random student assignment by target group size or group count with auto-selected group leaders.
- **HTML5 Drag & Drop Group Movement**: Drag group members between groups or to/from the unassigned student pool (`⋮⋮` drag handle on the far left, `设为组长` button on the far right).
- **Teacher & Student Role Isolation**: Role segment switcher (`[ 👨‍🏫 教师视角管理台 | 🎓 Student View ]`); configurable allowed submission file extensions (`.pdf`, `.docx`, `.zip`, `.mp4`, `.xlsx`), file size limits, and minimum attachment requirements.
- **Git Repository Metadata**: Added `repository` and `homepage` URLs to `package.json` and plugin manifest pointing to GitHub/Gitee repositories.

### Fixed
- **Worker Thread Activation Timeout**: Refactored `activate(ctx)` function to perform DB initialization and service resolutions asynchronously non-blockingly with a 500ms race timeout, reducing activation response time to `< 10ms` and resolving `[WorkerRuntime] Worker operation timed out after 10000ms`.
- **Workflow State Transition Guard**: Updated `WorkflowStateMachine` to treat same-phase clicks (`currentPhase === targetPhase`) as a clean no-op (`allowed: true`) and added teacher manual override capability.

---

## [1.1.0] - 2026-07-26

### Added
- **OpenLearn Light Theme Alignment**: Converted plugin styling to OpenLearn Next Light Theme (`slate-50` background, `#ffffff` cards with `#e2e8f0` borders, `#2563eb` primary buttons).
- **Multi-Project Management Dashboard**: Support creating and managing multiple PBL / STEAM research projects with project switcher tabs and stat summary cards.
- **Dedicated Management Tab & Compact Tool Widget**: Refactored whiteboard classroom widget into a compact 32x32px icon button with floating drawer; registered `teacher.tab` extension point.
- **Plugin Namespace Migration**: Renamed plugin package and manifest ID from `@openlearn/plugin-research-workflow` to `@aymwoo/plugin-research-workflow` to mark it as a third-party author plugin.

---

## [1.0.0] - 2026-07-26

### Added
- Initial release of the Research Learning Workflow Plugin.
- 5-phase PBL / STEAM workflow state machine (`DRAFT` -> `PUBLISHED` -> `SUBMISSION` -> `PEER_REVIEW` -> `TEACHER_REVIEW` -> `ARCHIVED`).
- AI submission check integration, peer review blind assignment, points ledger integration, and structured ZIP export.
