export const trackerEn = {
  tracker: "Project tracker",
  openTracker: "Open tracker",
  closeTracker: "Close project tracker",
  summaryLabel: "Project execution summary",
  nextTask: "Next incomplete task",
  allComplete: "All planned tasks are complete.",
  deadline: "Assignment deadline: {date}",
  incomplete: "{count} incomplete",
  blocked: "{count} blocked",
  overdue: "{count} overdue",
  trackerDescription:
    "Calendar, weekly agenda and task actions for this project. Nothing in this tracker is a separate saved plan.",
  openInTaskList: "Open in task list",
  calendarBusy: "Preparing a calendar file…",
} as const;

export const trackerZhCN = {
  tracker: "项目跟踪器",
  openTracker: "打开跟踪器",
  closeTracker: "关闭项目跟踪器",
  summaryLabel: "项目执行摘要",
  nextTask: "下一个未完成任务",
  allComplete: "计划中的任务都已完成。",
  deadline: "作业截止日期：{date}",
  incomplete: "{count} 项未完成",
  blocked: "{count} 项受阻",
  overdue: "{count} 项逾期",
  trackerDescription:
    "查看此项目的日历、每周议程和任务操作。跟踪器不会产生另一份保存的计划。",
  openInTaskList: "在任务列表中打开",
  calendarBusy: "正在准备日历文件…",
} satisfies Record<keyof typeof trackerEn, string>;
