type DashboardMessageSet<T extends Record<string, string>> = {
  [Key in keyof T]: string;
};

export const dashboardEn = {
  workspaceEyebrow: "Workspace",
  heading: "My assignments",
  description:
    "Keep each brief, rubric, plan, check and progress trail in its own assignment.",
  newAssignment: "New assignment",
  newAssignmentOptions: "Choose how to start a new assignment",
  uploadAssignment: "Upload assignment files",
  pasteAssignment: "Paste assignment details",
  restoreAssignment: "Restore assignment backup as new",
  assignmentsHeading: "Assignments",
  assignmentCountOne: "1 assignment",
  assignmentCount: "{count} assignments",
  deadline: "Deadline",
  progress: "Progress",
  progressValue: "{percent}% complete",
  nextTarget: "Next target",
  allComplete: "All planned work is complete",
  blockedCount: "{count} blocked",
  overdueCount: "{count} overdue",
  openAssignment: "Open assignment",
  openAssignmentLabel: "Open assignment: {title}",
  upNextHeading: "Up Next",
  upNextDescription:
    "Real target dates from every assignment plan, with blocked work labelled.",
  targetDate: "Target {date}",
  ready: "Ready",
  blocked: "Blocked",
  overdue: "Overdue",
  emptyHeading: "No assignments yet",
  emptyDescription:
    "Create your first assignment from files, pasted details or a RubricTrail backup.",
  createFirst: "Create first assignment",
} as const;

export const dashboardZhCN = {
  workspaceEyebrow: "作业空间",
  heading: "我的作业",
  description: "将每份作业的说明、评分标准、计划、检查和进度分别保存在独立项目中。",
  newAssignment: "新建作业",
  newAssignmentOptions: "选择如何开始新作业",
  uploadAssignment: "上传作业文件",
  pasteAssignment: "粘贴作业详情",
  restoreAssignment: "把作业备份恢复为新作业",
  assignmentsHeading: "作业列表",
  assignmentCountOne: "1 份作业",
  assignmentCount: "{count} 份作业",
  deadline: "截止日期",
  progress: "进度",
  progressValue: "已完成 {percent}%",
  nextTarget: "下一目标",
  allComplete: "计划任务已全部完成",
  blockedCount: "{count} 项被阻塞",
  overdueCount: "{count} 项逾期",
  openAssignment: "打开作业",
  openAssignmentLabel: "打开作业：{title}",
  upNextHeading: "接下来",
  upNextDescription: "汇总各作业行动计划中的真实目标日期，并明确标出被阻塞的任务。",
  targetDate: "目标日期 {date}",
  ready: "可开始",
  blocked: "被阻塞",
  overdue: "已逾期",
  emptyHeading: "还没有作业",
  emptyDescription: "可通过上传文件、粘贴详情或 RubricTrail 备份创建第一份作业。",
  createFirst: "创建第一份作业",
} satisfies DashboardMessageSet<typeof dashboardEn>;

export function formatDashboardMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match,
  );
}
