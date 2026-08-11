export const SAMPLE_READINESS = [
  ["deliverables", "Every required deliverable is present"],
  ["rubric", "I manually compared every criterion with the final draft"],
  ["logic", "Recommendations follow from the diagnosis"],
  ["sources", "Every material claim has a traceable source"],
  ["format", "Word count, structure, and citation format are checked"],
  ["integrity", "No data, citations, or personal experience are invented"],
  ["proofread", "Final human proofread is complete"],
] as const;

export const UPLOADED_READINESS = [
  ["deliverables", "Every required deliverable is present"],
  ["sources", "Every material claim has a traceable source"],
  ["format", "Word count, structure and citation format are checked"],
  ["integrity", "No data, citations or personal experience are invented"],
  ["file", "The final file opens and uses the required format"],
  ["proofread", "A final human proofread is complete"],
] as const;
