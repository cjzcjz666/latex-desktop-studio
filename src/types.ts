export type ToolStatus = {
  name: string;
  found: boolean;
  path?: string;
  version?: string;
  installHint?: string;
};

export type EnvironmentStatus = {
  latexmk: ToolStatus;
  xelatex: ToolStatus;
  pdflatex: ToolStatus;
  lualatex: ToolStatus;
  codex: ToolStatus;
  canCompile: boolean;
  canRunCodex: boolean;
};

export type ProjectSummary = {
  name: string;
  root: string;
  mainFile: string;
  settingsPath: string;
};

export type ProjectSettings = {
  displayName?: string | null;
  mainFile: string;
  engine: "xelatex" | "pdflatex" | "lualatex";
  buildDir: string;
  compileArgs: string[];
};

export type RecentProject = {
  name: string;
  root: string;
  mainFile: string;
  lastOpened: number;
};

export type FileNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  children?: FileNode[];
};

export type RenameProjectEntryResult = {
  updatedReferences: number;
  updatedReferenceFiles: string[];
};

export type ProjectAsset = {
  path: string;
  mimeType: string;
  bytes: number[];
  size: number;
};

export type SearchResult = {
  file: string;
  line: number;
  column: number;
  preview: string;
};

export type ReplaceFileResult = {
  file: string;
  replacements: number;
};

export type ReplaceResult = {
  replacements: number;
  files: ReplaceFileResult[];
};

export type WordCountFile = {
  file: string;
  words: number;
  characters: number;
};

export type WordCountResult = {
  words: number;
  characters: number;
  files: WordCountFile[];
};

export type OutlineItem = {
  kind: "part" | "chapter" | "section" | "subsection" | "subsubsection" | "paragraph" | "subparagraph" | "label";
  title: string;
  file: string;
  line: number;
  level: number;
};

export type ProjectOverview = {
  title?: string | null;
  author?: string | null;
  date?: string | null;
  abstractText?: string | null;
  keywords: string[];
};

export type ProjectSymbol = {
  kind: "label" | "citation";
  key: string;
  detail?: string;
  file: string;
  line: number;
};

export type ProjectTodo = {
  kind: "TODO" | "FIXME" | "NOTE" | "REVIEW";
  message: string;
  file: string;
  line: number;
  resolved: boolean;
};

export type CodexEditorContext = {
  source?: "editor" | "diff-hunk";
  file: string;
  cursorLine: number;
  cursorColumn: number;
  activeSection?: {
    kind: OutlineItem["kind"];
    title: string;
    line: number;
    level: number;
  };
  activeSectionSource?: {
    startLine: number;
    endLine: number;
    text: string;
    truncated: boolean;
  };
  selectedText: string;
  selectedCharCount: number;
  selectionStartLine?: number;
  selectionEndLine?: number;
  truncated: boolean;
  nearbyStartLine: number;
  nearbyEndLine: number;
  nearbyText: string;
  nearbyTruncated: boolean;
};

export type ProjectReferenceIssue = {
  kind: "citation" | "label";
  key: string;
  file: string;
  line: number;
};

export type ProjectFileUsage = {
  file: string;
  line: number;
  command: string;
  path: string;
};

export type ProjectDependency = {
  sourceFile: string;
  line: number;
  command: string;
  kind: "tex" | "graphics" | "bibliography" | string;
  target: string;
  resolvedPath?: string | null;
};

export type SynctexLocation = {
  page: number;
  x: number;
  y: number;
  h: number;
  v: number;
  width: number;
  height: number;
};

export type PdfSyncTarget = SynctexLocation & {
  nonce: number;
};

export type SynctexSourceLocation = {
  file: string;
  line: number;
  column?: number | null;
};

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  hint?: string | null;
};

export type CompileRequest = {
  projectRoot: string;
  mainFile?: string;
};

export type CompileResult = {
  success: boolean;
  pdfPath?: string;
  log: string;
  diagnostics: Diagnostic[];
  command: string[];
};

export type CompileEvent = {
  kind: "started" | "log" | "completed" | "error";
  message: string;
  result?: CompileResult;
};

export type CodexRunRequest = {
  projectRoot: string;
  prompt: string;
  autoCompile?: boolean;
  allowedFiles?: string[];
};

export type CodexAskRequest = {
  projectRoot: string;
  prompt: string;
};

export type CodexAskResult = {
  response: string;
  command: string[];
};

export type CodexRunEvent = {
  kind: "started" | "progress" | "assistant" | "output" | "file-change" | "compile" | "completed" | "error";
  runId?: string;
  message: string;
};

export type DiffSummary = {
  runId: string;
  changedFiles: string[];
  unifiedDiff: string;
  canRevert: boolean;
  scopeRevertedFiles?: string[];
  promptPreview?: string | null;
  finalMessage?: string | null;
};

export type CodexHistoryItem = {
  runId: string;
  changedFiles: string[];
  canRevert: boolean;
  createdAt: number;
  promptPreview?: string | null;
  finalMessage?: string | null;
};

export type ProjectHistoryItem = {
  snapshotId: string;
  label: string;
  createdAt: number;
  fileCount: number;
};
