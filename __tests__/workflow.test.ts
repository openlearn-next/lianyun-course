import { describe, it, expect, beforeEach } from 'vitest';
import plugin from '../src/index.js';
import { WorkflowStateMachine } from '../src/domain/workflow-state-machine.js';
import { createMockContext, createWiredMockContext, MockContext } from './helpers/mock-context.js';

describe('Research Learning Workflow Plugin - Unit & Integration Tests', () => {
  let mockCtx: MockContext;

  beforeEach(() => {
    mockCtx = createMockContext({ pluginId: 'lianyun-course' });
  });

  describe('Workflow State Machine Guards', () => {
    const config = {
      enableGrouping: true,
      maxGroupMembers: 5,
      enablePeerReview: true,
      peerReviewsPerStudent: 2,
      allowLateSubmission: false,
      aiPreCheckEnabled: true,
      pointsConfig: { submissionBasePoints: 20, peerReviewPoints: 10, approvedBonusPoints: 50 },
    };

    it('should allow valid transition DRAFT -> PUBLISHED', () => {
      const res = WorkflowStateMachine.canTransition('DRAFT', 'PUBLISHED', config);
      expect(res.allowed).toBe(true);
      expect(res.nextPhase).toBe('PUBLISHED');
    });

    it('should reject invalid transition DRAFT -> SUBMISSION directly', () => {
      const res = WorkflowStateMachine.canTransition('DRAFT', 'SUBMISSION', config);
      expect(res.allowed).toBe(false);
    });

    it('should reject PEER_REVIEW -> TEACHER_REVIEW if coverage < 50%', () => {
      const res = WorkflowStateMachine.canTransition('PEER_REVIEW', 'TEACHER_REVIEW', config, { peerReviewCoverage: 0.3 });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('同伴互评覆盖率需达到至少 50%');
    });

    it('should treat same-phase clicks as a no-op', () => {
      const res = WorkflowStateMachine.canTransition('GROUPING', 'GROUPING', config);
      expect(res.allowed).toBe(true);
      expect(res.nextPhase).toBe('GROUPING');
    });

    it('should reject GROUPING transition when enableGrouping=false', () => {
      const cfg = { ...config, enableGrouping: false };
      const res = WorkflowStateMachine.canTransition('PUBLISHED', 'GROUPING', cfg);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('分组功能未在当前课题配置中开启');
    });
  });

  describe('Plugin Activation & Command Execution (memory-store fallback path)', () => {
    it('should activate successfully without error', async () => {
      await expect(plugin.activate(mockCtx as any)).resolves.not.toThrow();
    });

    it('should execute research.create_activity command handler', async () => {
      await plugin.activate(mockCtx as any);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.create_activity',
        payload: { title: 'PBL STEAM Study', teacherId: 'teacher_1' },
      });

      expect(res.success).toBe(true);
      expect(res.activityId).toBeDefined();
    });

    it('should execute research.submit_work command handler and generate AI check', async () => {
      await plugin.activate(mockCtx as any);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.submit_work',
        payload: { activityId: 'act_101', studentId: 'student_1', title: 'Phase 1 Report', attachments: [{ name: 'doc.pdf' }] },
      });

      expect(res.success).toBe(true);
      expect(res.version).toBe(1);
      expect(res.aiCheck.passed).toBe(true);
    });

    it('should execute research.trigger_export command handler', async () => {
      await plugin.activate(mockCtx as any);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.trigger_export',
        payload: { activityId: 'act_101' },
      });

      // Without rawDb available, sync fallback should error gracefully.
      expect(res).toBeDefined();
      expect(res.taskId).toBeDefined();
    });

    it('should execute research.delete_activity command handler', async () => {
      await plugin.activate(mockCtx as any);
      const createRes = await mockCtx.services.commandBus.execute({
        type: 'research.create_activity',
        payload: { title: 'To Be Deleted' },
      });
      const activityId = createRes.activityId;

      const delRes = await mockCtx.services.commandBus.execute({
        type: 'research.delete_activity',
        payload: { activityId },
      });

      expect(delRes.success).toBe(true);
    });

    it('should reject research.delete_activity without activityId', async () => {
      await plugin.activate(mockCtx as any);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.delete_activity',
        payload: {},
      });
      expect(res.success).toBe(false);
    });

    it('should execute research.evaluate_submission with empty scores', async () => {
      await plugin.activate(mockCtx as any);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.evaluate_submission',
        payload: { submissionId: 'sub_101', decision: 'APPROVE', scores: [] },
      });
      expect(res.success).toBe(true);
      expect(res.decision).toBe('APPROVE');
      expect(res.totalScore).toBe(0);
    });

    it('should reject command when capability service denies', async () => {
      // 创建独立的 mock context，其中 capability.check 返回 false。
      const strictCtx = createMockContext({ pluginId: 'lianyun-course' });
      strictCtx.resolve = (async (token: any) => {
        const id = String(token?.name || token?.id || '');
        if (id.includes('ICapabilityService')) {
          return { async check() { return false; } };
        }
        return null;
      }) as any;
      await plugin.activate(strictCtx as any);
      // 等待 initServicesAndDb 完成（含 500ms resolve 超时）
      await new Promise((r) => setTimeout(r, 600));
      const res = await strictCtx.services.commandBus.execute({
        type: 'research.create_activity',
        payload: { title: 'Should Fail' },
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('research:write');
    });

    it('should reject command without actorId', async () => {
      const strictCtx = createMockContext({ pluginId: 'lianyun-course' });
      strictCtx.resolve = (async () => ({
        async check() { return true; },
      })) as any;
      await plugin.activate(strictCtx as any);
      await new Promise((r) => setTimeout(r, 600));
      // Override handler to bypass mock's actorId auto-fill.
      const h = strictCtx._handlers.get('research.create_activity');
      const res = await h!.execute({ type: 'research.create_activity', payload: { title: 'X' } });
      expect(res.success).toBe(false);
      expect(res.error).toContain('actorId');
    });

    it('should execute research.check_completeness as a read-only command', async () => {
      const wired = createWiredMockContext({ pluginId: 'lianyun-course' });
      await plugin.activate(wired as any);
      await new Promise((r) => setTimeout(r, 600));

      // 先创建一个提交单
      const sub = await wired.services.commandBus.execute({
        type: 'research.submit_work',
        payload: {
          activityId: 'act_check',
          studentId: 'stu_1',
          title: 'Test Submission',
          attachments: [{ name: 'a.pdf' }],
        },
      });
      expect(sub.success).toBe(true);

      const check = await wired.services.commandBus.execute({
        type: 'research.check_completeness',
        payload: { submissionId: sub.submissionId },
      });
      if (!check.success) {
        // 提供更好的报错信息帮助调试
        throw new Error(`check_completeness failed: ${check.error} (sub: ${JSON.stringify(sub)})`);
      }
      expect(check.success).toBe(true);
      expect(check.aiCheck).toBeDefined();
      expect(Array.isArray(check.suggestions)).toBe(true);
    });
  });

  describe('Plugin Activation with wired DI (SQLite-backed path)', () => {
    let wiredCtx: MockContext;

    beforeEach(() => {
      wiredCtx = createWiredMockContext({ pluginId: 'lianyun-course' });
    });

    it('should initialize schema and run create_activity end-to-end through SQLite', async () => {
      await plugin.activate(wiredCtx as any);
      // Allow background initServicesAndDb to complete.
      await new Promise((r) => setTimeout(r, 50));

      const res = await wiredCtx.services.commandBus.execute({
        type: 'research.create_activity',
        payload: {
          title: 'Wired PBL',
          teacherId: 'teacher_x',
          classId: 'class_alpha',
        },
      });
      expect(res.success).toBe(true);

      const list = await wiredCtx.services.commandBus.execute({
        type: 'research.get_activities',
        payload: {},
      });
      expect(list.success).toBe(true);
      expect(Array.isArray(list.activities)).toBe(true);
      const created = list.activities.find((a: any) => a.id === res.activityId);
      expect(created).toBeDefined();
      expect(created.title).toBe('Wired PBL');
    });
  });
});
