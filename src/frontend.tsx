/**
 * 恋云课程 (Lianyun Course) Plugin — Frontend Components & Extension Registration (dist/frontend.js)
 * 
 * 核心特性：
 * 1. 教师端：班级选择、随机自动分组（按每组人数/总组数）、拖拽/下拉移动分组、指定组长、一键重分
 * 2. 学生端：专属团队看板、👑 组长勋章高亮、组长代表团队提交特权与组内分工协作
 * 3. 教师端：成果终审 (Approve/Return) 与全课题 ZIP 打包导出
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ClassItem, ClassStudent, ResearchGroup, GroupMemberDetail } from './types.js';

let ctx: any = null;

export interface ProjectConfig {
  enableGrouping: boolean;
  maxGroupMembers: number;
  enablePeerReview: boolean;
  peerReviewsPerStudent: number;
  allowLateSubmission: boolean;
  aiPreCheckEnabled: boolean;
  allowedFileTypes: string[];
  maxFileSizeMB: number;
  requiredMinAttachments: number;
}

export interface ProjectItem {
  id: string;
  title: string;
  description: string;
  teacherId: string;
  currentPhase: string;
  config: ProjectConfig;
  createdAt: number;
}

// 常见文件格式选项
const FILE_TYPE_OPTIONS = [
  { label: '📄 文档报告 (.pdf, .docx, .pptx)', exts: ['.pdf', '.docx', '.pptx'] },
  { label: '📦 源码与工程包 (.zip, .rar, .7z)', exts: ['.zip', '.rar', '.7z'] },
  { label: '📹 视频汇报 (.mp4, .mov)', exts: ['.mp4', '.mov'] },
  { label: '📊 实验数据表 (.xlsx, .csv)', exts: ['.xlsx', '.csv'] },
  { label: '🖼️ 设计图纸与矢量图 (.png, .jpg, .svg)', exts: ['.png', '.jpg', '.svg'] },
];

// 1. 浅色 9 阶段 Stepper 组件
function WorkflowPhaseStepper({ currentPhase, onSelectPhase, isTeacher }: { currentPhase: string; onSelectPhase?: (phase: string) => void; isTeacher?: boolean }) {
  const phases = [
    { key: 'DRAFT', label: '草稿', icon: '📝' },
    { key: 'PUBLISHED', label: '已发布', icon: '🚀' },
    { key: 'GROUPING', label: '团队分组', icon: '👥' },
    { key: 'IN_PROGRESS', label: '探究实施', icon: '🔬' },
    { key: 'SUBMISSION', label: '成果提交', icon: '📤' },
    { key: 'PEER_REVIEW', label: '盲审互评', icon: '🔍' },
    { key: 'TEACHER_REVIEW', label: '教师终审', icon: '👨‍🏫' },
    { key: 'POINTS_AWARDED', label: '积分结算', icon: '🏆' },
    { key: 'ARCHIVED', label: '归档导出', icon: '📦' },
  ];

  const activeIdx = phases.findIndex((p) => p.key === currentPhase);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', padding: '12px 16px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      {phases.map((p, idx) => {
        const isCurrent = p.key === currentPhase;
        const isPassed = idx < activeIdx;
        return (
          <React.Fragment key={p.key}>
            <button
              onClick={() => isTeacher && onSelectPhase?.(p.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: isCurrent ? '2px solid #2563eb' : '1px solid #cbd5e1',
                backgroundColor: isCurrent ? '#2563eb' : isPassed ? '#e2e8f0' : '#ffffff',
                color: isCurrent ? '#ffffff' : isPassed ? '#334155' : '#64748b',
                cursor: isTeacher ? 'pointer' : 'default',
                fontSize: 12,
                fontWeight: isCurrent ? '600' : '500',
                whiteSpace: 'nowrap',
                boxShadow: isCurrent ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </button>
            {idx < phases.length - 1 && (
              <span style={{ color: '#94a3b8', fontSize: 10, userSelect: 'none' }}>➔</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// 2. 主页面控制台 (包含 教师端 / 学生端 角色视角)
export function ResearchWorkspaceMainView() {
  const [role, setRole] = useState<'teacher' | 'student'>('teacher');
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [classList, setClassList] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  // 组件加载时自动连接 SQLite 及平台 /api/classes 接口读取真实班级与学生名册
  useEffect(() => {
    let isMounted = true;
    const fetchRealClasses = async () => {
      if (ctx?.invokeCommand) {
        try {
          const res = await ctx.invokeCommand('research.get_classes', {});
          if (res?.success && res.classes && res.classes.length > 0 && isMounted) {
            setClassList(res.classes);
            setSelectedClassId(res.classes[0].id);
            return;
          }
        } catch (e) {}
      }

      // REST API Fallback (直接查询平台 Node.js 后端 /api/classes)
      try {
        const res = await fetch('/api/classes').then((r) => r.json());
        if (Array.isArray(res) && res.length > 0 && isMounted) {
          const formattedClasses = await Promise.all(
            res.map(async (c: any) => {
              const students = await fetch(`/api/classes/${c.id}/students`).then((r) => r.json()).catch(() => []);
              return {
                id: c.id,
                name: c.name,
                grade: c.description || '平台注册真实班级',
                students: students.map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  studentNo: s.student_number || s.id,
                  avatar: s.name.endsWith('娜') || s.name.endsWith('洋') || s.name.endsWith('敏') || s.name.endsWith('婷') ? '👩‍🎓' : '👨‍🎓',
                })),
              };
            })
          );
          setClassList(formattedClasses);
          setSelectedClassId(formattedClasses[0].id);
        }
      } catch (e) {}
    };

    fetchRealClasses();
    return () => {
      isMounted = false;
    };
  }, []);
  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // 教师端：自动分组参数
  const [autoGroupSize, setAutoGroupSize] = useState<number>(4);

  // 项目分组映射表 (activityId -> ResearchGroup[])
  const [projectGroups, setProjectGroups] = useState<Record<string, ResearchGroup[]>>({});

  // 表单状态：教师端新建项目
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEnableGrouping, setNewEnableGrouping] = useState(true);
  const [newMaxMembers, setNewMaxMembers] = useState(4);
  const [newEnablePeerReview, setNewEnablePeerReview] = useState(true);
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>(['.pdf', '.docx', '.zip', '.mp4']);

  // 提交物列表
  const [projectSubmissions, setProjectSubmissions] = useState<Record<string, any[]>>({});

  // 学生端状态
  const [studentSubTitle, setStudentSubTitle] = useState('');
  const [studentSubSummary, setStudentSubSummary] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [formatError, setFormatError] = useState<string | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const activeClass = classList.find((c) => c.id === selectedClassId) || classList[0] || null;
  const activeGroups = activeProject ? (projectGroups[activeProject.id] || []) : [];
  const activeSubs = activeProject ? (projectSubmissions[activeProject.id] || []) : [];

  // 获取尚未分配到小组的学生列表
  const assignedStudentIds = new Set(activeGroups.flatMap((g) => g.memberIds));
  const unassignedStudents = activeClass ? activeClass.students.filter((s) => !assignedStudentIds.has(s.id)) : [];

  // 教师端：一键自动随机分组算法
  const handleAutoRandomGrouping = () => {
    if (!activeProject || !activeClass) return;
    const students = [...activeClass.students];
    // 洗牌算法 Shuffle
    for (let i = students.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [students[i], students[j]] = [students[j], students[i]];
    }

    const groupSize = Math.max(2, autoGroupSize);
    const newGroupList: ResearchGroup[] = [];
    let groupIdx = 1;

    for (let i = 0; i < students.length; i += groupSize) {
      const chunk = students.slice(i, i + groupSize);
      if (chunk.length === 0) continue;

      const leader = chunk[0]; // 第一个学生自动设为组长
      const memberDetails: GroupMemberDetail[] = chunk.map((s, idx) => ({
        studentId: s.id,
        name: s.name,
        isLeader: idx === 0,
        taskRole: idx === 0 ? '组长/整体统筹' : '组员/探究协作',
        online: true,
      }));

      newGroupList.push({
        id: `grp_${Date.now()}_${groupIdx}`,
        activityId: activeProject.id,
        classId: selectedClassId,
        groupName: `第 ${groupIdx} 小组 (${leader.name}队)`,
        leaderStudentId: leader.id,
        memberIds: chunk.map((s) => s.id),
        members: memberDetails,
        createdAt: Date.now(),
      });
      groupIdx++;
    }

    setProjectGroups({
      ...projectGroups,
      [activeProject.id]: newGroupList,
    });

    if (ctx?.invokeCommand) {
      ctx.invokeCommand('research.save_groups', {
        activityId: activeProject.id,
        classId: selectedClassId,
        groups: newGroupList,
      }).catch(() => {});
    }

    alert(`已完成【${activeClass.name}】的自动随机分组！共生成 ${newGroupList.length} 个探究小组。`);
  };

  // 教师端：指定/更换组长
  const handleSetLeader = (groupId: string, newLeaderId: string) => {
    if (!activeProject) return;
    const updatedGroups = activeGroups.map((grp) => {
      if (grp.id !== groupId) return grp;
      const updatedMembers = (grp.members || []).map((m) => ({
        ...m,
        isLeader: m.studentId === newLeaderId,
        taskRole: m.studentId === newLeaderId ? '组长/整体统筹' : '组员/探究协作',
      }));
      return {
        ...grp,
        leaderStudentId: newLeaderId,
        members: updatedMembers,
      };
    });

    setProjectGroups({ ...projectGroups, [activeProject.id]: updatedGroups });
  };

  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // 教师端：支持组间拖拽/下拉移动学生 (支持组间拖拽与未分组池平移)
  const handleMoveMember = (sourceGroupId: string, targetGroupId: string, studentId: string) => {
    if (!activeProject || !activeClass || sourceGroupId === targetGroupId) return;

    let movedStudentDetail: GroupMemberDetail | undefined;

    // 1. 从未分组池拖入目标小组
    if (sourceGroupId === 'unassigned') {
      const studentObj = activeClass.students.find((s) => s.id === studentId);
      if (!studentObj) return;
      movedStudentDetail = {
        studentId: studentObj.id,
        name: studentObj.name,
        isLeader: false,
        taskRole: '组员/探究协作',
        online: true,
      };

      const finalGroups = activeGroups.map((grp) => {
        if (grp.id !== targetGroupId) return grp;
        const isFirst = (grp.members || []).length === 0;
        return {
          ...grp,
          leaderStudentId: isFirst ? studentId : (grp.leaderStudentId || studentId),
          memberIds: [...grp.memberIds, studentId],
          members: [...(grp.members || []), { ...movedStudentDetail!, isLeader: isFirst }],
        };
      });

      setProjectGroups({ ...projectGroups, [activeProject.id]: finalGroups });
      return;
    }

    // 2. 从原小组移出
    const groupsAfterRemove = activeGroups.map((grp) => {
      if (grp.id !== sourceGroupId) return grp;
      movedStudentDetail = grp.members?.find((m) => m.studentId === studentId);
      const newMembers = (grp.members || []).filter((m) => m.studentId !== studentId);
      const newLeader = grp.leaderStudentId === studentId ? (newMembers[0]?.studentId || '') : grp.leaderStudentId;
      return {
        ...grp,
        leaderStudentId: newLeader,
        memberIds: grp.memberIds.filter((id) => id !== studentId),
        members: newMembers.map((m) => ({ ...m, isLeader: m.studentId === newLeader })),
      };
    });

    // 3. 移至未分组池 ('unassigned')
    if (targetGroupId === 'unassigned') {
      setProjectGroups({ ...projectGroups, [activeProject.id]: groupsAfterRemove });
      return;
    }

    // 4. 移入目标小组
    if (movedStudentDetail) {
      const finalGroups = groupsAfterRemove.map((grp) => {
        if (grp.id !== targetGroupId) return grp;
        const isFirst = (grp.members || []).length === 0;
        return {
          ...grp,
          leaderStudentId: isFirst ? studentId : (grp.leaderStudentId || studentId),
          memberIds: [...grp.memberIds, studentId],
          members: [...(grp.members || []), { ...movedStudentDetail!, isLeader: isFirst }],
        };
      });
      setProjectGroups({ ...projectGroups, [activeProject.id]: finalGroups });
    }
  };

  // 教师端：更新阶段
  const handleUpdatePhase = async (newPhase: string) => {
    if (!activeProject) return;
    if (activeProject.currentPhase === newPhase) return;

    if (ctx?.invokeCommand) {
      try {
        const res = await ctx.invokeCommand('research.update_phase', {
          activityId: activeProject.id,
          currentPhase: activeProject.currentPhase,
          targetPhase: newPhase,
          override: true,
        });
        if (res?.success) {
          setProjects(projects.map((p) => (p.id === activeProject.id ? { ...p, currentPhase: newPhase } : p)));
        } else {
          alert(`状态变更失败: ${res?.error || '受 Guard 规则约束限制'}`);
        }
      } catch (e: any) {
        setProjects(projects.map((p) => (p.id === activeProject.id ? { ...p, currentPhase: newPhase } : p)));
      }
    } else {
      setProjects(projects.map((p) => (p.id === activeProject.id ? { ...p, currentPhase: newPhase } : p)));
    }
  };

  // 教师端：新建学习项目
  const handleCreateProject = async () => {
    if (!newTitle.trim()) {
      alert('请输入学习项目名称');
      return;
    }

    const projectId = `act_${Date.now()}`;
    const newProj: ProjectItem = {
      id: projectId,
      title: newTitle,
      description: newDesc || '暂无项目背景描述',
      teacherId: 'teacher_admin',
      currentPhase: 'DRAFT',
      config: {
        enableGrouping: newEnableGrouping,
        maxGroupMembers: newMaxMembers,
        enablePeerReview: newEnablePeerReview,
        peerReviewsPerStudent: 2,
        allowLateSubmission: false,
        aiPreCheckEnabled: true,
        allowedFileTypes: selectedFileTypes.length > 0 ? selectedFileTypes : ['.pdf', '.zip'],
        maxFileSizeMB: 50,
        requiredMinAttachments: 1,
      },
      createdAt: Date.now(),
    };

    setProjects([newProj, ...projects]);
    setProjectGroups({ ...projectGroups, [projectId]: [] });
    setProjectSubmissions({ ...projectSubmissions, [projectId]: [] });
    setActiveProjectId(projectId);
    setShowCreateModal(false);
    setNewTitle('');
    setNewDesc('');
  };

  // 教师端：删除课题 (含关联分组与提交记录)
  const handleDeleteProject = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;
    if (!confirm(`确定要删除课题「${target.title}」吗？\n该课题下的分组与提交记录将一并移除，且不可恢复。`)) {
      return;
    }

    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    setProjectGroups((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    setProjectSubmissions((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    // 若删除的是当前激活课题，则自动选中剩余第一个课题
    if (activeProjectId === projectId) {
      setActiveProjectId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  // 教师端：成果终审
  const handleTeacherEvaluate = async (subId: string, decision: 'APPROVE' | 'RETURN') => {
    if (!activeProject) return;
    const updatedSubs = activeSubs.map((s) => (s.id === subId ? { ...s, status: decision === 'APPROVE' ? 'APPROVED' : 'RETURNED' } : s));
    setProjectSubmissions({ ...projectSubmissions, [activeProject.id]: updatedSubs });
  };

  // 教师端：触发 ZIP 打包导出
  const handleTriggerExport = async () => {
    if (!activeProject) return;
    setExportStatus(`正在为课题【${activeProject.title}】启动后台 ZIP 归档打包任务...`);

    if (ctx?.invokeCommand) {
      try {
        const res = await ctx.invokeCommand('research.trigger_export', { activityId: activeProject.id });
        if (res?.success) {
          setExportStatus(`课题【${activeProject.title}】打包完成！下载地址: ${res.downloadUrl}`);
        }
      } catch (e) {
        setExportStatus(`课题【${activeProject.title}】后台 ZIP 归档任务已触发 (模拟中)`);
      }
    } else {
      setExportStatus(`课题【${activeProject.title}】后台 ZIP 归档任务已触发 (模拟中)`);
    }
  };

  // 学生端：校验提交文件格式
  const handleFileSelectMock = (fileName: string) => {
    if (!activeProject) return;
    setSelectedFileName(fileName);

    const ext = '.' + fileName.split('.').pop()?.toLowerCase();
    const allowed = activeProject.config.allowedFileTypes || ['.pdf', '.zip'];

    if (!allowed.includes(ext) && !allowed.includes('*')) {
      setFormatError(`⚠️ 格式错误：教师设置本课题仅允许提交 ${allowed.join(', ')} 格式，当前文件 ${ext} 不受支持。`);
    } else {
      setFormatError(null);
    }
  };

  // 学生端：提交成果
  const handleStudentSubmit = async () => {
    if (!studentSubTitle.trim() || !activeProject) {
      alert('请输入成果名称');
      return;
    }
    if (formatError) {
      alert(formatError);
      return;
    }

    const newSub = {
      id: `sub_${Date.now()}`,
      version: activeSubs.length + 1,
      studentId: '张伟 (代表第 1 小组提交)',
      title: studentSubTitle,
      summary: studentSubSummary,
      fileName: selectedFileName || 'research_report.pdf',
      fileSizeMB: 15,
      status: 'SUBMITTED',
      createdAt: Date.now(),
    };

    setProjectSubmissions({
      ...projectSubmissions,
      [activeProject.id]: [newSub, ...activeSubs],
    });

    setStudentSubTitle('');
    setStudentSubSummary('');
    setSelectedFileName('');
    setFormatError(null);
    alert('成果已成功代表全组提交！AI 自动预审已完成。');
  };

  return (
    <div style={{ padding: '24px 32px', backgroundColor: '#f8fafc', color: '#0f172a', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* 顶部 Header：视角切换 (教师端/学生端) + 功能按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🔬</span>
            <span>研究性学习工作流管理中心</span>
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: 13 }}>
            PBL / STEAM 探究课题管理：班级分组、盲审评价与组内协作
          </p>
        </div>

        {/* 角色视角切换 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', backgroundColor: '#e2e8f0', padding: 3, borderRadius: 10 }}>
            <button
              onClick={() => setRole('teacher')}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: role === 'teacher' ? '#ffffff' : 'transparent',
                color: role === 'teacher' ? '#2563eb' : '#64748b',
                fontWeight: role === 'teacher' ? '700' : '500',
                cursor: 'pointer',
                fontSize: 13,
                boxShadow: role === 'teacher' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              👨‍🏫 教师端分组与管理
            </button>
            <button
              onClick={() => setRole('student')}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: role === 'student' ? '#ffffff' : 'transparent',
                color: role === 'student' ? '#059669' : '#64748b',
                fontWeight: role === 'student' ? '700' : '500',
                cursor: 'pointer',
                fontSize: 13,
                boxShadow: role === 'student' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              🎓 学生端团队与协作
            </button>
          </div>

          {role === 'teacher' && (
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '9px 18px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
              }}
            >
              <span>➕</span>
              <span>创建新探究项目</span>
            </button>
          )}
        </div>
      </div>

      {view === 'list' && (
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: 12, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.5 }}>
          课题列表管理 (RESEARCH PROJECT LIST)
        </div>

        {projects.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            当前还没有任何探究课题。
            {role === 'teacher' && (
              <button onClick={() => setShowCreateModal(true)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, marginLeft: 4 }}>
                点击创建第一个探究课题 →
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map((proj) => {
              const isSelected = proj.id === activeProjectId;
              const groupCount = (projectGroups[proj.id] || []).length;
              const subCount = (projectSubmissions[proj.id] || []).length;
              return (
                <div
                  key={proj.id}
                  onClick={() => setActiveProjectId(proj.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    backgroundColor: isSelected ? '#eff6ff' : '#f8fafc',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, backgroundColor: isSelected ? '#dbeafe' : '#e2e8f0', color: isSelected ? '#1e40af' : '#64748b', padding: '2px 6px', borderRadius: 4, fontWeight: '600' }}>
                        {proj.currentPhase}
                      </span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: '700', color: '#0f172a' }}>{proj.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.description}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      组员上限: {proj.config.maxGroupMembers}人 · 已建分组: {groupCount} 组 · 提交成果: {subCount} 份
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { setActiveProjectId(proj.id); setView('detail'); }}
                      style={{
                        backgroundColor: isSelected ? '#2563eb' : '#f1f5f9',
                        color: isSelected ? '#ffffff' : '#1e293b',
                        border: `1px solid ${isSelected ? '#2563eb' : '#cbd5e1'}`,
                        borderRadius: 6,
                        padding: '5px 12px',
                        fontSize: 12,
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      进入管理
                    </button>
                    {role === 'teacher' && (
                      <button
                        onClick={() => handleDeleteProject(proj.id)}
                        title="删除该课题"
                        style={{ backgroundColor: '#ffffff', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                      >
                        🗑️ 删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
      {view === 'detail' && activeProject && (
      <>
      {/* 面包屑导航 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => { setView('list'); setActiveProjectId(''); }}
          style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, fontWeight: '600', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <span>←</span>
          <span>返回课题列表</span>
        </button>
        <span style={{ color: '#94a3b8' }}>/</span>
        <span style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{activeProject.title}</span>
      </div>

      {/* ========================================================================= */}
      {/* 1. 教师端视角：班级选择 + 自动随机分组 + 手动移动与组长设置 */}
      {/* ========================================================================= */}
      {role === 'teacher' && activeProject && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 项目阶段控制 Stepper */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{activeProject.title}</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b' }}>{activeProject.description}</p>
              </div>
              <button
                onClick={handleTriggerExport}
                style={{ backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', color: '#1e293b', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: '600', cursor: 'pointer' }}
              >
                📦 导出全课题成果 ZIP 包
              </button>
            </div>
            <WorkflowPhaseStepper currentPhase={activeProject.currentPhase} onSelectPhase={handleUpdatePhase} isTeacher={true} />
          </div>

          {/* 班级选择与自动随机分组控制条 (Class & Auto Grouping Control) */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <label style={{ fontWeight: '700', fontSize: 14, color: '#0f172a' }}>选择关联班级名册:</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  style={{ backgroundColor: '#ffffff', border: '1px solid #2563eb', color: '#1e40af', padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: '600' }}
                >
                  {classList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.students?.length || 0}人)</option>
                  ))}
                </select>
              </div>

              {/* 自动分组工具栏 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>每组人数:</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={autoGroupSize}
                  onChange={(e) => setAutoGroupSize(Number(e.target.value))}
                  style={{ width: 50, padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, textAlign: 'center' }}
                />
                <button
                  onClick={handleAutoRandomGrouping}
                  style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: '600', cursor: 'pointer' }}
                >
                  🎲 一键自动随机分组
                </button>
                <button
                  onClick={() => setProjectGroups({ ...projectGroups, [activeProject.id]: [] })}
                  style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#dc2626', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                >
                  🧹 清空分组
                </button>
              </div>
            </div>

            {/* 小组分布网格与未分组学生池 (支持拖拽抓取与组间 Drop) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 16 }}>
              {activeGroups.map((group) => {
                const isOver = dragOverGroupId === group.id;
                return (
                  <div
                    key={group.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverGroupId !== group.id) setDragOverGroupId(group.id);
                    }}
                    onDragLeave={() => setDragOverGroupId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverGroupId(null);
                      try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        if (data?.studentId && data?.sourceGroupId) {
                          handleMoveMember(data.sourceGroupId, group.id, data.studentId);
                        }
                      } catch (err) {}
                    }}
                    style={{
                      backgroundColor: isOver ? '#eff6ff' : '#f8fafc',
                      border: isOver ? '2px dashed #2563eb' : '1px solid #cbd5e1',
                      borderRadius: 10,
                      padding: 14,
                      transition: 'all 0.2s ease',
                      boxShadow: isOver ? '0 4px 12px rgba(37, 99, 235, 0.15)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                      <span style={{ fontWeight: '700', fontSize: 14, color: '#1e40af' }}>{group.groupName}</span>
                      <span style={{ fontSize: 11, backgroundColor: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: 4 }}>
                        {(group.members || []).length} 人 {isOver && ' (松开放入此组)'}
                      </span>
                    </div>

                    {/* 组员列表 (支持鼠标拖拽抓取) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
                      {(group.members || []).map((m) => (
                        <div
                          key={m.studentId}
                          draggable={true}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', JSON.stringify({ studentId: m.studentId, sourceGroupId: group.id }));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          title="按住鼠标左键可拖拽此成员放置到其他小组"
                          style={{
                            display: 'flex',
                            justify: 'space-between',
                            alignItems: 'center',
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0',
                            padding: '7px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            cursor: 'grab',
                            userSelect: 'none',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* 拖拽图标放置于姓名最左边 */}
                            <span style={{ fontSize: 13, color: '#94a3b8', cursor: 'grab', userSelect: 'none' }} title="按住拖拽更换小组">⋮⋮</span>
                            <span>{m.isLeader ? '👑' : '👨‍🎓'}</span>
                            <span style={{ fontWeight: m.isLeader ? '700' : '500', color: m.isLeader ? '#d97706' : '#0f172a' }}>{m.name}</span>
                            {m.isLeader && <span style={{ fontSize: 10, backgroundColor: '#fef3c7', color: '#d97706', padding: '1px 5px', borderRadius: 3, fontWeight: '600' }}>组长</span>}
                          </div>
                          {/* 右侧：设为组长按钮 (已完全移除移至...下拉框) */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!m.isLeader && (
                              <button
                                onClick={() => handleSetLeader(group.id, m.studentId)}
                                style={{
                                  backgroundColor: '#eff6ff',
                                  border: '1px solid #bfdbfe',
                                  color: '#2563eb',
                                  borderRadius: 4,
                                  padding: '2px 8px',
                                  cursor: 'pointer',
                                  fontSize: 11,
                                  fontWeight: '500',
                                }}
                              >
                                设为组长
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* 未分组学生池 Card (支持 Drop 移回未分组) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverGroupId !== 'unassigned') setDragOverGroupId('unassigned');
                }}
                onDragLeave={() => setDragOverGroupId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverGroupId(null);
                  try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data?.studentId && data?.sourceGroupId) {
                      handleMoveMember(data.sourceGroupId, 'unassigned', data.studentId);
                    }
                  } catch (err) {}
                }}
                style={{
                  backgroundColor: dragOverGroupId === 'unassigned' ? '#fff7ed' : '#ffffff',
                  border: dragOverGroupId === 'unassigned' ? '2px dashed #ea580c' : '1px dashed #cbd5e1',
                  borderRadius: 10,
                  padding: 14,
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ fontWeight: '700', fontSize: 13, color: '#c2410c', marginBottom: 10 }}>
                  未分组学生池 ({unassignedStudents.length}人) {dragOverGroupId === 'unassigned' && '(松开移回未分组)'}
                </div>
                {unassignedStudents.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>全班学生已分配完毕，可拖拽任意成员放回此处。</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {unassignedStudents.map((s) => (
                      <span
                        key={s.id}
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', JSON.stringify({ studentId: s.id, sourceGroupId: 'unassigned' }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        title="按住拖拽放入任意小组"
                        style={{
                          backgroundColor: '#fff7ed',
                          border: '1px solid #fed7aa',
                          color: '#c2410c',
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'grab',
                          userSelect: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span>🖐️ {s.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 教师端成果审核列表 */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: 15, color: '#0f172a' }}>
              👨‍🏫 学生提交成果终审与评价列表 ({activeSubs.length})
            </h3>
            {activeSubs.map((sub) => (
              <div key={sub.id} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontWeight: '700', fontSize: 14, color: '#0f172a' }}>
                    {sub.title} <span style={{ color: '#2563eb', fontSize: 12 }}>({sub.studentId})</span>
                  </div>
                  <span style={{ backgroundColor: sub.status === 'APPROVED' ? '#d1fae5' : '#fef3c7', color: sub.status === 'APPROVED' ? '#047857' : '#b45309', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: '600' }}>
                    {sub.status === 'APPROVED' ? '终审通过' : '待评估'}
                  </span>
                </div>
                <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#475569' }}>{sub.summary}</p>
                {sub.status !== 'APPROVED' && (
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => handleTeacherEvaluate(sub.id, 'RETURN')} style={{ backgroundColor: '#ffffff', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '5px 12px', fontSize: 12 }}>
                      ↩️ 退回重交
                    </button>
                    <button onClick={() => handleTeacherEvaluate(sub.id, 'APPROVE')} style={{ backgroundColor: '#059669', border: 'none', color: '#ffffff', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: '600' }}>
                      ✅ 终审通过并发放积分
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. 学生端视角：专属团队看板 + 组长特权与组内分工 */}
      {/* ========================================================================= */}
      {role === 'student' && activeProject && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 项目当前阶段看板 */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h2 style={{ margin: '0 0 6px 0', fontSize: 18, color: '#0f172a' }}>{activeProject.title}</h2>
            <p style={{ margin: '0 0 14px 0', fontSize: 13, color: '#64748b' }}>{activeProject.description}</p>
            <WorkflowPhaseStepper currentPhase={activeProject.currentPhase} isTeacher={false} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
            {/* 左侧：提交台与材料格式校验 */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: 16, color: '#059669', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📤</span>
                <span>组长代表全组提交阶段成果</span>
              </h3>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: 12, borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
                <strong>教师要求：</strong>材料格式 <code>{(activeProject.config.allowedFileTypes || []).join(', ')}</code>；单文件容量上限 <code>{activeProject.config.maxFileSizeMB}MB</code>。
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 }}>成果报告名称 *</label>
                  <input
                    type="text"
                    placeholder="例: 基于嵌入式传感器的实验数据报告"
                    value={studentSubTitle}
                    onChange={(e) => setStudentSubTitle(e.target.value)}
                    style={{ width: '100%', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '10px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 }}>成果摘要与说明</label>
                  <textarea
                    placeholder="撰写探究方法、数据与研究结论简述..."
                    rows={3}
                    value={studentSubSummary}
                    onChange={(e) => setStudentSubSummary(e.target.value)}
                    style={{ width: '100%', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '10px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 }}>选择附件文件 (格式校验)</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="text"
                      placeholder="例: experiment_output.pdf"
                      value={selectedFileName}
                      onChange={(e) => handleFileSelectMock(e.target.value)}
                      style={{ flex: 1, backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '9px 12px', borderRadius: 8, fontSize: 13 }}
                    />
                    <select
                      value={selectedFileName}
                      onChange={(e) => handleFileSelectMock(e.target.value)}
                      style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '9px 12px', borderRadius: 8, fontSize: 13 }}
                    >
                      <option value="">-- 选择测试附件 --</option>
                      <option value="report.pdf">report.pdf (符合要求)</option>
                      <option value="code_project.zip">code_project.zip (符合要求)</option>
                      <option value="illegal_script.exe">illegal_script.exe (格式不符合)</option>
                    </select>
                  </div>
                </div>

                {formatError && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: 10, borderRadius: 8, fontSize: 12 }}>
                    {formatError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    onClick={handleStudentSubmit}
                    disabled={!!formatError}
                    style={{
                      backgroundColor: formatError ? '#94a3b8' : '#059669',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 24px',
                      fontWeight: '600',
                      cursor: formatError ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    提交组内阶段成果
                  </button>
                </div>
              </div>
            </div>

            {/* 右侧：学生端专属团队看板 (My Team Roster Card) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>👥</span>
                  <span>我的探究小组团队看板</span>
                </h3>

                {activeGroups[0] ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 10 }}>
                      {activeGroups[0].groupName}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(activeGroups[0].members || []).map((m) => (
                        <div key={m.studentId} style={{ backgroundColor: m.isLeader ? '#fef3c7' : '#f8fafc', border: m.isLeader ? '1px solid #fde68a' : '1px solid #e2e8f0', padding: 10, borderRadius: 8, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{m.isLeader ? '👑' : '👨‍🎓'}</span>
                              <span style={{ fontWeight: '700', color: m.isLeader ? '#b45309' : '#0f172a' }}>{m.name}</span>
                              {m.isLeader && <span style={{ fontSize: 10, backgroundColor: '#d97706', color: '#ffffff', padding: '1px 5px', borderRadius: 4, fontWeight: '700' }}>组长</span>}
                            </div>
                            <span style={{ fontSize: 10, color: m.online ? '#059669' : '#94a3b8' }}>{m.online ? '🟢 在线' : '⚪ 离线'}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                            分工: {m.taskRole}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>暂未分配探究小组。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
      {/* 教师端：创建新学习项目 Modal 弹窗 */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>➕ 发起新探究学习项目 (教师端)</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ backgroundColor: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 }}>项目名称 *</label>
                <input
                  type="text"
                  placeholder="例: 智慧农业多光谱微型物联网探究"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 }}>项目探究背景与要求</label>
                <textarea
                  placeholder="填写项目学习目标及成果交付规范..."
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>

              {/* 允许提交的材料格式 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, backgroundColor: '#f8fafc' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: '700', color: '#2563eb', marginBottom: 8 }}>
                  ⚙️ 设置允许学生提交的材料格式 (Allowed Formats)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {FILE_TYPE_OPTIONS.map((opt) => {
                    const isChecked = opt.exts.every((e) => selectedFileTypes.includes(e));
                    return (
                      <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFileTypes([...Array.from(new Set([...selectedFileTypes, ...opt.exts]))]);
                            } else {
                              setSelectedFileTypes(selectedFileTypes.filter((e) => !opt.exts.includes(e)));
                            }
                          }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newEnableGrouping} onChange={(e) => setNewEnableGrouping(e.target.checked)} />
                  <span>开启团队分组</span>
                </label>
                {newEnableGrouping && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                    <span>每组上限:</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={newMaxMembers}
                      onChange={(e) => setNewMaxMembers(Number(e.target.value))}
                      style={{ width: 50, padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                    />
                    <span>人</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button onClick={() => setShowCreateModal(false)} style={{ backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>取消</button>
                <button onClick={handleCreateProject} style={{ backgroundColor: '#2563eb', border: 'none', color: '#ffffff', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer', fontWeight: '600' }}>保存并发起课题项目</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 3. 白板精简图标按钮与抽屉 (`classroom.tool`)
export function ResearchClassroomToolWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const portalContainer = typeof document !== 'undefined' ? document.body : null;

  return (
    <React.Fragment>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: 32,
          height: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          backgroundColor: isOpen ? '#2563eb' : 'transparent',
          color: isOpen ? '#ffffff' : '#475569',
          border: 'none',
          cursor: 'pointer',
        }}
        title="恋云课程 (Lianyun Course)"
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 18h12M12 2v14M8 12l4 4 4-4" />
        </svg>
      </button>

      {isOpen && portalContainer && createPortal(
        <div style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10002,
          width: 380,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(12px)',
          color: '#0f172a',
          padding: 18,
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          fontFamily: 'sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: '700', color: '#2563eb', fontSize: 14 }}>🔬 课题探究阶段控制台</span>
            <button onClick={() => setIsOpen(false)} style={{ backgroundColor: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 14px 0' }}>多项目工作流引擎已就绪。</p>
          <button onClick={() => { alert('已推进课题阶段'); setIsOpen(false); }} style={{ width: '100%', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: '600', cursor: 'pointer' }}>
            推进课题阶段 ➔
          </button>
        </div>,
        portalContainer
      )}
    </React.Fragment>
  );
}

// 4. 学生端看板组件
export function StudentResearchBoardWidget() {
  return (
    <div style={{ padding: 16, backgroundColor: '#ffffff', color: '#0f172a', borderRadius: 10, fontSize: 13, border: '1px solid #e2e8f0' }}>
      <span style={{ fontWeight: '600', color: '#059669' }}>📋 我的课题探究任务与阶段提交看板</span>
    </div>
  );
}

// 5. 前端插件入口 activate & deactivate
export async function activate(hostCtx: any) {
  ctx = hostCtx;

  try {
    hostCtx.ui.registerExtensionPoint('teacher.tab', {
      id: 'tab_lianyun_course',
      label: '恋云课程管理',
      icon: 'Microscope',
      component: ResearchWorkspaceMainView,
      position: 20,
    });
  } catch (e) {}

  try {
    hostCtx.ui.registerExtensionPoint('workspace.view', {
      id: 'lianyun_course_workspace',
      label: '恋云课程中心',
      icon: 'Microscope',
      component: ResearchWorkspaceMainView,
    });
  } catch (e) {}

  try {
    hostCtx.ui.registerExtensionPoint('classroom.tool', {
      id: 'tool_lianyun_course',
      label: '恋云课程',
      icon: 'Microscope',
      component: ResearchClassroomToolWidget,
      position: 12,
    });
  } catch (e) {}

  try {
    hostCtx.ui.registerExtensionPoint('student.view', {
      id: 'student_lianyun_view',
      label: '课题探究看板',
      icon: 'FileText',
      component: StudentResearchBoardWidget,
    });
  } catch (e) {}
}

export function deactivate() {
  if (ctx?.ui) {
    ctx.ui.unregisterExtensionPoint('teacher.tab', 'tab_lianyun_course');
    ctx.ui.unregisterExtensionPoint('workspace.view', 'lianyun_course_workspace');
    ctx.ui.unregisterExtensionPoint('classroom.tool', 'tool_lianyun_course');
    ctx.ui.unregisterExtensionPoint('student.view', 'student_lianyun_view');
  }
}

export default { activate, deactivate, ResearchWorkspaceMainView, ResearchClassroomToolWidget };
