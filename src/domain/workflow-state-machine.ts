/**
 * Research Learning Workflow — State Machine & Guard Rule Engine
 */

import type { ResearchPhase, WorkflowConfig } from '../types.js';

export interface TransitionResult {
  allowed: boolean;
  nextPhase: ResearchPhase;
  reason?: string;
}

export class WorkflowStateMachine {
  /**
   * Calculate the next legal phase given current phase and workflow configuration guards.
   */
  public static canTransition(
    currentPhase: ResearchPhase,
    targetPhase: ResearchPhase,
    config?: WorkflowConfig,
    context?: { submissionCount?: number; peerReviewCoverage?: number; isTeacher?: boolean; override?: boolean }
  ): TransitionResult {
    // 0. 点击当前相同阶段 -> 直接允许 (No-op)
    if (currentPhase === targetPhase) {
      return { allowed: true, nextPhase: targetPhase };
    }

    // 教师/管理员强制覆盖模式 -> 放行
    if (context?.override) {
      return { allowed: true, nextPhase: targetPhase };
    }

    const cfg = config || {
      enableGrouping: true,
      maxGroupMembers: 5,
      enablePeerReview: true,
      peerReviewsPerStudent: 2,
      allowLateSubmission: false,
      aiPreCheckEnabled: true,
      pointsConfig: { submissionBasePoints: 20, peerReviewPoints: 10, approvedBonusPoints: 50 },
    };

    // 1. DRAFT -> PUBLISHED
    if (currentPhase === 'DRAFT' && targetPhase === 'PUBLISHED') {
      return { allowed: true, nextPhase: 'PUBLISHED' };
    }

    // 2. PUBLISHED -> GROUPING or IN_PROGRESS
    if (currentPhase === 'PUBLISHED') {
      if (targetPhase === 'GROUPING') {
        if (!cfg.enableGrouping) {
          return { allowed: false, nextPhase: currentPhase, reason: '分组功能未在当前课题配置中开启' };
        }
        return { allowed: true, nextPhase: 'GROUPING' };
      }
      if (targetPhase === 'IN_PROGRESS') {
        return { allowed: true, nextPhase: 'IN_PROGRESS' };
      }
    }

    // 3. GROUPING -> IN_PROGRESS
    if (currentPhase === 'GROUPING' && targetPhase === 'IN_PROGRESS') {
      return { allowed: true, nextPhase: 'IN_PROGRESS' };
    }

    // 4. IN_PROGRESS -> SUBMISSION
    if (currentPhase === 'IN_PROGRESS' && targetPhase === 'SUBMISSION') {
      return { allowed: true, nextPhase: 'SUBMISSION' };
    }

    // 5. SUBMISSION -> PEER_REVIEW or TEACHER_REVIEW
    if (currentPhase === 'SUBMISSION') {
      if (targetPhase === 'PEER_REVIEW') {
        if (!cfg.enablePeerReview) {
          return { allowed: false, nextPhase: currentPhase, reason: '同伴互评功能未在当前课题配置中开启' };
        }
        return { allowed: true, nextPhase: 'PEER_REVIEW' };
      }
      if (targetPhase === 'TEACHER_REVIEW') {
        return { allowed: true, nextPhase: 'TEACHER_REVIEW' };
      }
    }

    // 6. PEER_REVIEW -> TEACHER_REVIEW
    if (currentPhase === 'PEER_REVIEW' && targetPhase === 'TEACHER_REVIEW') {
      const coverage = context?.peerReviewCoverage ?? 1.0;
      if (coverage < 0.5) {
        return { allowed: false, nextPhase: currentPhase, reason: `同伴互评覆盖率需达到至少 50%（当前 ${Math.round(coverage * 100)}%）` };
      }
      return { allowed: true, nextPhase: 'TEACHER_REVIEW' };
    }

    // 7. TEACHER_REVIEW -> SUBMISSION (Return) or POINTS_AWARDED (Approve)
    if (currentPhase === 'TEACHER_REVIEW') {
      if (targetPhase === 'SUBMISSION') {
        return { allowed: true, nextPhase: 'SUBMISSION', reason: '教师退回成果重交' };
      }
      if (targetPhase === 'POINTS_AWARDED') {
        return { allowed: true, nextPhase: 'POINTS_AWARDED' };
      }
    }

    // 8. POINTS_AWARDED -> ARCHIVED
    if (currentPhase === 'POINTS_AWARDED' && targetPhase === 'ARCHIVED') {
      return { allowed: true, nextPhase: 'ARCHIVED' };
    }

    return {
      allowed: false,
      nextPhase: currentPhase,
      reason: `非法状态转换：无法直接从 ${currentPhase} 切换至 ${targetPhase}`,
    };
  }
}
