/**
 * 恋云课程 (Lianyun Course) Plugin — Server Entry (dist/index.js)
 * 
 * 研究性学习全栈插件服务端入口。
 * 零核心修改，完全通过 PluginContext 及 DI Tokens 与平台通信。
 */

import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  IDatabaseToken,
  ICapabilityServiceToken,
  IPointsLedgerServiceToken,
  IPointsDimensionRegistryToken,
  IProcessServiceToken,
  IActivityRegistryToken,
  defineActivityProvider,
} from '@openlearn/plugin-sdk';
import { WorkflowStateMachine } from './domain/workflow-state-machine.js';
import JSZip from 'jszip';
import type {
  ResearchActivity,
  ResearchGroup,
  ResearchSubmission,
  ResearchReview,
  WorkflowConfig,
} from './types.js';

// 业务能力常量。与 manifest.capabilitiesProposed 对齐。
const CAP = {
  READ: 'research:read',
  WRITE: 'research:write',
  REVIEW: 'research:review',
  EXPORT: 'research:export',
} as const;

/**
 * 从 PlatformCommand 提取 actorId。若 command 缺失 actorId（可能来自
 * 老版本 SDK / 测试 mock），回退到 payload.actorId；都没有则拒绝执行。
 */
function getActorId(command: any): string | null {
  const fromCommand = command?.actorId;
  if (typeof fromCommand === 'string' && fromCommand.length > 0) return fromCommand;
  const fromPayload = command?.payload?.actorId;
  if (typeof fromPayload === 'string' && fromPayload.length > 0) return fromPayload;
  return null;
}

/**
 * 校验 actor 是否具备 requiredCap。若 service 不可用则降级为允许（与
 * 现有插件的『插件激活不依赖 capability 服务』语义保持一致），但通过
 * ctx.log 记录告警，便于运维定位。
 */
async function assertCapability(
  ctx: PluginContext,
  capabilityService: any,
  actorId: string | null,
  requiredCap: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!actorId) {
    return { allowed: false, reason: 'actorId 缺失：拒绝未认证调用' };
  }
  if (!capabilityService?.check) {
    ctx.log?.warn?.(`[lianyun-course] capability service unavailable; skipping check for ${requiredCap}`);
    return { allowed: true };
  }
  try {
    const ok = await capabilityService.check(actorId, requiredCap);
    return ok ? { allowed: true } : { allowed: false, reason: `actor '${actorId}' 缺少能力 '${requiredCap}'` };
  } catch (e) {
    ctx.log?.warn?.(`[lianyun-course] capability.check failed for ${requiredCap}:`, e);
    return { allowed: true };
  }
}

/**
 * 生成事件 id。优先用 crypto.randomUUID 保证全局唯一；不支持时降级为
 * 时间戳 + 加密随机后缀，避免同毫秒内产生重复 id。
 */
function makeEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `evt_${crypto.randomUUID()}`;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    let suffix = '';
    for (let i = 0; i < buf.length; i++) suffix += buf[i].toString(36).padStart(2, '0');
    return `evt_${Date.now()}_${suffix}`;
  }
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// 辅助：打包单个课题的完整快照为 ZIP 字节串。
// 抽出为顶级函数，以便 processManager handler 与同步 fallback 路径复用。
async function buildActivityZip(
  activityId: string,
  db: any,
  storage: any,
  taskId: string,
  log: (msg: string) => void = () => {},
): Promise<{ zipBase64: string; downloadKey: string; manifest: any }> {
  if (!db?.prepare) {
    throw new Error('Database not available; ZIP export requires rawDb');
  }

  log(`开始导出课题 ${activityId} 的全量快照...`);
  const actRow = db.prepare('SELECT * FROM plugin_research_activities WHERE id = ?').get(activityId);
  if (!actRow) {
    throw new Error(`Activity ${activityId} not found`);
  }

  const groupRows = db.prepare('SELECT * FROM plugin_research_groups WHERE activity_id = ?').all(activityId);
  const submissionRows = db.prepare(
    'SELECT * FROM plugin_research_submissions WHERE activity_id = ? ORDER BY created_at ASC',
  ).all(activityId);
  const submissionIds = submissionRows.map((s: any) => s.id);
  const reviewRows = submissionIds.length
    ? db.prepare(
        `SELECT * FROM plugin_research_reviews WHERE submission_id IN (${submissionIds.map(() => '?').join(',')}) ORDER BY created_at ASC`,
      ).all(...submissionIds)
    : [];

  // 反序列化 JSON 字段
  const parseJson = (s: any, fb: any) => {
    if (s == null) return fb;
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return fb; }
  };

  const activity = {
    ...actRow,
    config: parseJson(actRow.config, {}),
    rubrics: parseJson(actRow.rubrics, []),
  };
  const submissions = submissionRows.map((r: any) => ({
    ...r,
    attachments: parseJson(r.attachments, []),
    ai_check_result: parseJson(r.ai_check_result, null),
  }));
  const reviews = reviewRows.map((r: any) => ({
    ...r,
    scores: parseJson(r.scores, []),
  }));

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    activityId,
    taskId,
    exportedAt: Date.now(),
    counts: {
      groups: groupRows.length,
      submissions: submissions.length,
      reviews: reviews.length,
    },
  }, null, 2));
  zip.file('activity.json', JSON.stringify(activity, null, 2));
  zip.file('groups.json', JSON.stringify(groupRows, null, 2));
  zip.file('submissions.json', JSON.stringify(submissions, null, 2));
  zip.file('reviews.json', JSON.stringify(reviews, null, 2));
  zip.file(
    'README.txt',
    `Lianyun Course Activity Export\n` +
    `Activity ID: ${activityId}\n` +
    `Task ID:     ${taskId}\n` +
    `Exported at: ${new Date().toISOString()}\n\n` +
    `Contents:\n` +
    `  manifest.json     导出摘要与统计\n` +
    `  activity.json     课题活动元数据\n` +
    `  groups.json       课题下所有小组\n` +
    `  submissions.json  全部成果提交（含 AI 预审结果）\n` +
    `  reviews.json      全部评审记录（同伴互评 + 教师终审）\n`,
  );

  log('正在生成 ZIP 字节流...');
  const buf = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const downloadKey = `research_export:${activityId}:${taskId}`;
  const manifest = {
    activityId,
    taskId,
    downloadKey,
    sizeBytes: Math.floor((buf.length * 3) / 4),
    exportedAt: Date.now(),
  };

  if (storage?.set) {
    await storage.set(downloadKey, { zipBase64: buf, manifest });
    log(`ZIP 写入 storage: ${downloadKey}`);
  }

  return { zipBase64: buf, downloadKey, manifest };
}

export default {
  manifest: {
    id: 'lianyun-course',
    name: '恋云课程',
    version: '1.2.4',
    main: 'dist/index.js',
    description: '恋云课程 —— PBL / STEAM 课题全流程管理、多版本提交、盲审互评、积分入账与结构化 ZIP 归档的全栈参考插件',
    author: 'OpenLearn Next',
    repository: 'https://github.com/openlearn-next/lianyun-course',
    homepage: 'https://github.com/openlearn-next/lianyun-course',
    engines: { openlearn: '>= 0.1.12' },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IStorageService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IProcessService@^1.0.0',
      '@openlearn/core:IPointsLedgerService@^1.0.0',
      '@openlearn/core:IPointsDimensionRegistry@^1.0.0',
      '@openlearn/activity-ecosystem:IActivityRegistry@^1.0.0',
    ],
    capabilitiesProposed: [
      'research:read',
      'research:write',
      'research:review',
      'research:export',
    ],
    classroomTools: [
      {
        id: 'tool_lianyun_course',
        name: '恋云课程',
        icon: 'Microscope',
        commandType: 'research.create_activity',
        payload: {
          type: 'plugin',
          data: { teacherWidgetId: 'lianyun_course_dashboard', width: 480 },
        },
      },
    ],
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const eventBus = ctx.services.eventBus;
    const actionRegistry = ctx.services.actionRegistry;
    const storage = ctx.services.storage;

    // 内存降级数据库模拟 (当 SQLite 实例不可用时)
    const memStore = {
      activities: new Map<string, any>(),
      groups: new Map<string, any>(),
      submissions: new Map<string, any>(),
      reviews: new Map<string, any>(),
    };

    let rawDb: any = null;
    let pointsLedger: any = null;
    let pointsDimensionRegistry: any = null;
    let processManager: any = null;
    let activityRegistry: any = null;
    let capabilityService: any = null;

    // 【方案一优化】非阻塞式后台初始化服务与数据库（带 500ms 快速超时），确保 activate 在 <10ms 内极速返回
    const initServicesAndDb = async () => {
      const resolveWithTimeout = (token: any, ms = 500) =>
        Promise.race([
          ctx.resolve(token),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Resolve timeout')), ms)),
        ]).catch(() => null);

      try {
        rawDb = await resolveWithTimeout(IDatabaseToken);
        if (rawDb?.exec) {
          try {
            rawDb.exec(`
              CREATE TABLE IF NOT EXISTS plugin_research_activities (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                teacher_id TEXT NOT NULL,
                class_id TEXT,
                current_phase TEXT NOT NULL DEFAULT 'DRAFT',
                config TEXT NOT NULL,
                rubrics TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
              );

              CREATE TABLE IF NOT EXISTS plugin_research_groups (
                id TEXT PRIMARY KEY,
                activity_id TEXT NOT NULL,
                group_name TEXT NOT NULL,
                leader_student_id TEXT NOT NULL,
                member_ids TEXT NOT NULL,
                created_at INTEGER NOT NULL
              );

              CREATE TABLE IF NOT EXISTS plugin_research_submissions (
                id TEXT PRIMARY KEY,
                activity_id TEXT NOT NULL,
                group_id TEXT,
                student_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL,
                summary TEXT,
                attachments TEXT NOT NULL,
                ai_check_result TEXT,
                status TEXT NOT NULL DEFAULT 'SUBMITTED',
                created_at INTEGER NOT NULL
              );

              CREATE TABLE IF NOT EXISTS plugin_research_reviews (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL,
                reviewer_id TEXT NOT NULL,
                review_type TEXT NOT NULL,
                scores TEXT NOT NULL,
                total_score REAL NOT NULL,
                comments TEXT,
                decision TEXT NOT NULL,
                created_at INTEGER NOT NULL
              );
            `);
            // 向后兼容：v1.2.3 之前的 activities 表没有 class_id 列。
            // 老用户升级后需要手动 ALTER 添加该列。
            try {
              rawDb.exec(`ALTER TABLE plugin_research_activities ADD COLUMN class_id TEXT`);
            } catch { /* 列已存在，忽略 */ }
          } catch (e) {
            ctx.log?.warn('[lianyun-course] CREATE TABLE failed:', e);
          }
        } else if ((ctx as any).db?.ensureTable) {
          await (ctx as any).db.ensureTable('activities', 'id TEXT PRIMARY KEY, title TEXT, description TEXT, teacher_id TEXT, class_id TEXT, current_phase TEXT DEFAULT "DRAFT", config TEXT, rubrics TEXT, created_at INTEGER, updated_at INTEGER').catch(() => {});
          await (ctx as any).db.ensureTable('groups', 'id TEXT PRIMARY KEY, activity_id TEXT, group_name TEXT, leader_student_id TEXT, member_ids TEXT, created_at INTEGER').catch(() => {});
          await (ctx as any).db.ensureTable('submissions', 'id TEXT PRIMARY KEY, activity_id TEXT, group_id TEXT, student_id TEXT, version INTEGER DEFAULT 1, title TEXT, summary TEXT, attachments TEXT, ai_check_result TEXT, status TEXT DEFAULT "SUBMITTED", created_at INTEGER').catch(() => {});
          await (ctx as any).db.ensureTable('reviews', 'id TEXT PRIMARY KEY, submission_id TEXT, reviewer_id TEXT, review_type TEXT, scores TEXT, total_score REAL, comments TEXT, decision TEXT, created_at INTEGER').catch(() => {});
        }

        pointsLedger = await resolveWithTimeout(IPointsLedgerServiceToken);
        pointsDimensionRegistry = await resolveWithTimeout(IPointsDimensionRegistryToken);
        processManager = await resolveWithTimeout(IProcessServiceToken);
        activityRegistry = await resolveWithTimeout(IActivityRegistryToken);
        capabilityService = await resolveWithTimeout(ICapabilityServiceToken);

        if (pointsDimensionRegistry?.registerDimension) {
          try {
            pointsDimensionRegistry.registerDimension({
              id: 'research_collaboration',
              name: '课题协作',
              description: '研究性学习项目中的小组团队协作贡献得分',
              category: 'plugin',
              pluginId: 'lianyun-course',
              defaultWeight: 1.0,
            });
            pointsDimensionRegistry.registerDimension({
              id: 'research_innovation',
              name: '探究创新',
              description: '课题成果中的创新性与探究深度得分',
              category: 'plugin',
              pluginId: 'lianyun-course',
              defaultWeight: 1.0,
            });
          } catch { /* 维度注册失败不影响插件激活 */ }
        }

        if (activityRegistry?.registerProvider) {
          activityRegistry.registerProvider(
            defineActivityProvider({
              descriptor: {
                id: 'ext-research-workflow:activity',
                name: '研究性探究课题',
                description: '阶段式项目研究与成果盲审活动',
                category: 'collaboration',
                version: '1.1.0',
                provider: 'lianyun-course',
                supportedRoles: ['teacher', 'student'],
                commandType: 'research.create_activity',
              },
              onInitialize: async () => {},
              onStart: async () => {},
              onPause: async () => {},
              onResume: async () => {},
              onFinish: async () => {},
              onDispose: async () => {},
            }),
          );
        }

        // 注册后台 ZIP 导出 handler。原始 DB 引用与 storage 服务已
          // 在 initServicesAndDb 内被解析，handler 通过闭包捕获。
        if (processManager?.registerHandler) {
          try {
            await processManager.registerHandler('research_zip_export', async (processId, payload) => {
              const { activityId, taskId } = (payload as any) || {};
              try {
                const { manifest } = await buildActivityZip(
                  activityId,
                  rawDb,
                  storage,
                  taskId,
                  (msg) => ctx.log?.info?.(`[export:${taskId}] ${msg}`),
                );
                await eventBus.publish({
                  id: makeEventId(),
                  type: 'research.export_completed',
                  source: 'lianyun-course',
                  payload: {
                    activityId,
                    taskId,
                    processId,
                    downloadKey: manifest.downloadKey,
                    sizeBytes: manifest.sizeBytes,
                    timestamp: Date.now(),
                  },
                  timestamp: Date.now(),
                });
              } catch (e) {
                ctx.log?.error(`[lianyun-course] export ${taskId} failed:`, e);
                await eventBus.publish({
                  id: makeEventId(),
                  type: 'research.export_failed',
                  source: 'lianyun-course',
                  payload: { activityId, taskId, error: String(e), timestamp: Date.now() },
                  timestamp: Date.now(),
                });
              }
            });
          } catch (e) {
            ctx.log?.warn('[lianyun-course] registerHandler(research_zip_export) failed:', e);
          }
        }
      } catch (e) {
        ctx.log?.warn('[lianyun-course] initServicesAndDb failed:', e);
      }
    };

    // 辅助 publish 方法，补充标准 PlatformEvent 标头
    const publishEvent = async (type: string, payload: any) => {
      await eventBus.publish({
        id: makeEventId(),
        type,
        source: 'lianyun-course',
        payload,
        timestamp: Date.now(),
      });
    };

    // 3.0 获取平台真实的班级与学生名册 (Query real DB tables: classes, students, class_students)
    await commandBus.registerHandler('research.get_activities', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.READ);
        if (!cap.allowed) return { success: false, error: cap.reason };
        try {
          if (rawDb?.prepare) {
            const rows = rawDb.prepare('SELECT * FROM plugin_research_activities ORDER BY created_at DESC').all();
            const activities = rows.map((r: any) => ({
              id: r.id,
              title: r.title,
              description: r.description,
              teacherId: r.teacher_id,
              currentPhase: r.current_phase,
              config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {}),
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            }));
            return { success: true, activities };
          }
        } catch (e) {
          ctx.log?.warn('[lianyun-course] get_activities DB path failed, falling back to memory store:', e);
        }
        // Fallback to memory store
        const activities = Array.from(memStore.activities.values()).map((a: any) => ({
          id: a.id, title: a.title, description: a.description,
          teacherId: a.teacher_id, currentPhase: a.current_phase,
          config: typeof a.config === 'string' ? JSON.parse(a.config) : (a.config || {}),
          createdAt: a.created_at, updatedAt: a.updated_at,
        }));
        return { success: true, activities };
      },
    });

    await commandBus.registerHandler('research.get_classes', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.READ);
        if (!cap.allowed) return { success: false, error: cap.reason };
        try {
          if (rawDb?.prepare) {
            let dbClasses = rawDb.prepare(`
              SELECT c.id, c.name, c.description
              FROM classes c
              ORDER BY c.created_at DESC
            `).all();

            if (!dbClasses || dbClasses.length === 0) {
              return { success: true, classes: [] };
            }
            // 从 SQLite 查询真实班级及关联名册
            const realClasses = dbClasses.map((c: any) => {
              const students = rawDb.prepare(`
                SELECT s.id, s.name, s.student_number AS studentNo
                FROM students s
                INNER JOIN class_students cs ON s.id = cs.student_id
                WHERE cs.class_id = ?
                ORDER BY s.student_number ASC
              `).all(c.id);

              return {
                id: c.id,
                name: c.name,
                grade: c.description || '平台注册真实班级',
                students: students.map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  studentNo: s.studentNo || s.id,
                  // 不按姓名尾字猜测性别；返回中性头像让 UI 自行渲染。
                  // 后端不存储性别，避免造成隐性偏见。
                  avatar: undefined,
                })),
              };
            });

            return { success: true, classes: realClasses };
          }
        } catch (e: any) {
          console.error('[ResearchWorkflow] Fetch real classes from SQLite failed:', e);
        }

        return { success: true, classes: [] };
      },
    });

    // 3.01 保存与更新分组
    await commandBus.registerHandler('research.save_groups', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.WRITE);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { activityId, classId, groups } = command.payload || {};
        const groupList = groups || [];

        memStore.groups.set(activityId, groupList);

        await publishEvent('research.groups_updated', {
          activityId,
          classId,
          groupCount: groupList.length,
          timestamp: Date.now(),
        });

        return { success: true, groups: groupList };
      },
    });

    // 3.05 删除课题活动 (级联删除分组 / 提交 / 评审)
    await commandBus.registerHandler('research.delete_activity', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.WRITE);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { activityId } = command.payload || {};
        if (!activityId) {
          return { success: false, error: 'activityId 必填' };
        }

        if (rawDb?.prepare) {
          try {
            // 先查出本活动下所有 submission id，用于级联删评审
            const submissionRows: any[] = rawDb.prepare(
              'SELECT id FROM plugin_research_submissions WHERE activity_id = ?',
            ).all(activityId);
            const submissionIds = submissionRows.map((r) => r.id);

            if (submissionIds.length > 0) {
              const placeholders = submissionIds.map(() => '?').join(',');
              rawDb.prepare(
                `DELETE FROM plugin_research_reviews WHERE submission_id IN (${placeholders})`,
              ).run(...submissionIds);
            }
            rawDb.prepare('DELETE FROM plugin_research_submissions WHERE activity_id = ?').run(activityId);
            rawDb.prepare('DELETE FROM plugin_research_groups WHERE activity_id = ?').run(activityId);
            rawDb.prepare('DELETE FROM plugin_research_activities WHERE id = ?').run(activityId);
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] delete_activity ${activityId} failed:`, e);
            return { success: false, error: '数据库删除失败' };
          }
        }

        // 内存降级同步清理
        memStore.activities.delete(activityId);
        memStore.groups.delete(activityId);
        for (const [k, v] of memStore.submissions) {
          if ((v as any).activity_id === activityId) memStore.submissions.delete(k);
        }
        for (const [k, v] of memStore.reviews) {
          // 无 activity 字段，按 submission 反查困难；保守清理
          memStore.reviews.delete(k);
        }

        await publishEvent('research.activity_deleted', { activityId, timestamp: Date.now() });
        return { success: true, activityId };
      },
    });

    // 3.1 创建课题活动
    await commandBus.registerHandler('research.create_activity', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.WRITE);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { title, description, teacherId, classId, config, rubrics } = command.payload || {};
        const actId = `act_${Date.now()}`;
        const defaultConfig: WorkflowConfig = {
          enableGrouping: true,
          maxGroupMembers: 5,
          enablePeerReview: true,
          peerReviewsPerStudent: 2,
          allowLateSubmission: false,
          aiPreCheckEnabled: true,
          allowedFileTypes: ['.pdf', '.docx', '.zip', '.mp4', '.pptx', '.xlsx'],
          maxFileSizeMB: 50,
          requiredMinAttachments: 1,
          pointsConfig: {
            submissionBasePoints: 20,
            peerReviewPoints: 10,
            approvedBonusPoints: 50,
          },
          ...config,
        };

        const activityRecord = {
          id: actId,
          title: title || '未命名研究课题',
          description: description || '',
          teacher_id: teacherId || 'teacher_admin',
          class_id: classId || null,
          current_phase: 'DRAFT',
          config: JSON.stringify(defaultConfig),
          rubrics: JSON.stringify(rubrics || [{ id: 'rubric_1', name: '立题创新与完整性', maxScore: 100 }]),
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        if (rawDb?.prepare) {
          try {
            rawDb.prepare(`
              INSERT INTO plugin_research_activities (id, title, description, teacher_id, class_id, current_phase, config, rubrics, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              activityRecord.id,
              activityRecord.title,
              activityRecord.description,
              activityRecord.teacher_id,
              activityRecord.class_id,
              activityRecord.current_phase,
              activityRecord.config,
              activityRecord.rubrics,
              activityRecord.created_at,
              activityRecord.updated_at
            );
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] INSERT activity ${actId} failed, using memory store:`, e);
            memStore.activities.set(actId, activityRecord);
          }
        } else {
          memStore.activities.set(actId, activityRecord);
        }

        await publishEvent('research.activity_created', { activityId: actId, title, teacherId, classId, timestamp: Date.now() });

        return { success: true, activityId: actId };
      },
    });

    // 3.2 推进课题工作流阶段
    await commandBus.registerHandler('research.update_phase', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.WRITE);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { activityId, targetPhase, currentPhase: clientCurrentPhase, override } = command.payload || {};

        let currentAct: any = null;
        if (rawDb?.prepare) {
          try {
            currentAct = rawDb.prepare('SELECT * FROM plugin_research_activities WHERE id = ?').get(activityId);
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] SELECT activity ${activityId} failed, using memory store:`, e);
            currentAct = memStore.activities.get(activityId);
          }
        } else {
          currentAct = memStore.activities.get(activityId);
        }

        const currentPhase = currentAct?.current_phase || clientCurrentPhase || 'DRAFT';
        const config: WorkflowConfig = currentAct?.config
          ? (typeof currentAct.config === 'string' ? JSON.parse(currentAct.config) : currentAct.config)
          : ({ enableGrouping: true, enablePeerReview: true } as any);

        const check = WorkflowStateMachine.canTransition(currentPhase, targetPhase, config, { isTeacher: true, override: override ?? true });
        if (!check.allowed) {
          return { success: false, error: check.reason };
        }

        if (currentAct) {
          currentAct.current_phase = targetPhase;
        }
        if (rawDb?.prepare) {
          try {
            rawDb.prepare('UPDATE plugin_research_activities SET current_phase = ?, updated_at = ? WHERE id = ?')
              .run(targetPhase, Date.now(), activityId);
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] UPDATE phase for ${activityId} failed (memory-only state):`, e);
          }
        }

        await publishEvent('research.phase_advanced', { activityId, previousPhase: currentPhase, currentPhase: targetPhase, timestamp: Date.now() });

        return { success: true, currentPhase: targetPhase };
      },
    });

    // 3.3 提交课题成果 (支持多版本)
    await commandBus.registerHandler('research.submit_work', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.WRITE);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { activityId, groupId, studentId, title, summary, attachments } = command.payload || {};
        const subId = `sub_${Date.now()}`;

        let nextVersion = 1;
        if (rawDb?.prepare) {
          try {
            const prev = rawDb.prepare('SELECT MAX(version) as max_v FROM plugin_research_submissions WHERE activity_id = ? AND student_id = ?')
              .get(activityId, studentId);
            if (prev?.max_v) nextVersion = prev.max_v + 1;
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] SELECT MAX(version) for ${activityId} failed:`, e);
          }
        }

        // 简易 AI 预审
        const aiCheck = {
          passed: (attachments?.length || 0) > 0,
          completenessScore: (attachments?.length || 0) > 0 ? 95 : 60,
          missingElements: (attachments?.length || 0) === 0 ? ['未包含课题研究附件报告'] : [],
          recommendations: ['建议添加课题实验数据统计表格以丰富成果内容'],
          checkedAt: Date.now(),
        };

        const subRecord = {
          id: subId,
          activity_id: activityId,
          group_id: groupId || null,
          student_id: studentId,
          version: nextVersion,
          title: title || `成果提交 v${nextVersion}`,
          summary: summary || '',
          attachments: JSON.stringify(attachments || []),
          ai_check_result: JSON.stringify(aiCheck),
          status: 'SUBMITTED',
          created_at: Date.now(),
        };

        if (rawDb?.prepare) {
          try {
            rawDb.prepare(`
              INSERT INTO plugin_research_submissions (id, activity_id, group_id, student_id, version, title, summary, attachments, ai_check_result, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              subRecord.id, subRecord.activity_id, subRecord.group_id, subRecord.student_id, subRecord.version,
              subRecord.title, subRecord.summary, subRecord.attachments, subRecord.ai_check_result, subRecord.status, subRecord.created_at
            );
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] INSERT submission ${subId} failed, using memory store:`, e);
            memStore.submissions.set(subId, subRecord);
          }
        } else {
          memStore.submissions.set(subId, subRecord);
        }

        await publishEvent('research.work_submitted', { submissionId: subId, activityId, studentId, version: nextVersion, timestamp: Date.now() });

        return { success: true, submissionId: subId, version: nextVersion, aiCheck };
      },
    });

    // 3.4 教师终审打分并退回/通过 + 积分入账
    await commandBus.registerHandler('research.evaluate_submission', {
      async execute(command: any) {
        // reviewType 为 PEER 走同伴互评（仍需 review 能力），TEACHER 走
        // 终审；二者统一在服务端校验 actor 具备 research:review。
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.REVIEW);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { submissionId, reviewerId, reviewType, scores, comments, decision } = command.payload || {};
        const revId = `rev_${Date.now()}`;
        const scoreList = scores || [];
        const totalScore = scoreList.reduce((acc: number, item: any) => acc + (Number(item.score) || 0), 0);
        const subStatus = decision === 'APPROVE' ? 'APPROVED' : 'RETURNED';

        const revRecord = {
          id: revId,
          submission_id: submissionId,
          reviewer_id: reviewerId || 'teacher_admin',
          review_type: reviewType || 'TEACHER',
          scores: JSON.stringify(scoreList),
          total_score: totalScore,
          comments: comments || '',
          decision: decision || 'APPROVE',
          created_at: Date.now(),
        };

        if (rawDb?.prepare) {
          try {
            rawDb.prepare(`
              INSERT INTO plugin_research_reviews (id, submission_id, reviewer_id, review_type, scores, total_score, comments, decision, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              revRecord.id, revRecord.submission_id, revRecord.reviewer_id, revRecord.review_type,
              revRecord.scores, revRecord.total_score, revRecord.comments, revRecord.decision, revRecord.created_at
            );
            rawDb.prepare('UPDATE plugin_research_submissions SET status = ? WHERE id = ?').run(subStatus, submissionId);

            if (decision === 'APPROVE') {
              const subRow = rawDb.prepare('SELECT * FROM plugin_research_submissions WHERE id = ?').get(submissionId);
              if (subRow?.student_id && pointsLedger?.addPoints) {
                try {
                  // 从关联的 activities 读出真实 classId，保证积分账本按
                  // 真实班级维度聚合。若活动未绑定班级（class_id 为空），
                  // 回退到提交单里的 activity_id 作为账本隔离键，避免
                  // 跨班级串账。
                  let classIdForLedger = subRow.activity_id;
                  let pointsCfg = { submissionBasePoints: 20, peerReviewPoints: 10, approvedBonusPoints: 50 };
                  try {
                    const actRow = rawDb.prepare(
                      'SELECT class_id, config FROM plugin_research_activities WHERE id = ?',
                    ).get(subRow.activity_id);
                    if (actRow?.class_id) classIdForLedger = actRow.class_id;
                    if (actRow?.config) {
                      const cfg = typeof actRow.config === 'string' ? JSON.parse(actRow.config) : actRow.config;
                      if (cfg?.pointsConfig) {
                        pointsCfg = {
                          submissionBasePoints: cfg.pointsConfig.submissionBasePoints ?? pointsCfg.submissionBasePoints,
                          peerReviewPoints: cfg.pointsConfig.peerReviewPoints ?? pointsCfg.peerReviewPoints,
                          approvedBonusPoints: cfg.pointsConfig.approvedBonusPoints ?? pointsCfg.approvedBonusPoints,
                        };
                      }
                    }
                  } catch { /* 兼容老库读不到列 */ }

                  // 终审通过发放创新积分。后续可同时发放 research_collaboration
                  // （需按小组均分），当前阶段仅写一个维度以保证账本准确。
                  await pointsLedger.addPoints(
                    subRow.student_id,
                    classIdForLedger,
                    'research_innovation',
                    pointsCfg.approvedBonusPoints,
                    `课题成果审核通过 (终得分: ${totalScore})`,
                    'lianyun-course'
                  );
                } catch (e) {
                  ctx.log?.warn(`[lianyun-course] addPoints failed for submission=${submissionId}:`, e);
                }
              }
            }
          } catch (e) {
            ctx.log?.warn(`[lianyun-course] INSERT review path failed for ${revId}, using memory store:`, e);
            memStore.reviews.set(revId, revRecord);
          }
        } else {
          memStore.reviews.set(revId, revRecord);
        }

        await publishEvent('research.work_approved', { submissionId, decision, totalScore, timestamp: Date.now() });

        return { success: true, reviewId: revId, decision, totalScore };
      },
    });

    // 3.5 触发后台进程异步 ZIP 导出归档
    await commandBus.registerHandler('research.trigger_export', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.EXPORT);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { activityId } = command.payload || {};
        const taskId = `export_${Date.now()}`;
        let processId: string | undefined;

        if (processManager?.spawn) {
          try {
            processId = (await processManager.spawn(
              `Export_${activityId}`,
              'research_zip_export',
              { activityId, taskId },
            )) as string;
          } catch (e) {
            ctx.log?.warn('[lianyun-course] processManager.spawn failed, falling back to sync export:', e);
          }
        }

        // 同步 fallback：spawn 不可用或未注册 handler 时，直接在当前调用
        // 路径同步打包，避免用户看到「开始导出」后永远无反馈。
        if (!processId) {
          try {
            const { manifest } = await buildActivityZip(
              activityId,
              rawDb,
              storage,
              taskId,
              (msg) => ctx.log?.info?.(`[export:${taskId}] ${msg}`),
            );
            await publishEvent('research.export_completed', {
              activityId,
              taskId,
              downloadKey: manifest.downloadKey,
              sizeBytes: manifest.sizeBytes,
              timestamp: Date.now(),
            });
            return {
              success: true,
              taskId,
              message: '课题 ZIP 导出已完成。',
              downloadKey: manifest.downloadKey,
              downloadUrl: `/storage/${manifest.downloadKey}`,
            };
          } catch (e: any) {
            await publishEvent('research.export_failed', {
              activityId,
              taskId,
              error: e?.message ?? String(e),
              timestamp: Date.now(),
            });
            return { success: false, taskId, error: e?.message ?? String(e) };
          }
        }

        // 异步路径：handler 完成时会自己 publish export_completed，
        // 这里只返回任务已启动。
        return {
          success: true,
          taskId,
          processId,
          message: '后台 ZIP 导出任务已成功启动，完成后将自动发送通知',
          downloadUrl: `/storage/exports/research_activity_${activityId}.zip`,
        };
      },
    });

    // 4. AI Action：只读检查命令，与 submit_work 彻底解耦。
    //   旧版使用 commandType='research.submit_work' 会让 Agent 调用
    //   误以为是重新提交。现分离为 research.check_completeness，
    //   Agent 只读到只读诊断结果，不会创建新的 submission 行。
    await commandBus.registerHandler('research.check_completeness', {
      async execute(command: any) {
        const cap = await assertCapability(ctx, capabilityService, getActorId(command), CAP.READ);
        if (!cap.allowed) return { success: false, error: cap.reason };
        const { submissionId } = command.payload || {};
        if (!submissionId || !rawDb?.prepare) {
          return { success: false, error: 'submissionId 必填且需要数据库可用' };
        }
        try {
          const row: any = rawDb.prepare('SELECT * FROM plugin_research_submissions WHERE id = ?').get(submissionId);
          if (!row) return { success: false, error: 'submission not found' };
          let aiCheck = null;
          try { aiCheck = typeof row.ai_check_result === 'string' ? JSON.parse(row.ai_check_result) : row.ai_check_result; } catch {}
          return {
            success: true,
            submissionId,
            status: row.status,
            version: row.version,
            aiCheck,
            suggestions: [
              '检查参考文献是否完整且格式一致（GB/T 7714 或 APA）。',
              '如包含数据表格，建议补充图表标题与坐标轴说明。',
              '代码类材料请加 README 说明运行环境与依赖。',
            ],
          };
        } catch (e) {
          ctx.log?.warn(`[lianyun-course] check_completeness ${submissionId} failed:`, e);
          return { success: false, error: '数据库读取失败' };
        }
      },
    });

    await actionRegistry.register({
      id: 'research-check-completeness',
      commandType: 'research.check_completeness',
      description: '对研究性学习成果进行提交物完整性校验、格式审查与参考文献引证建议（只读，不创建新提交）',
      capabilityRequired: 'research:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          activityId: { type: 'STRING', description: '课题活动 ID' },
          submissionId: { type: 'STRING', description: '成果提交单 ID' },
        },
      },
    });

    // 后台异步执行 DB schema 初始化、积分维度注册、Activity Provider 注册
    // 不阻塞 activate 返回（CHANGELOG 1.2.0 优化承诺）。
    void initServicesAndDb().catch((e) => {
      ctx.log?.warn('[lianyun-course] background initServicesAndDb failed:', e);
    });

    ctx.log?.info('ResearchWorkflowPlugin (Server) activated successfully.');
  },

  async deactivate() {
    // SDK 签名要求 deactivate 不接参数；PluginContext 在 deactivate
    // 阶段不保证可用。保留 _ctx 仅供调试使用，生产路径不依赖。
  },
};
