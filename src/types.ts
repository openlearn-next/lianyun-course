/**
 * Research Learning Workflow Plugin — TypeScript Interfaces & Domain Definitions
 */

export type ResearchPhase =
  | 'DRAFT'           // 草稿
  | 'PUBLISHED'       // 已发布
  | 'GROUPING'        // 团队分组中
  | 'IN_PROGRESS'     // 课题研究实施中
  | 'SUBMISSION'      // 成果提交中
  | 'PEER_REVIEW'     // 同伴盲审互评
  | 'TEACHER_REVIEW'  // 教师/助教终审打分
  | 'POINTS_AWARDED'  // 积分发放与结算
  | 'ARCHIVED';       // 课题项目已归档

export interface WorkflowConfig {
  enableGrouping: boolean;
  maxGroupMembers: number;
  enablePeerReview: boolean;
  peerReviewsPerStudent: number;
  allowLateSubmission: boolean;
  aiPreCheckEnabled: boolean;
  allowedFileTypes: string[];        // 允许提交的材料文件格式 (如: ['.pdf', '.docx', '.zip', '.mp4'])
  maxFileSizeMB: number;             // 单个附件文件容量上限 (MB)
  requiredMinAttachments: number;    // 成果提交至少包含的附件份数
  pointsConfig: {
    submissionBasePoints: number;
    peerReviewPoints: number;
    approvedBonusPoints: number;
  };
}

export interface RubricItem {
  id: string;
  name: string;
  maxScore: number;
  description?: string;
}

export interface ResearchActivity {
  id: string;
  title: string;
  description: string;
  teacherId: string;
  currentPhase: ResearchPhase;
  config: WorkflowConfig;
  rubrics: RubricItem[];
  createdAt: number;
  updatedAt: number;
}

export interface ClassStudent {
  id: string;
  name: string;
  studentNo: string;
  avatar?: string;
}

export interface ClassItem {
  id: string;
  name: string;
  grade: string;
  students: ClassStudent[];
}

export interface GroupMemberDetail {
  studentId: string;
  name: string;
  isLeader: boolean;
  taskRole?: string;
  online?: boolean;
}

export interface ResearchGroup {
  id: string;
  activityId: string;
  classId?: string;
  groupName: string;
  leaderStudentId: string;
  memberIds: string[];
  members?: GroupMemberDetail[];
  createdAt: number;
}

export interface AttachmentFile {
  name: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface AICheckResult {
  passed: boolean;
  completenessScore: number; // 0 ~ 100
  missingElements: string[];
  recommendations: string[];
  checkedAt: number;
}

export interface ResearchSubmission {
  id: string;
  activityId: string;
  groupId?: string | null;
  studentId: string;
  version: number;
  title: string;
  summary: string;
  attachments: AttachmentFile[];
  aiCheckResult?: AICheckResult | null;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'RETURNED' | 'APPROVED';
  createdAt: number;
}

export interface ReviewScore {
  rubricId: string;
  score: number;
}

export interface ResearchReview {
  id: string;
  submissionId: string;
  reviewerId: string;
  reviewType: 'PEER' | 'TEACHER';
  scores: ReviewScore[];
  totalScore: number;
  comments: string;
  decision: 'APPROVE' | 'RETURN';
  createdAt: number;
}

export interface ResearchPointsLog {
  id: string;
  studentId: string;
  activityId: string;
  dimensionId: string;
  deltaPoints: number;
  reason: string;
  createdAt: number;
}
