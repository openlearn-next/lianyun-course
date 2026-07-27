<h1 align="center">恋云课程 · Lianyun Course</h1>
<p align="center">OpenLearn Next 研究性学习工作流插件</p>

---

## 简介

恋云课程（Lianyun Course）是 OpenLearn Next 教学平台的全栈插件，为 **PBL / STEAM 研究性学习** 提供端到端支持：

- 教师发起课题项目，按 9 阶段工作流推进
- 自动随机分组 + 拖拽调配 + 组长指定
- 学生代表小组提交成果，AI 预审完整性
- 同伴盲审互评 + 教师终审打分
- 积分自动入账 + ZIP 全量归档导出

## 安装

### 前置条件

- OpenLearn Next >= 0.1.12（插件依赖 `IPointsLedgerService` / `IPointsDimensionRegistry` / `IActivityRegistry` 三个 DI 服务，均在 0.1.12 引入）
- Node.js >= 18
- pnpm（推荐）或 npm

### 构建

```bash
cd lianyun-course   # 克隆后的仓库根目录
npm install
npx openlearn-plugin-sdk build
```

构建产物位于 `dist/`，包含 `index.js`（服务端）和 `frontend.js`（前端）。打包后的 ZIP 归档可直接在管理后台上传安装。

### 平台安装

1. 登录 OpenLearn Next 管理后台
2. 系统设置 → 插件中心 → 上传插件
3. 选择 `dist/lianyun-course.zip` 并激活

## 功能概览

### 九阶段工作流

| 阶段 | 标识 | 说明 |
|------|------|------|
| 📝 草稿 | `DRAFT` | 教师创建课题，配置分组与提交规则 |
| 🚀 已发布 | `PUBLISHED` | 课题对学生可见 |
| 👥 团队分组 | `GROUPING` | 自动随机分组 + 拖拽调配 |
| 🔬 探究实施 | `IN_PROGRESS` | 学生团队开展研究 |
| 📤 成果提交 | `SUBMISSION` | 组长代表小组提交材料 |
| 🔍 盲审互评 | `PEER_REVIEW` | 同伴匿名交叉评审 |
| 👨‍🏫 教师终审 | `TEACHER_REVIEW` | 教师 Approve / Return |
| 🏆 积分结算 | `POINTS_AWARDED` | 自动发放协作与创新积分 |
| 📦 归档导出 | `ARCHIVED` | ZIP 打包全量数据 |

### 教师端

- **课题列表管理**：创建、删除课题，查看各课题阶段与提交统计
- **班级名册**：自动读取 OpenLearn SQLite 真实班级与学生数据
- **智能分组**：按每组人数或总组数随机分配，拖拽调整成员，一键重分
- **成果终审**：Approve / Return 操作，通过后自动入账积分
- **ZIP 归档**：一键触发后台打包导出

### 学生端

- **团队看板**：查看小组分工、👑 组长标识、成员在线状态
- **成果提交**：组长代表全组提交，带文件格式校验与 AI 预审
- **课题进度**：可视化 Stepper 展示当前阶段

## 扩展点

| 扩展点槽位 | ID | 说明 |
|-----------|-----|------|
| `teacher.tab` | `tab_lianyun_course` | 教师侧边栏「恋云课程管理」标签 |
| `workspace.view` | `lianyun_course_workspace` | 工作区「恋云课程中心」视图 |
| `classroom.tool` | `tool_lianyun_course` | 课堂工具栏图标按钮 + 浮动抽屉 |
| `student.view` | `student_lianyun_view` | 学生端课题探究看板 |

## 命令与事件

### 命令

| 命令 | 说明 |
|------|------|
| `research.create_activity` | 创建新课题活动 |
| `research.update_phase` | 推进工作流阶段 |
| `research.get_classes` | 获取班级与学生名册 |
| `research.save_groups` | 保存分组配置 |
| `research.submit_work` | 提交课题成果 |
| `research.evaluate_submission` | 教师终审评分 |
| `research.trigger_export` | 触发 ZIP 归档导出 |

### 事件

| 事件 | 触发时机 |
|------|---------|
| `research.activity_created` | 课题创建成功 |
| `research.phase_advanced` | 阶段推进 |
| `research.groups_updated` | 分组变更 |
| `research.work_submitted` | 成果提交 |
| `research.work_approved` | 成果终审通过 |
| `research.export_completed` | 归档导出完成 |

### AI Action

| Action ID | 说明 |
|-----------|------|
| `research-check-completeness` | AI Agent 可调用，校验提交物完整性与格式 |

## 权限

| 权限 | 说明 |
|------|------|
| `research:read` | 查看课题与提交 |
| `research:write` | 创建课题、提交成果 |
| `research:review` | 同伴评审与教师终审 |
| `research:export` | 导出归档 |

## 数据库表

插件在激活时自动创建以下 SQLite 表（前缀 `plugin_research_`）：

- `plugin_research_activities` — 课题活动
- `plugin_research_groups` — 小组分组
- `plugin_research_submissions` — 成果提交（支持多版本）
- `plugin_research_reviews` — 评审记录

## 积分维度

| 维度 ID | 名称 | 类别 |
|---------|------|------|
| `research_collaboration` | 课题协作 | collaboration |
| `research_innovation` | 探究创新 | engagement |

## 开发

```bash
npm install
npm test
npm run build
```

## 许可证

MIT
