export const locatorEn = {
  sourceWord: "Source",
  addSourceLocation: "Add source location",
  editSourceLocation: "Edit source location",
  removeSourceLocation: "Remove source location",
  locatorEditorTitle: "Source location",
  locatorSourceLabel: "Original source",
  locatorSourceNone: "No source locator recorded",
  locatorPdfPageLabel: "PDF page (optional)",
  locatorPdfPageHint: "This PDF contains {pages} pages. You may leave the page blank.",
  locatorCancel: "Cancel",
  locatorSave: "Save source location",
  locatorSourceRequired: "Choose an included source, or leave the source blank.",
  locatorPageInvalid: "Enter a whole PDF page from 1 to {pages}, or leave it blank.",
  removeLocatorConfirm: "Remove the recorded source location for this criterion?",
  legacyRegistryGuidance:
    "This older project does not contain a verifiable source registry. Re-import the original assignment files to add a source location.",
} as const;

export const locatorZhCN = {
  sourceWord: "来源",
  addSourceLocation: "添加来源定位",
  editSourceLocation: "编辑来源定位",
  removeSourceLocation: "移除来源定位",
  locatorEditorTitle: "来源定位",
  locatorSourceLabel: "原始来源",
  locatorSourceNone: "未记录来源定位",
  locatorPdfPageLabel: "PDF 页码（可选）",
  locatorPdfPageHint: "这份 PDF 共 {pages} 页；页码可以留空。",
  locatorCancel: "取消",
  locatorSave: "保存来源定位",
  locatorSourceRequired: "请选择一个已包含的来源，或留空。",
  locatorPageInvalid: "请输入 1 到 {pages} 的整数 PDF 页码，或留空。",
  removeLocatorConfirm: "要移除此评分项已记录的来源定位吗？",
  legacyRegistryGuidance:
    "此旧项目没有可核验的来源登记表。请重新导入原始作业文件后再添加来源定位。",
} satisfies Record<keyof typeof locatorEn, string>;
