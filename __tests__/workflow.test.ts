import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import plugin from '../src/index.js';
import { WorkflowStateMachine } from '../src/domain/workflow-state-machine.js';

describe('Research Learning Workflow Plugin - Unit & Integration Tests', () => {
  let mockCtx: any;

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
  });

  describe('Plugin Activation & Command Execution', () => {
    it('should activate successfully without error', async () => {
      await expect(plugin.activate(mockCtx)).resolves.not.toThrow();
    });

    it('should execute research.create_activity command handler', async () => {
      await plugin.activate(mockCtx);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.create_activity',
        payload: { title: 'PBL STEAM Study', teacherId: 'teacher_1' },
      });

      expect(res.success).toBe(true);
      expect(res.activityId).toBeDefined();
    });

    it('should execute research.submit_work command handler and generate AI check', async () => {
      await plugin.activate(mockCtx);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.submit_work',
        payload: { activityId: 'act_101', studentId: 'student_1', title: 'Phase 1 Report', attachments: [{ name: 'doc.pdf' }] },
      });

      expect(res.success).toBe(true);
      expect(res.version).toBe(1);
      expect(res.aiCheck.passed).toBe(true);
    });

    it('should execute research.trigger_export command handler', async () => {
      await plugin.activate(mockCtx);
      const res = await mockCtx.services.commandBus.execute({
        type: 'research.trigger_export',
        payload: { activityId: 'act_101' },
      });

      expect(res.success).toBe(true);
      expect(res.downloadUrl).toContain('.zip');
    });
  });
});
