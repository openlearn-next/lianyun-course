# Changelog — lianyun-course (恋云课程)

All notable changes to the **恋云课程 (Lianyun Course) Plugin** (`lianyun-course`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
