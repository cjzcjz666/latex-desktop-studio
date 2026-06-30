import type { CodexEditorContext, OutlineItem } from "../types";

export type CodexContextSource = {
  text: string;
  startLine: number;
};

export type CodexContextLineRange = {
  startLine: number;
  endLine: number;
};

export function formatCodexContextHint(context: CodexEditorContext | null) {
  if (!context) return "";
  const section = context.activeSection?.title
    ? ` · ${codexOutlineKindLabel(context.activeSection.kind)} ${context.activeSection.title}`
    : "";
  if (context.source === "diff-hunk") {
    const range = codexContextSelectedRangeText(context);
    return `${context.file}:${range} · Codex 片段${section}`;
  }
  if (context.selectedText.trim()) {
    const range = codexContextSelectedRangeText(context);
    const suffix = context.truncated ? "+" : "";
    return `${context.file}:${range} · 选区 ${context.selectedCharCount}${suffix} 字${section}`;
  }
  return `${context.file}:${context.cursorLine} · 当前光标${section}`;
}

export function codexContextKindLabel(context: CodexEditorContext, pinned = false) {
  if (context.source === "diff-hunk") return pinned ? "锁定片段" : "片段";
  if (context.selectedText.trim()) return pinned ? "锁定选区" : "选区";
  return pinned ? "锁定光标" : "光标";
}

export function codexContextLineRange(context: CodexEditorContext): CodexContextLineRange {
  if (context.selectedText.trim() && context.selectionStartLine && context.selectionEndLine) {
    return {
      startLine: Math.min(context.selectionStartLine, context.selectionEndLine),
      endLine: Math.max(context.selectionStartLine, context.selectionEndLine),
    };
  }
  if (context.activeSectionSource) {
    return {
      startLine: context.activeSectionSource.startLine,
      endLine: context.activeSectionSource.endLine,
    };
  }
  return {
    startLine: context.nearbyStartLine,
    endLine: context.nearbyEndLine,
  };
}

export function codexContextSource(context: CodexEditorContext): CodexContextSource {
  if (context.selectedText.trim()) {
    return {
      text: context.selectedText,
      startLine: context.selectionStartLine ?? 1,
    };
  }
  if (context.activeSectionSource?.text.trim()) {
    return {
      text: context.activeSectionSource.text,
      startLine: context.activeSectionSource.startLine,
    };
  }
  return {
    text: context.nearbyText,
    startLine: context.nearbyStartLine,
  };
}

function codexContextSelectedRangeText(context: CodexEditorContext) {
  return context.selectionStartLine === context.selectionEndLine
    ? `${context.selectionStartLine}`
    : `${context.selectionStartLine}-${context.selectionEndLine}`;
}

function codexOutlineKindLabel(kind: OutlineItem["kind"]) {
  if (kind === "part") return "PART";
  if (kind === "chapter") return "CH";
  if (kind === "section") return "SEC";
  if (kind === "subsection") return "SUB";
  if (kind === "subsubsection") return "S3";
  if (kind === "paragraph") return "PAR";
  if (kind === "subparagraph") return "S-PAR";
  return "LABEL";
}
