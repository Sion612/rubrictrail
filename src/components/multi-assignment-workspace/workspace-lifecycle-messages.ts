type LifecycleMessageSet<T extends Record<string, string>> = {
  [Key in keyof T]: string;
};

export const workspaceLifecycleEn = {
  eyebrow: "Local workspace",
  heading: "Storage & recovery",
  description:
    "Review project backups, storage protection and exact workspace maintenance actions.",
  localOnly:
    "These controls are browser-local. They do not create an account, cloud backup or whole-workspace backup.",
  degradedHeading: "Storage protection is degraded",
  degradedDescription:
    "Validated projects remain readable and exportable, but growth is blocked. Download a backup for each important assignment before attempting maintenance.",
  recoveryOnlyHeading: "Workspace recovery is required",
  recoveryOnlyDescription:
    "Ordinary mutations are unavailable. Select and revalidate one exact candidate, or explicitly choose recovery-only privacy deletion.",
  reserveReady: "Recovery reserve ready",
  reserveMissing: "Recovery reserve missing",
  reserveInvalid: "Recovery reserve invalid",
  exportSelected: "Download selected project backup",
  exportSelectedLabel: "Download backup for {title}",
  noSelectedExport:
    "Open an assignment to download its existing single-project backup.",
  exportDiagnostics: "Export recovery diagnostics",
  diagnosticsDescription:
    "Diagnostics help review owned records. Exporting them does not make any candidate authoritative.",
  storageHeading: "Storage management",
  storageDescription:
    "Counts are product guardrails, not a guarantee of browser storage capacity.",
  activeProjects: "Active projects",
  tombstones: "Deletion guards",
  physicalRecords: "Owned project records",
  legacyValues: "Retained legacy values",
  generation: "Generation {generation}",
  indexRevision: "Index revision {revision}",
  policy: "Product record policy",
  policyNormal: "Normal",
  policyCompaction: "Compaction recommended",
  policyWarning: "Persistent storage warning",
  policyGrowthBlocked: "New projects and restore-as-new are blocked",
  policyHardLimit: "Hard record limit reached",
  policyRecoveryOnly: "Recovery-only: record limit exceeded",
  policyCompactionDetail:
    "At least 64 deletion guards are retained. A verified generation rotation can compact them.",
  policyWarningDetail:
    "At least 80 active projects and deletion guards are present. Review backups and storage management.",
  policyGrowthBlockedDetail:
    "At least 96 records are present. Existing reads, exports, edits and deletion remain available subject to verified storage writes.",
  policyHardLimitDetail:
    "The authoritative generation contains 100 records. RubricTrail must never create a 101st entry.",
  policyRecoveryOnlyDetail:
    "This count cannot be accepted as normal authority. Export diagnostics and complete explicit recovery.",
  projectHeading: "Selected project",
  noSelectedProject: "No assignment is selected.",
  projectRevision: "Project revision {revision}",
  backupHeading: "Backup replacement",
  backupDescription:
    "Choose and validate one existing single-project backup before previewing a replacement.",
  chooseBackup: "Choose backup to preview",
  replacePreviewHeading: "Validated replacement preview",
  replaceTarget: "Project being replaced",
  backupTitle: "Backup project",
  backupCourse: "Course",
  backupDeadline: "Deadline",
  backupSource: "Local file",
  previewExpired:
    "The selected project changed after this preview. Choose and validate the backup again.",
  degradedReplacementBlocked:
    "Degraded mode permits only a verified non-growing replacement. This preview is larger than the current record.",
  reviewReplacement: "Review replacement",
  deleteProjectHeading: "Delete selected project",
  deleteProjectDescription:
    "This removes this assignment's saved content and keeps a content-free deletion guard. Deleting the final project leaves a valid empty workspace; it does not perform a whole-workspace privacy deletion.",
  reviewDeleteProject: "Review project deletion",
  legacyHeading: "Legacy storage cleanup",
  legacyDescription:
    "Separately remove exact retained v0.7.x values. A changed value from an older tab stops cleanup instead of being deleted.",
  noLegacyValues: "No retained legacy values are currently reported.",
  reviewLegacyCleanup: "Review legacy cleanup",
  legacyUnavailable:
    "Legacy cleanup is currently unavailable. Resolve the reported storage condition first.",
  rotationHeading: "Compact deletion guards",
  rotationDescription:
    "A generation rotation rewrites validated active records into generation {generation}, verifies each target and removes only exact old records.",
  reviewRotation: "Review generation rotation",
  rotationUnavailable:
    "Generation rotation is unavailable until invalid or incomplete owned records are resolved.",
  journalUnavailable:
    "Destructive maintenance is unavailable because its recovery journal cannot currently be made durable.",
  rotationNotNeeded:
    "No deletion guards currently require generation rotation.",
  recoveryHeading: "Explicit index recovery",
  recoveryDescription:
    "Namespace scanning only discovered candidates. It did not choose authority. Select and confirm one exact workspace and generation, even when only one candidate exists.",
  recoveryCandidateCountOne: "1 coherent candidate group",
  recoveryCandidateCount: "{count} coherent candidate groups",
  recoveryNoCandidates:
    "No coherent candidate group is available. No project will be made authoritative automatically.",
  recoveryInvalidRecords: "{count} invalid owned records remain quarantined",
  reviewRecovery: "Select a recovery candidate",
  reviewRecoveryPrivacy: "Review recovery-only privacy deletion",
  recoveryPrivacyDescription:
    "You may explicitly remove the exact discovered workspace and legacy values without selecting a candidate. No candidate becomes authoritative, unrelated origin storage stays untouched and the language preference is preserved.",
  candidateWorkspace: "Workspace {workspaceId}",
  candidateGeneration: "Generation {generation}",
  candidateCounts: "{active} active, {tombstones} deletion guards",
  candidateNotSelected: "Select one exact candidate before continuing.",
  unselectedQuarantined:
    "Unselected groups remain quarantined and are not merged or deleted.",
  dangerHeading: "Whole-workspace privacy deletion",
  dangerDescription:
    "This creates a new cleared generation, then removes only exact project and legacy values named by the verified operation. Unrelated origin storage and the independent language preference remain untouched.",
  reviewWorkspaceDelete: "Review whole-workspace deletion",
  dialogClose: "Close confirmation",
  cancel: "Cancel",
  continue: "Continue",
  working: "Working…",
  staleIntent:
    "The scope changed after this confirmation opened. Close it and review the current state again.",
  replaceDialogHeading: "Replace selected project?",
  replaceDialogDescription:
    "Only the exact project below will be replaced. Its project ID is preserved; no other project is changed.",
  replaceAcknowledge:
    "I reviewed the validated backup preview and understand the current project content will be replaced.",
  confirmReplace: "Replace this project",
  deleteProjectDialogHeading: "Delete this project?",
  deleteProjectDialogDescription:
    "A content-free deletion guard is written before the workspace publishes this deletion. Deleting the final project leaves an active empty workspace; it does not create cleared status.",
  typeExact: "Type {token} to confirm this exact scope.",
  deleteProjectToken: "DELETE PROJECT {id}",
  confirmDeleteProject: "Delete this project",
  legacyDialogHeading: "Remove retained legacy values?",
  legacyDialogDescription:
    "All reported legacy keys are checked against their exact expected values. Any older-tab rewrite stops the operation.",
  legacyToken: "REMOVE LEGACY DATA",
  confirmLegacyCleanup: "Remove legacy values",
  workspaceDeleteDialogHeading: "Delete the entire workspace?",
  workspaceDeleteDialogDescription:
    "Every active assignment in this workspace will be removed. This is the only operation that creates cleared workspace status.",
  workspaceDeleteToken: "DELETE WORKSPACE {id}",
  confirmWorkspaceDelete: "Delete entire workspace",
  rotationDialogHeading: "Rotate workspace generation?",
  rotationDialogDescription:
    "Validated active records move from generation {source} to {target}. Only strict indexed deletion guards may be compacted.",
  rotationAcknowledge:
    "I understand this maintenance action requires verified target records before exact source cleanup.",
  confirmRotation: "Rotate generation",
  recoveryDialogHeading: "Recover one exact workspace group?",
  recoveryDialogDescription:
    "The selected group will be rewritten into a fresh generation before a new index becomes authoritative.",
  recoveryAcknowledge:
    "I selected this exact group. I understand every unselected group remains quarantined.",
  confirmRecovery: "Recover selected group",
  recoveryPrivacyDialogHeading: "Delete all discovered workspace data?",
  recoveryPrivacyDialogDescription:
    "This recovery-only action uses the current scan intent and exact observed bytes. It does not invent a workspace baseline or make any candidate authoritative.",
  recoveryPrivacyToken: "DELETE RECOVERY DATA",
  recoveryPrivacyAcknowledge:
    "I understand every exact discovered workspace candidate will be removed, while unrelated storage and the language preference remain untouched.",
  confirmRecoveryPrivacy: "Delete discovered workspace data",
  exactProjectId: "Project ID {projectId}",
  exactWorkspaceId: "Workspace ID {workspaceId}",
  exactBackupToken: "Validated backup token {token}",
  failureConflict:
    "The saved baseline changed. No success was recorded; review the current workspace before trying again.",
  failureQuota:
    "The browser rejected the verified write. No unrelated data was removed to make space.",
  failureJournal:
    "The recovery journal could not be written and verified. The operation did not continue.",
  failureStaleIntent:
    "The confirmed scope is no longer current. No success was recorded.",
  failureInvalidOwned:
    "An invalid owned record blocks this operation. It was not deleted automatically.",
  failureLegacyDrift:
    "An older tab changed a retained legacy value. Cleanup stopped without deleting the unexpected bytes.",
  failureRecoveryChanged:
    "The recovery candidates changed. No group was selected automatically.",
  failureStorage:
    "Browser storage is unavailable. The operation could not be verified as successful.",
  failureUnknown:
    "The operation did not complete. No success was recorded; review the current workspace state.",
} as const;

export const workspaceLifecycleZhCN = {
  eyebrow: "本地工作区",
  heading: "存储与恢复",
  description: "检查项目备份、存储保护状态以及范围明确的工作区维护操作。",
  localOnly: "这些控件仅作用于浏览器本地数据，不会创建账户、云备份或整个工作区备份。",
  degradedHeading: "存储保护已降级",
  degradedDescription:
    "已验证项目仍可读取和导出，但不能增加数据。执行维护前，请为每份重要作业分别下载备份。",
  recoveryOnlyHeading: "必须先恢复工作区",
  recoveryOnlyDescription:
    "不能执行普通修改。请明确选择并重新验证一个候选项，或明确选择仅恢复状态的隐私删除。",
  reserveReady: "恢复预留空间正常",
  reserveMissing: "恢复预留空间缺失",
  reserveInvalid: "恢复预留空间无效",
  exportSelected: "下载所选项目备份",
  exportSelectedLabel: "下载“{title}”的备份",
  noSelectedExport: "请先打开一份作业，再下载其现有的单项目备份。",
  exportDiagnostics: "导出恢复诊断信息",
  diagnosticsDescription: "诊断信息用于检查受管记录；导出操作不会让任何候选项自动成为权威数据。",
  storageHeading: "存储管理",
  storageDescription: "下列数量是产品安全限制，不保证浏览器实际提供相应存储容量。",
  activeProjects: "有效项目",
  tombstones: "删除保护记录",
  physicalRecords: "受管项目记录",
  legacyValues: "保留的旧版数据",
  generation: "第 {generation} 代",
  indexRevision: "索引修订号 {revision}",
  policy: "产品记录策略",
  policyNormal: "正常",
  policyCompaction: "建议压缩",
  policyWarning: "持续存储警告",
  policyGrowthBlocked: "已禁止新建项目和恢复为新项目",
  policyHardLimit: "已达到记录硬限制",
  policyRecoveryOnly: "记录超限，只能恢复",
  policyCompactionDetail: "已保留至少 64 条删除保护记录，可通过经验证的代际轮换进行压缩。",
  policyWarningDetail: "有效项目与删除保护记录合计至少 80 条，请检查备份和存储管理。",
  policyGrowthBlockedDetail:
    "记录至少 96 条。只要写入能够验证，现有读取、导出、编辑和删除仍可使用。",
  policyHardLimitDetail: "权威代已有 100 条记录，RubricTrail 绝不能创建第 101 条。",
  policyRecoveryOnlyDetail: "该数量不能作为正常权威状态接受，请导出诊断信息并完成明确恢复。",
  projectHeading: "所选项目",
  noSelectedProject: "当前未选择作业。",
  projectRevision: "项目修订号 {revision}",
  backupHeading: "备份替换",
  backupDescription: "请先选择并验证现有的单项目备份，再预览替换范围。",
  chooseBackup: "选择备份并预览",
  replacePreviewHeading: "已验证的替换预览",
  replaceTarget: "将被替换的项目",
  backupTitle: "备份项目",
  backupCourse: "课程",
  backupDeadline: "截止日期",
  backupSource: "本地文件",
  previewExpired: "预览生成后，所选项目已发生变化。请重新选择并验证备份。",
  degradedReplacementBlocked:
    "降级模式只允许经验证且不会增大记录的替换；此备份预览大于当前记录。",
  reviewReplacement: "检查替换操作",
  deleteProjectHeading: "删除所选项目",
  deleteProjectDescription:
    "此操作会移除该作业的已保存内容并保留无内容的删除保护记录。删除最后一份项目只会留下有效的空工作区，不等同于整个工作区的隐私删除。",
  reviewDeleteProject: "检查项目删除",
  legacyHeading: "旧版存储清理",
  legacyDescription:
    "单独移除完全匹配的 v0.7.x 旧版数据。旧标签页改写的数据会让清理停止，而不会被删除。",
  noLegacyValues: "当前未报告保留的旧版数据。",
  reviewLegacyCleanup: "检查旧版清理",
  legacyUnavailable: "当前无法清理旧版数据，请先解决已报告的存储问题。",
  rotationHeading: "压缩删除保护记录",
  rotationDescription:
    "代际轮换会把已验证的有效记录逐一改写到第 {generation} 代，验证目标后再移除完全匹配的旧记录。",
  reviewRotation: "检查代际轮换",
  rotationUnavailable: "解决无效或不完整的受管记录后，才能执行代际轮换。",
  journalUnavailable: "恢复日志当前无法可靠保存，因此不能执行破坏性维护。",
  rotationNotNeeded: "当前没有需要通过代际轮换压缩的删除保护记录。",
  recoveryHeading: "明确恢复索引",
  recoveryDescription:
    "命名空间扫描只发现候选项，并未选择权威数据。即使只有一个候选组，也必须明确选择并确认具体工作区和代。",
  recoveryCandidateCountOne: "1 个一致的候选组",
  recoveryCandidateCount: "{count} 个一致的候选组",
  recoveryNoCandidates: "没有可用的一致候选组，任何项目都不会自动成为权威数据。",
  recoveryInvalidRecords: "仍有 {count} 条无效受管记录处于隔离状态",
  reviewRecovery: "选择恢复候选项",
  reviewRecoveryPrivacy: "检查仅恢复状态的隐私删除",
  recoveryPrivacyDescription:
    "无需选择候选项，也可明确移除扫描发现且完全匹配的工作区与旧版数据。任何候选项都不会成为权威数据；同源无关存储和语言偏好会保留。",
  candidateWorkspace: "工作区 {workspaceId}",
  candidateGeneration: "第 {generation} 代",
  candidateCounts: "{active} 个有效项目，{tombstones} 条删除保护记录",
  candidateNotSelected: "继续之前，请选择一个明确的候选项。",
  unselectedQuarantined: "未选组会继续隔离，不会被合并或删除。",
  dangerHeading: "整个工作区隐私删除",
  dangerDescription:
    "此操作会建立新的已清除代，然后只移除经验证操作列出的完全匹配项目和旧版数据；同源下的无关存储及独立语言偏好不会受影响。",
  reviewWorkspaceDelete: "检查整个工作区删除",
  dialogClose: "关闭确认窗口",
  cancel: "取消",
  continue: "继续",
  working: "正在处理…",
  staleIntent: "打开确认窗口后，操作范围已改变。请关闭并重新检查当前状态。",
  replaceDialogHeading: "替换所选项目？",
  replaceDialogDescription: "只会替换下方明确列出的项目。项目 ID 保持不变，其他项目不会改变。",
  replaceAcknowledge: "我已检查验证后的备份预览，并了解当前项目内容将被替换。",
  confirmReplace: "替换此项目",
  deleteProjectDialogHeading: "删除此项目？",
  deleteProjectDialogDescription:
    "工作区公布删除结果前，会先写入不含内容的删除保护记录。删除最后一份项目会留下有效的空工作区，不会生成已清除状态。",
  typeExact: "请输入 {token}，确认这一明确范围。",
  deleteProjectToken: "删除项目 {id}",
  confirmDeleteProject: "删除此项目",
  legacyDialogHeading: "移除保留的旧版数据？",
  legacyDialogDescription:
    "所有报告的旧版键都会与预期精确值核对；旧标签页的任何改写都会停止操作。",
  legacyToken: "删除旧版数据",
  confirmLegacyCleanup: "移除旧版数据",
  workspaceDeleteDialogHeading: "删除整个工作区？",
  workspaceDeleteDialogDescription:
    "此工作区内的所有有效作业都会被移除。只有此操作会生成已清除工作区状态。",
  workspaceDeleteToken: "删除工作区 {id}",
  confirmWorkspaceDelete: "删除整个工作区",
  rotationDialogHeading: "轮换工作区代？",
  rotationDialogDescription:
    "已验证的有效记录将从第 {source} 代移动到第 {target} 代；只有严格有效且列入索引的删除保护记录可以压缩。",
  rotationAcknowledge: "我了解必须先验证目标记录，才能清理完全匹配的来源记录。",
  confirmRotation: "轮换工作区代",
  recoveryDialogHeading: "恢复一个明确的工作区组？",
  recoveryDialogDescription: "所选组会先改写到新的代，随后新索引才会成为权威数据。",
  recoveryAcknowledge: "我已选择此明确候选组，并了解所有未选组会继续隔离。",
  confirmRecovery: "恢复所选组",
  recoveryPrivacyDialogHeading: "删除扫描发现的全部工作区数据？",
  recoveryPrivacyDialogDescription:
    "此仅恢复操作绑定当前扫描意图和观察到的精确字节，不会伪造工作区基线，也不会让任何候选项成为权威数据。",
  recoveryPrivacyToken: "删除恢复数据",
  recoveryPrivacyAcknowledge:
    "我了解扫描发现且完全匹配的所有工作区候选数据都会被移除，同源无关存储和语言偏好会保留。",
  confirmRecoveryPrivacy: "删除发现的工作区数据",
  exactProjectId: "项目 ID {projectId}",
  exactWorkspaceId: "工作区 ID {workspaceId}",
  exactBackupToken: "已验证备份标识 {token}",
  failureConflict: "已保存基线发生变化。没有记录成功，请检查当前工作区后重试。",
  failureQuota: "浏览器拒绝了已验证写入，RubricTrail 没有通过删除无关数据来腾出空间。",
  failureJournal: "无法写入并验证恢复日志，操作没有继续。",
  failureStaleIntent: "已确认的范围不再是当前范围，没有记录成功。",
  failureInvalidOwned: "无效的受管记录阻止了此操作，RubricTrail 没有自动删除它。",
  failureLegacyDrift: "旧标签页改写了保留的旧版数据，清理已停止，意外字节没有被删除。",
  failureRecoveryChanged: "恢复候选项发生变化，RubricTrail 没有自动选择任何组。",
  failureStorage: "浏览器存储不可用，无法验证操作是否成功。",
  failureUnknown: "操作未完成，没有记录成功；请检查当前工作区状态。",
} satisfies LifecycleMessageSet<typeof workspaceLifecycleEn>;

export function formatWorkspaceLifecycleMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match,
  );
}
