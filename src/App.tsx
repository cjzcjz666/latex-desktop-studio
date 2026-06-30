import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  AlertTriangle,
  Bot,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Code2,
  Columns2,
  CornerDownLeft,
  Download,
  Eye,
  FilePlus2,
  FileImage,
  FileText,
  FolderPlus,
  FolderOpen,
  GripVertical,
  Hash,
  History,
  Italic,
  List,
  ListOrdered,
  ListTree,
  LocateFixed,
  MessageSquareText,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RefreshCw,
  Save,
  Search,
  Section,
  Settings,
  Sigma,
  SquareSigma,
  Table2,
  Tags,
  Trash2,
  Undo2,
  Upload,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent as ReactFormEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CodexDiffView } from "./components/CodexDiffView";
import { FileTreeNode } from "./components/FileTreeNode";
import {
  codexContextKindLabel,
  codexContextLineRange,
  codexContextSource as codexCitationSource,
  formatCodexContextHint,
} from "./lib/codexContext";
import {
  codexDiffHunkKey,
  codexDiffHunkReviewStats,
  eventMatchesShortcut,
  formatParsedDiffHunk,
  formatCodexAnswerReviewComment,
  isReviewEndCommentLine,
  latexCommentStartIndex,
  normalizeShortcutInput,
  parsedDiffHunks,
  parseLatexTodoCommentText,
  parseUnifiedDiff,
  codexSymbolMentionTokens,
  revertParsedDiffHunkInContent,
  resolveCodexFileMentionPaths,
  shortcutFromKeyboardEvent,
  stripLatexLineComment,
  type ParsedDiffFile,
  type ParsedDiffHunk,
  type ParsedDiffLine,
} from "./lib/editorLogic";
import {
  configureMonacoLatexTheme,
  languageForPath,
  MONACO_LATEX_THEME,
  type MonacoApi,
} from "./lib/monacoLatex";
import {
  cancelCodexRun,
  cancelCompile,
  checkEnvironment,
  chooseImportFiles,
  chooseProjectFolder,
  chooseProjectZip,
  cleanProjectBuild,
  compileProject,
  countProjectWords,
  createProjectEntry,
  createProjectHistorySnapshot,
  createProject,
  deleteProjectEntry,
  exportPdfFile,
  exportProjectZip,
  getCodexDiff,
  getExistingPdfOutput,
  getProjectHistoryDiff,
  getProjectSettings,
  importProjectFiles,
  importProjectZip,
  listCodexHistory,
  listProjectHistory,
  listProjectDependencies,
  listProjectDocumentFiles,
  listProjectOutline,
  listProjectOverview,
  listProjectFiles,
  listProjectFileUsages,
  listProjectReferenceIssues,
  listProjectSymbols,
  listProjectTodos,
  listRecentProjects,
  openPdfFile,
  openProject,
  readFile,
  readProjectAssetFile,
  replaceProjectText,
  revertCodexFile,
  renameProjectEntry,
  revealPdfFile,
  restoreProjectHistorySnapshot,
  revertCodexRun,
  runCodexAsk,
  runCodexEdit,
  saveFile,
  searchProjectFiles,
  synctexForwardSearch,
  synctexReverseSearch,
  updateProjectSettings,
} from "./tauri";
import type {
  CodexEditorContext,
  CodexRunEvent,
  CodexHistoryItem,
  CompileEvent,
  CompileResult,
  Diagnostic,
  DiffSummary,
  EnvironmentStatus,
  FileNode,
  OutlineItem,
  ProjectDependency,
  ProjectOverview,
  ProjectHistoryItem,
  ProjectFileUsage,
  ProjectReferenceIssue,
  ProjectSettings,
  ProjectSummary,
  ProjectAsset,
  ProjectSymbol,
  ProjectTodo,
  PdfSyncTarget,
  RecentProject,
  SearchResult,
  WordCountResult,
} from "./types";

const PdfPreview = lazy(() =>
  import("./components/PdfPreview").then((module) => ({ default: module.PdfPreview })),
);
const AssetPreview = lazy(() =>
  import("./components/AssetPreview").then((module) => ({ default: module.AssetPreview })),
);

const textExtensions = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "bst",
  "json",
  "md",
  "txt",
  "log",
]);

type ViewMode = "editor" | "split" | "preview";
type ProjectTemplate = "article" | "preprint" | "chinese" | "chinese-multifile" | "multifile" | "beamer" | "blank";

const PROJECT_TEMPLATES: Array<{
  value: ProjectTemplate;
  label: string;
  description: string;
  meta: string;
  useCase: string;
  engine: string;
  files: string[];
  features: string[];
}> = [
  {
    value: "article",
    label: "论文草稿",
    description: "单文件英文论文，含参考文献入口。",
    meta: "main.tex + references.bib",
    useCase: "适合从零开始写英文论文、课程报告或短稿。",
    engine: "XeLaTeX / pdfLaTeX",
    files: ["main.tex", "references.bib"],
    features: ["标题页", "Introduction", "BibTeX"],
  },
  {
    value: "preprint",
    label: "预印本",
    description: "适合 arXiv 风格草稿，含摘要、图表和实验段落。",
    meta: "article + booktabs",
    useCase: "适合论文初稿、arXiv preprint 和实验论文骨架。",
    engine: "XeLaTeX / pdfLaTeX",
    files: ["main.tex", "references.bib"],
    features: ["Abstract", "Method", "Experiments", "Results table"],
  },
  {
    value: "multifile",
    label: "多文件论文",
    description: "按章节拆分，适合长论文持续写作。",
    meta: "sections/*.tex",
    useCase: "适合长论文、多人分章节写作习惯，文件树更接近 Overleaf 项目。",
    engine: "XeLaTeX / pdfLaTeX",
    files: ["main.tex", "sections/intro.tex", "sections/method.tex", "references.bib"],
    features: ["\\input 章节", "项目大纲", "BibTeX"],
  },
  {
    value: "chinese",
    label: "中文论文",
    description: "基于 ctexart 的中文单文件模板。",
    meta: "ctex + xelatex",
    useCase: "适合中文课程论文、中文报告和需要中文排版的短文档。",
    engine: "XeLaTeX",
    files: ["main.tex", "references.bib"],
    features: ["ctexart", "中文章节", "中文缺包提示"],
  },
  {
    value: "chinese-multifile",
    label: "中文多文件",
    description: "中文论文项目，按章节组织源码。",
    meta: "ctex + sections",
    useCase: "适合中文长文、毕业论文草稿或分章节持续写作。",
    engine: "XeLaTeX",
    files: ["main.tex", "sections/intro.tex", "sections/method.tex", "sections/experiments.tex", "references.bib"],
    features: ["ctexart", "\\input 章节", "实验章节"],
  },
  {
    value: "beamer",
    label: "演示文稿",
    description: "Beamer slides，适合组会和答辩。",
    meta: "slides",
    useCase: "适合组会汇报、答辩 slides 和研究进展展示。",
    engine: "XeLaTeX / pdfLaTeX",
    files: ["main.tex"],
    features: ["16:9", "Madrid theme", "Outline"],
  },
  {
    value: "blank",
    label: "空白文档",
    description: "最小可编译文档，从干净页面开始。",
    meta: "main.tex",
    useCase: "适合粘贴已有 LaTeX 内容，或完全自定义模板。",
    engine: "XeLaTeX / pdfLaTeX",
    files: ["main.tex"],
    features: ["最小文档", "无 BibTeX"],
  },
];

const LATEX_INSERT_ACTIONS = [
  {
    id: "bold",
    label: "加粗",
    title: "加粗选区 (⌘B)",
    icon: Bold,
    before: "\\textbf{",
    placeholder: "text",
    after: "}",
  },
  {
    id: "italic",
    label: "斜体",
    title: "斜体选区 (⌘I)",
    icon: Italic,
    before: "\\emph{",
    placeholder: "text",
    after: "}",
  },
  {
    id: "inline-math",
    label: "公式",
    title: "插入行内公式",
    icon: Sigma,
    before: "$",
    placeholder: "x",
    after: "$",
  },
  {
    id: "display-math",
    label: "展示公式",
    title: "插入展示公式",
    icon: SquareSigma,
    before: "\\[\n",
    placeholder: "x = y",
    after: "\n\\]\n",
  },
  {
    id: "section",
    label: "章节",
    title: "插入 section",
    icon: Section,
    before: "\\section{",
    placeholder: "Title",
    after: "}\n",
  },
  {
    id: "subsection",
    label: "小节",
    title: "插入 subsection",
    icon: Section,
    before: "\\subsection{",
    placeholder: "Title",
    after: "}\n",
  },
  {
    id: "itemize",
    label: "列表",
    title: "插入 itemize",
    icon: List,
    before: "\\begin{itemize}\n  \\item ",
    placeholder: "item",
    after: "\n\\end{itemize}\n",
  },
  {
    id: "enumerate",
    label: "编号",
    title: "插入 enumerate",
    icon: ListOrdered,
    before: "\\begin{enumerate}\n  \\item ",
    placeholder: "item",
    after: "\n\\end{enumerate}\n",
  },
  {
    id: "figure",
    label: "图片",
    title: "插入 figure",
    icon: FileImage,
    before: "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.9\\linewidth]{",
    placeholder: "figures/example.pdf",
    after: "}\n  \\caption{Caption}\n  \\label{fig:key}\n\\end{figure}\n",
  },
  {
    id: "table",
    label: "表格",
    title: "插入 table",
    icon: Table2,
    before: "\\begin{table}[t]\n  \\centering\n  \\caption{Caption}\n  \\label{tab:key}\n  \\begin{tabular}{ll}\n    ",
    placeholder: "Column A & Column B \\\\",
    after: "\n  \\end{tabular}\n\\end{table}\n",
  },
] as const;

type LatexInsertAction = (typeof LATEX_INSERT_ACTIONS)[number];

type EditorTab = {
  path: string;
  content: string;
  dirty: boolean;
};

type CreateEntryDraft = {
  kind: "file" | "directory";
  parentPath: string;
  path: string;
};

type RenameEntryDraft = {
  fromPath: string;
  path: string;
};

type DeleteEntryDraft = {
  path: string;
  usages: ProjectFileUsage[];
  isCheckingUsages: boolean;
};

type ProjectEditorSession = {
  activePath?: string;
  openPaths?: string[];
  recentPaths?: string[];
};

type PendingEditorInsertion = {
  text: string;
  source: string;
  status: string;
};

type BibEntryDraft = {
  targetFile: string;
  entryType: "article" | "inproceedings" | "misc";
  key: string;
  author: string;
  title: string;
  year: string;
  venue: string;
  insertCitation: boolean;
};

type CodexReferencedFileContext = {
  path: string;
  content: string;
  originalLength: number;
  truncated: boolean;
};

type CodexLatexMacroSummary = {
  path: string;
  line: number;
  command: string;
  name: string;
  signature: string;
  preview: string;
};

type CodexReferencedSymbolContext = {
  symbol: ProjectSymbol;
  source: string;
  sourceStartLine: number;
  sourceEndLine: number;
  truncated: boolean;
};

type CodexMentionQuery = {
  trigger: "@" | "#";
  query: string;
  start: number;
  end: number;
};

type CodexMentionSuggestion = {
  kind: "file" | "label" | "citation";
  value: string;
  title: string;
  detail: string;
};

type AutoSaveState = "idle" | "saving" | "saved" | "error";
type CodexRunMode = "edit" | "ask";
type ShortcutActionId =
  | "save"
  | "compile"
  | "codex"
  | "codexContext"
  | "togglePreview"
  | "quickOpen"
  | "projectSearch"
  | "findInFile"
  | "replaceInFile"
  | "goToLine"
  | "toggleComment"
  | "reviewMode"
  | "insertReviewComment"
  | "syncPdf"
  | "exportPdf"
  | "cleanBuild";
type ShortcutMap = Record<ShortcutActionId, string>;

const RESIZE_HANDLE_WIDTH = 12;
const MIN_EDITOR_WIDTH = 320;
const MIN_PREVIEW_WIDTH = 280;
const MAX_CODEX_SELECTION_CONTEXT = 12_000;
const MAX_CODEX_ACTIVE_SECTION_CONTEXT = 10_000;
const MAX_CODEX_NEARBY_CONTEXT = 2_800;
const CODEX_NEARBY_CONTEXT_RADIUS = 8;
const MAX_CODEX_PROJECT_FILES = 80;
const MAX_CODEX_DOCUMENT_FILES = 60;
const MAX_CODEX_DEPENDENCIES = 40;
const MAX_CODEX_SYMBOLS = 80;
const MAX_CODEX_PREAMBLE_CONTEXT = 8_000;
const MAX_CODEX_LOCAL_STYLE_CONTEXT_FILES = 5;
const MAX_CODEX_LOCAL_STYLE_CONTEXT = 6_000;
const MAX_CODEX_MACRO_SUMMARIES = 80;
const MAX_CODEX_MACRO_SOURCE_FILES = 36;
const MAX_CODEX_CONTEXT_CITATIONS = 16;
const MAX_CODEX_CONTEXT_CITATION_SOURCES = 8;
const MAX_CODEX_CONTEXT_LABEL_REFS = 16;
const MAX_CODEX_CONTEXT_DEFINED_LABELS = 20;
const MAX_CODEX_CONTEXT_ENVIRONMENTS = 20;
const MAX_CODEX_CONTEXT_GRAPHICS = 12;
const MAX_CODEX_CONTEXT_TODOS = 12;
const MAX_CODEX_OUTLINE_ITEMS = 36;
const MAX_CODEX_TODOS = 24;
const MAX_CODEX_TODO_SOURCE_SNIPPETS = 8;
const MAX_CODEX_REFERENCE_ISSUES = 40;
const MAX_CODEX_REFERENCE_SOURCE_SNIPPETS = 8;
const MAX_CODEX_DIAGNOSTICS = 12;
const MAX_CODEX_DIAGNOSTIC_SOURCE_SNIPPETS = 8;
const DIAGNOSTIC_SOURCE_CONTEXT_RADIUS = 5;
const TODO_SOURCE_CONTEXT_RADIUS = 8;
const REFERENCE_SOURCE_CONTEXT_RADIUS = 6;
const MAX_CODEX_DIFF_CONTEXT = 16_000;
const MAX_CODEX_REFERENCED_FILES = 6;
const MAX_CODEX_REFERENCED_FILE_CONTEXT = 6_000;
const MAX_CODEX_REFERENCED_SYMBOLS = 8;
const MAX_CODEX_REFERENCED_SYMBOL_CONTEXT = 2_800;
const CODEX_SYMBOL_CONTEXT_RADIUS = 5;
const MAX_CODEX_MENTION_SUGGESTIONS = 8;
const MAX_PROJECT_STRUCTURE_DOCUMENTS = 18;
const MAX_PROJECT_STRUCTURE_DEPENDENCIES = 48;
const MAX_RESTORED_EDITOR_TABS = 16;
const MAX_RECENT_EDITOR_FILES = 12;
const AUTO_SAVE_DELAY_MS = 1_100;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_EDITOR_FONT_SIZE = 11;
const MAX_EDITOR_FONT_SIZE = 22;
const DEFAULT_SIDEBAR_WIDTH = 316;
const DEFAULT_PREVIEW_WIDTH = 560;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 520;
const MAX_PERSISTED_PREVIEW_WIDTH = 920;
const AUTO_SAVE_PREF_KEY = "latex-studio:auto-save";
const AUTO_COMPILE_PREF_KEY = "latex-studio:auto-compile";
const EDITOR_FONT_SIZE_PREF_KEY = "latex-studio:editor-font-size";
const EDITOR_WORD_WRAP_PREF_KEY = "latex-studio:editor-word-wrap";
const SIDEBAR_WIDTH_PREF_KEY = "latex-studio:sidebar-width";
const PREVIEW_WIDTH_PREF_KEY = "latex-studio:preview-width";
const VIEW_MODE_PREF_KEY = "latex-studio:view-mode";
const SIDEBAR_COLLAPSED_PREF_KEY = "latex-studio:sidebar-collapsed";
const PREVIEW_COLLAPSED_PREF_KEY = "latex-studio:preview-collapsed";
const CODEX_COLLAPSED_PREF_KEY = "latex-studio:codex-collapsed";
const OUTLINE_COLLAPSED_PREF_KEY = "latex-studio:outline-collapsed";
const STRUCTURE_COLLAPSED_PREF_KEY = "latex-studio:structure-collapsed";
const SYMBOLS_COLLAPSED_PREF_KEY = "latex-studio:symbols-collapsed";
const TODOS_COLLAPSED_PREF_KEY = "latex-studio:todos-collapsed";
const PROJECT_EDITOR_SESSION_PREF_PREFIX = "latex-studio:project-session";
const PROJECT_SAVE_HISTORY_SIGNATURE_PREF_PREFIX = "latex-studio:save-history-signature";
const SHORTCUT_PREF_KEY = "latex-studio:shortcuts";
const DEFAULT_SHORTCUTS: ShortcutMap = {
  save: "⌘S",
  compile: "⌘↵",
  codex: "⌘K",
  codexContext: "⌘⇧K",
  togglePreview: "⌘P",
  quickOpen: "⌘O",
  projectSearch: "⌘⇧F",
  findInFile: "⌘F",
  replaceInFile: "⌘⌥F",
  goToLine: "⌘G",
  toggleComment: "⌘/",
  reviewMode: "⌘⇧M",
  insertReviewComment: "⌘⇧A",
  syncPdf: "⌘⌥P",
  exportPdf: "⌘⇧E",
  cleanBuild: "⌘⇧↵",
};
const SHORTCUT_DEFINITIONS: Array<{
  id: ShortcutActionId;
  label: string;
  hint: string;
}> = [
  { id: "compile", label: "编译", hint: "保存脏文件并编译当前项目" },
  { id: "codex", label: "AI 修改", hint: "聚焦底部 Codex 命令条" },
  { id: "codexContext", label: "锁定上下文", hint: "把当前选区或光标附近内容交给 Codex" },
  { id: "togglePreview", label: "切换预览", hint: "在分屏和纯预览之间切换" },
  { id: "save", label: "保存", hint: "保存当前打开的修改" },
  { id: "quickOpen", label: "快速打开", hint: "按文件名跳转" },
  { id: "projectSearch", label: "项目搜索", hint: "搜索整个 LaTeX 项目" },
  { id: "findInFile", label: "当前文件查找", hint: "打开 Monaco 查找" },
  { id: "replaceInFile", label: "当前文件替换", hint: "打开 Monaco 替换" },
  { id: "goToLine", label: "跳转行号", hint: "跳到当前文件行号" },
  { id: "toggleComment", label: "行注释", hint: "注释或取消注释选中行" },
  { id: "reviewMode", label: "Review 批注", hint: "进入/退出批注模式，并高亮 REVIEW 内容" },
  { id: "insertReviewComment", label: "添加批注", hint: "在 Review 模式下为当前行或选中内容添加批注" },
  { id: "syncPdf", label: "定位 PDF", hint: "从当前源码光标跳到 PDF 对应位置" },
  { id: "exportPdf", label: "导出 PDF", hint: "导出最近一次编译的 PDF" },
  { id: "cleanBuild", label: "清理编译", hint: "清理构建缓存" },
];
export function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState<ProjectTemplate>("article");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectSettings, setProjectSettings] = useState<ProjectSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<ProjectSettings | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null);
  const [projectPreambleContext, setProjectPreambleContext] = useState("");
  const [projectLocalStyleContexts, setProjectLocalStyleContexts] = useState<CodexReferencedFileContext[]>([]);
  const [projectMacroSummaries, setProjectMacroSummaries] = useState<CodexLatexMacroSummary[]>([]);
  const [projectDocumentFiles, setProjectDocumentFiles] = useState<string[]>([]);
  const [projectDependencies, setProjectDependencies] = useState<ProjectDependency[]>([]);
  const [projectSymbols, setProjectSymbols] = useState<ProjectSymbol[]>([]);
  const [projectTodos, setProjectTodos] = useState<ProjectTodo[]>([]);
  const [projectReferenceIssues, setProjectReferenceIssues] = useState<ProjectReferenceIssue[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [recentFilePaths, setRecentFilePaths] = useState<string[]>([]);
  const [activeAsset, setActiveAsset] = useState<ProjectAsset | null>(null);
  const [content, setContent] = useState("");
  const [pendingEditorInsertion, setPendingEditorInsertion] = useState<PendingEditorInsertion | null>(null);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [pdfRevision, setPdfRevision] = useState(0);
  const [pdfSyncTarget, setPdfSyncTarget] = useState<PdfSyncTarget | null>(null);
  const [sourceSyncHighlight, setSourceSyncHighlight] = useState<{ file: string; line: number; nonce: number } | null>(
    null,
  );
  const [sourceRevision, setSourceRevision] = useState(0);
  const [compiledSourceRevision, setCompiledSourceRevision] = useState(0);
  const [lastSuccessfulCompileAt, setLastSuccessfulCompileAt] = useState<number | null>(null);
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(() =>
    loadBooleanPreference(AUTO_SAVE_PREF_KEY, true),
  );
  const [isAutoCompileEnabled, setIsAutoCompileEnabled] = useState(() =>
    loadBooleanPreference(AUTO_COMPILE_PREF_KEY, false),
  );
  const [editorFontSize, setEditorFontSize] = useState(() =>
    loadNumberPreference(
      EDITOR_FONT_SIZE_PREF_KEY,
      DEFAULT_EDITOR_FONT_SIZE,
      MIN_EDITOR_FONT_SIZE,
      MAX_EDITOR_FONT_SIZE,
    ),
  );
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [codexPrompt, setCodexPrompt] = useState("");
  const [codexPromptCursor, setCodexPromptCursor] = useState(0);
  const [isCodexPromptFocused, setIsCodexPromptFocused] = useState(false);
  const [codexMentionIndex, setCodexMentionIndex] = useState(0);
  const [editorContextHint, setEditorContextHint] = useState("");
  const [pinnedCodexContext, setPinnedCodexContext] = useState<CodexEditorContext | null>(null);
  const [editorCursorPosition, setEditorCursorPosition] = useState({ line: 1, column: 1 });
  const [editorSelectionSummary, setEditorSelectionSummary] = useState("");
  const [editorWordSummary, setEditorWordSummary] = useState("");
  const [codexEvents, setCodexEvents] = useState<CodexRunEvent[]>([]);
  const [codexAnswer, setCodexAnswer] = useState("");
  const [codexConversationPrompt, setCodexConversationPrompt] = useState("");
  const [codexHistory, setCodexHistory] = useState<CodexHistoryItem[]>([]);
  const [isCodexDiffContextEnabled, setIsCodexDiffContextEnabled] = useState(false);
  const [isCodexContextOnlyEnabled, setIsCodexContextOnlyEnabled] = useState(false);
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryItem[]>([]);
  const [historyDiffSummary, setHistoryDiffSummary] = useState<DiffSummary | null>(null);
  const [historyDiffItem, setHistoryDiffItem] = useState<ProjectHistoryItem | null>(null);
  const [historyRestoreItem, setHistoryRestoreItem] = useState<ProjectHistoryItem | null>(null);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [acceptedCodexHunkKeys, setAcceptedCodexHunkKeys] = useState<string[]>([]);
  const [hiddenCodexHighlightRunId, setHiddenCodexHighlightRunId] = useState<string | null>(null);
  const [isCodexRevertConfirmVisible, setIsCodexRevertConfirmVisible] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isCodexRunning, setIsCodexRunning] = useState(false);
  const [isCodexCancelling, setIsCodexCancelling] = useState(false);
  const [codexRunMode, setCodexRunMode] = useState<CodexRunMode>("edit");
  const [status, setStatus] = useState("就绪");
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const [pendingColumn, setPendingColumn] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [isReplaceConfirmVisible, setIsReplaceConfirmVisible] = useState(false);
  const [createEntryDraft, setCreateEntryDraft] = useState<CreateEntryDraft | null>(null);
  const [renameEntryDraft, setRenameEntryDraft] = useState<RenameEntryDraft | null>(null);
  const [deleteEntryDraft, setDeleteEntryDraft] = useState<DeleteEntryDraft | null>(null);
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [showResolvedTodos, setShowResolvedTodos] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [bibEntryDraft, setBibEntryDraft] = useState<BibEntryDraft | null>(null);
  const [wordCount, setWordCount] = useState<WordCountResult | null>(null);
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showWordCountPanel, setShowWordCountPanel] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => loadShortcutPreferences());
  const [shortcutDrafts, setShortcutDrafts] = useState<ShortcutMap>(() => loadShortcutPreferences());
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadNumberPreference(SIDEBAR_WIDTH_PREF_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
  );
  const [previewWidth, setPreviewWidth] = useState(() =>
    loadNumberPreference(PREVIEW_WIDTH_PREF_KEY, DEFAULT_PREVIEW_WIDTH, MIN_PREVIEW_WIDTH, MAX_PERSISTED_PREVIEW_WIDTH),
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    loadBooleanPreference(SIDEBAR_COLLAPSED_PREF_KEY, false),
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(() =>
    loadBooleanPreference(PREVIEW_COLLAPSED_PREF_KEY, false),
  );
  const [isCodexCollapsed, setIsCodexCollapsed] = useState(() =>
    loadBooleanPreference(CODEX_COLLAPSED_PREF_KEY, false),
  );
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(() =>
    loadBooleanPreference(OUTLINE_COLLAPSED_PREF_KEY, false),
  );
  const [isStructureCollapsed, setIsStructureCollapsed] = useState(() =>
    loadBooleanPreference(STRUCTURE_COLLAPSED_PREF_KEY, true),
  );
  const [isSymbolsCollapsed, setIsSymbolsCollapsed] = useState(() =>
    loadBooleanPreference(SYMBOLS_COLLAPSED_PREF_KEY, true),
  );
  const [isTodosCollapsed, setIsTodosCollapsed] = useState(() =>
    loadBooleanPreference(TODOS_COLLAPSED_PREF_KEY, false),
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewModePreference(VIEW_MODE_PREF_KEY, "split"));
  const [isEditorCompact, setIsEditorCompact] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isGoToLineOpen, setIsGoToLineOpen] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState("");
  const [pendingCloseTabPath, setPendingCloseTabPath] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const editorPanelRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const codexDecorationCollectionRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const reviewDecorationCollectionRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const sourceSyncDecorationCollectionRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const lastSavedHistorySignatureRef = useRef<{ root: string; signature: string | null }>({
    root: "",
    signature: null,
  });
  const openSymbolFromReferenceRef = useRef<(symbol: ProjectSymbol) => Promise<void>>(async () => undefined);
  const projectSearchInputRef = useRef<HTMLInputElement | null>(null);
  const createEntryInputRef = useRef<HTMLInputElement | null>(null);
  const renameEntryInputRef = useRef<HTMLInputElement | null>(null);
  const goToLineInputRef = useRef<HTMLInputElement | null>(null);
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);
  const codexPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const projectSummaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const projectPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const autoRestoreAttemptedRef = useRef(false);
  const compileRequestSerialRef = useRef(0);
  const lastCompileFailedRef = useRef(false);
  const editorShortcutActionsRef = useRef<{
    save: () => Promise<void>;
    compile: () => Promise<void>;
    quickOpen: () => void;
    projectSearch: () => void;
    findInFile: () => void;
    replaceInFile: () => void;
    goToLine: () => void;
    focusCodex: () => void;
    sendCodexContext: () => void;
    toggleComment: () => void;
    toggleReviewMode: () => void;
    insertReviewComment: () => void;
    syncPdf: () => Promise<void>;
    insertLatex: (id: LatexInsertAction["id"]) => void;
    closeActiveTab: () => Promise<void>;
    switchTab: (offset: number) => void;
  }>({
    save: async () => undefined,
    compile: async () => undefined,
    quickOpen: () => undefined,
    projectSearch: () => undefined,
    findInFile: () => undefined,
    replaceInFile: () => undefined,
    goToLine: () => undefined,
    focusCodex: () => undefined,
    sendCodexContext: () => undefined,
    toggleComment: () => undefined,
    toggleReviewMode: () => undefined,
    insertReviewComment: () => undefined,
    syncPdf: async () => undefined,
    insertLatex: () => undefined,
    closeActiveTab: async () => undefined,
    switchTab: () => undefined,
  });
  const codexCancelRequestedRef = useRef(false);
  const sourceRevisionRef = useRef(0);
  const allProjectFiles = useMemo(() => collectProjectFiles(files), [files]);
  const projectBibFiles = useMemo(
    () => allProjectFiles.filter((file) => file.toLowerCase().endsWith(".bib")),
    [allProjectFiles],
  );
  const codexPromptReferencedFiles = useMemo(
    () =>
      project
        ? resolveCodexFileMentionPaths(codexPrompt, allProjectFiles, MAX_CODEX_REFERENCED_FILES)
        : [],
    [allProjectFiles, codexPrompt, project],
  );
  const codexPromptReferencedSymbols = useMemo(
    () =>
      project
        ? resolveCodexSymbolMentionKeys(codexPrompt, projectSymbols, MAX_CODEX_REFERENCED_SYMBOLS)
            .map((key) => uniqueProjectSymbolByKey(projectSymbols, key))
            .filter((symbol): symbol is ProjectSymbol => Boolean(symbol))
        : [],
    [codexPrompt, project, projectSymbols],
  );
  const codexEditableScopeFiles = useMemo(
    () =>
      uniqueTextPaths([
        ...(pinnedCodexContext?.file ? [pinnedCodexContext.file] : []),
        ...codexPromptReferencedFiles,
        ...codexPromptReferencedSymbols.map((symbol) => symbol.file),
        ...(isCodexDiffContextEnabled && diffSummary?.changedFiles.length
          ? diffSummary.changedFiles.filter(isTextPath)
          : []),
      ]),
    [
      pinnedCodexContext?.file,
      codexPromptReferencedFiles,
      codexPromptReferencedSymbols,
      diffSummary,
      isCodexDiffContextEnabled,
    ],
  );
  const canUseCodexContextScope = codexEditableScopeFiles.length > 0;
  const defaultBibTargetFile = projectBibFiles[0] ?? "references.bib";
  const quickOpenFiles = useMemo(
    () => filterProjectFilesForQuickOpen(allProjectFiles, quickOpenQuery).slice(0, 80),
    [allProjectFiles, quickOpenQuery],
  );

  function markSourceEdited() {
    sourceRevisionRef.current += 1;
    setSourceRevision(sourceRevisionRef.current);
    setCompileResult((current) => (current && !current.success ? null : current));
  }

  function clearStaleCompileFailure() {
    setCompileResult((current) => (current && !current.success ? null : current));
  }

  function rememberRecentFile(path: string) {
    if (!isTextPath(path)) return;
    setRecentFilePaths((current) =>
      uniqueTextPaths([path, ...current]).slice(0, MAX_RECENT_EDITOR_FILES),
    );
  }

  const isCodexHighlightVisible = Boolean(
    diffSummary?.changedFiles.length && diffSummary.runId !== hiddenCodexHighlightRunId,
  );
  const activeCodexChangeLines = useMemo(
    () =>
      isCodexHighlightVisible && activePath && diffSummary
        ? codexChangedLineNumbersForPath(diffSummary, activePath, acceptedCodexHunkKeys)
        : [],
    [acceptedCodexHunkKeys, activePath, diffSummary, isCodexHighlightVisible],
  );
  const activeCodexChangeIndex = activeCodexChangeLines.length
    ? Math.max(
        0,
        activeCodexChangeLines.findIndex((line) => line >= editorCursorPosition.line),
      )
    : -1;
  const canUseCodexDiffContext = Boolean(diffSummary?.changedFiles.length);

  useEffect(() => {
    setAcceptedCodexHunkKeys([]);
  }, [diffSummary?.runId]);

  const codexReviewStats = useMemo(
    () => (diffSummary ? codexDiffHunkReviewStats(diffSummary.unifiedDiff, acceptedCodexHunkKeys) : null),
    [acceptedCodexHunkKeys, diffSummary],
  );
  const codexReviewBadgeCount =
    codexReviewStats && codexReviewStats.totalHunks > 0
      ? codexReviewStats.pendingHunks
      : diffSummary?.changedFiles.length ?? 0;
  const codexReviewBadgeTitle =
    codexReviewStats && codexReviewStats.totalHunks > 0
      ? `${codexReviewStats.pendingHunks} 个片段待审，${codexReviewStats.acceptedHunks} 个已保留`
      : diffSummary?.changedFiles.length
        ? `${diffSummary.changedFiles.length} 个文件发生变化`
        : "";

  useEffect(() => {
    let mounted = true;
    checkEnvironment()
      .then((status) => {
        if (mounted) setEnvironment(status);
      })
      .catch((error) => {
        if (mounted) setStatus(String(error));
      });

    const restoreRecentProject = async () => {
      try {
        const projects = await listRecentProjects();
        if (!mounted) return;
        setRecentProjects(projects);
        if (autoRestoreAttemptedRef.current || !projects.length) return;
        autoRestoreAttemptedRef.current = true;
        const latest = projects[0];
        setStatus(`正在恢复最近项目：${latest.name}...`);
        const nextProject = await openProject(latest.root);
        if (!mounted) return;
        await activateProject(nextProject, "已恢复上次打开的项目。");
      } catch (error) {
        if (!mounted) return;
        autoRestoreAttemptedRef.current = true;
        setStatus(`无法自动恢复最近项目：${errorMessage(error)}`);
      }
    };
    void restoreRecentProject();

    const unlisten: UnlistenFn[] = [];

    listen<CompileEvent>("compile:event", (event) => {
      const payload = event.payload;
      if (payload.kind === "log" && payload.message) {
        setStatus(payload.message);
      }
    }).then((fn) => (mounted ? unlisten.push(fn) : fn()));

    listen<CodexRunEvent>("codex:event", (event) => {
      setCodexEvents((current) => [...current.slice(-100), event.payload]);
      if (event.payload.kind === "completed" || event.payload.kind === "error") {
        setIsCodexRunning(false);
        setIsCodexCancelling(false);
      }
    }).then((fn) => (mounted ? unlisten.push(fn) : fn()));

    return () => {
      mounted = false;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (activeAsset) {
      editorRef.current = null;
      setEditorSelectionSummary("");
      setEditorWordSummary("");
    }
  }, [activeAsset]);

  useEffect(() => {
    if (!canUseCodexDiffContext && isCodexDiffContextEnabled) {
      setIsCodexDiffContextEnabled(false);
    }
  }, [canUseCodexDiffContext, isCodexDiffContextEnabled]);

  useEffect(() => {
    if (!canUseCodexContextScope && isCodexContextOnlyEnabled) {
      setIsCodexContextOnlyEnabled(false);
    }
  }, [canUseCodexContextScope, isCodexContextOnlyEnabled]);

  useEffect(() => {
    if (pendingLine && editorRef.current) {
      editorRef.current.revealLineInCenter(pendingLine);
      editorRef.current.setPosition({ lineNumber: pendingLine, column: pendingColumn ?? 1 });
      editorRef.current.focus();
    }
  }, [activePath, pendingLine, pendingColumn]);

  useEffect(() => {
    if (!pendingEditorInsertion || activeAsset || !editorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (insertTextAtEditorSelection(pendingEditorInsertion.text, pendingEditorInsertion.source)) {
        setStatus(pendingEditorInsertion.status);
        setPendingEditorInsertion(null);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingEditorInsertion, activeAsset, activePath, isEditorReady]);

  useEffect(() => {
    const monacoApi = monacoRef.current;
    if (!isEditorReady || !monacoApi) return;

    const models = monacoApi.editor.getModels();
    for (const model of models) {
      const modelPath = projectPathFromMonacoModel(model, project?.root);
      const markers =
        project && modelPath
          ? [
              ...diagnosticsForPath(compileResult, modelPath, project.root).map((diagnostic) =>
                diagnosticToMonacoMarker(monacoApi, model, diagnostic),
              ),
              ...(isLatexReferenceSourcePath(modelPath)
                ? unresolvedLatexReferenceMarkers(monacoApi, model, projectSymbols)
                : []),
              ...(isLatexReferenceSourcePath(modelPath)
                ? unresolvedLatexFileReferenceMarkers(monacoApi, model, allProjectFiles)
                : []),
            ]
          : [];
      monacoApi.editor.setModelMarkers(model, "latex-studio", markers);
    }

    return () => {
      for (const model of monacoApi.editor.getModels()) {
        monacoApi.editor.setModelMarkers(model, "latex-studio", []);
      }
    };
  }, [allProjectFiles, compileResult, activePath, project?.root, projectSymbols, tabs, isEditorReady]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(layoutEditorToPanel);
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarWidth, previewWidth, isSidebarCollapsed, isPreviewCollapsed, viewMode]);

  useEffect(() => {
    if (viewMode !== "split" || isPreviewCollapsed) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const clampPreviewTrack = () => {
      const workspaceWidth = workspace.getBoundingClientRect().width || window.innerWidth;
      const sidebarTrackWidth = isSidebarCollapsed ? 48 : sidebarWidth;
      const available = workspaceWidth - sidebarTrackWidth - RESIZE_HANDLE_WIDTH - RESIZE_HANDLE_WIDTH;
      const maxPreviewWidth = Math.min(
        MAX_PERSISTED_PREVIEW_WIDTH,
        Math.max(MIN_PREVIEW_WIDTH, available - MIN_EDITOR_WIDTH),
      );
      setPreviewWidth((current) => {
        if (current <= maxPreviewWidth) return current;
        workspace.style.setProperty("--preview-width", `${maxPreviewWidth}px`);
        return maxPreviewWidth;
      });
    };

    clampPreviewTrack();
    const observer = new ResizeObserver(clampPreviewTrack);
    observer.observe(workspace);
    window.addEventListener("resize", clampPreviewTrack);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampPreviewTrack);
    };
  }, [sidebarWidth, isSidebarCollapsed, isPreviewCollapsed, viewMode]);

  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    const model = editor?.getModel();
    if (
      !editor ||
      !monacoApi ||
      !model ||
      !isEditorReady ||
      activeAsset ||
      !activePath ||
      !diffSummary ||
      !isCodexHighlightVisible
    ) {
      codexDecorationCollectionRef.current?.clear();
      return;
    }

    if (!codexDecorationCollectionRef.current) {
      codexDecorationCollectionRef.current = editor.createDecorationsCollection();
    }
    codexDecorationCollectionRef.current.set(
      codexEditorDecorationsForPath(monacoApi, diffSummary, activePath, model.getLineCount(), acceptedCodexHunkKeys),
    );
  }, [acceptedCodexHunkKeys, diffSummary, activePath, activeAsset, isEditorReady, isCodexHighlightVisible]);

  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monacoApi || !model || !isEditorReady || activeAsset || !activePath || !isReviewMode) {
      reviewDecorationCollectionRef.current?.clear();
      return;
    }

    if (!reviewDecorationCollectionRef.current) {
      reviewDecorationCollectionRef.current = editor.createDecorationsCollection();
    }
    reviewDecorationCollectionRef.current.set(reviewEditorDecorationsForModel(monacoApi, model));
  }, [isReviewMode, activePath, activeAsset, content, tabs, isEditorReady]);

  useEffect(() => {
    sourceSyncDecorationCollectionRef.current?.clear();
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    const model = editor?.getModel();
    if (
      !sourceSyncHighlight ||
      !editor ||
      !monacoApi ||
      !model ||
      !isEditorReady ||
      activeAsset ||
      activePath !== sourceSyncHighlight.file
    ) {
      return;
    }

    const lineNumber = clamp(sourceSyncHighlight.line, 1, model.getLineCount());
    if (!sourceSyncDecorationCollectionRef.current) {
      sourceSyncDecorationCollectionRef.current = editor.createDecorationsCollection();
    }
    sourceSyncDecorationCollectionRef.current.set([
      {
        range: new monacoApi.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber)),
        options: {
          isWholeLine: true,
          className: "source-sync-editor-line",
          linesDecorationsClassName: "source-sync-editor-gutter",
          hoverMessage: {
            value: `PDF 反向定位到 ${sourceSyncHighlight.file}:${lineNumber}`,
          },
          overviewRuler: {
            color: "#2c78b7",
            position: monacoApi.editor.OverviewRulerLane.Right,
          },
        },
      },
    ]);
    const timeout = window.setTimeout(() => {
      sourceSyncDecorationCollectionRef.current?.clear();
      setSourceSyncHighlight((current) =>
        current?.nonce === sourceSyncHighlight.nonce ? null : current,
      );
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, [sourceSyncHighlight, activePath, activeAsset, isEditorReady, content]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!exitBlockers().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tabs, activePath, content, isCompiling, isCodexRunning]);

  useEffect(() => {
    let mounted = true;
    let unlistenClose: UnlistenFn | null = null;
    getCurrentWindow()
      .onCloseRequested((event) => {
        const blockers = exitBlockers();
        if (!blockers.length) return;
        event.preventDefault();
        const confirmed = window.confirm(
          `关闭 LaTeX Studio 前请确认：\n\n${blockers.map((item) => `- ${item}`).join("\n")}\n\n仍然关闭吗？`,
        );
        if (confirmed) {
          void getCurrentWindow().destroy();
        }
      })
      .then((unlisten) => {
        if (mounted) {
          unlistenClose = unlisten;
        } else {
          unlisten();
        }
      });
    return () => {
      mounted = false;
      unlistenClose?.();
    };
  }, [tabs, activePath, content, isCompiling, isCodexRunning]);

  useEffect(() => {
    if (!showProjectPanel && !showSettingsPanel) return;

    const containsTarget = (element: HTMLElement | null, target: EventTarget | null) =>
      Boolean(element && target instanceof Node && element.contains(target));

    const handlePopoverPointerDown = (event: PointerEvent) => {
      if (
        containsTarget(projectPopoverRef.current, event.target) ||
        containsTarget(settingsPopoverRef.current, event.target) ||
        containsTarget(projectSummaryButtonRef.current, event.target) ||
        containsTarget(settingsButtonRef.current, event.target)
      ) {
        return;
      }
      setShowProjectPanel(false);
      setShowSettingsPanel(false);
    };

    const handlePopoverKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowProjectPanel(false);
      setShowSettingsPanel(false);
    };

    window.addEventListener("pointerdown", handlePopoverPointerDown, true);
    window.addEventListener("keydown", handlePopoverKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePopoverPointerDown, true);
      window.removeEventListener("keydown", handlePopoverKeyDown, true);
    };
  }, [showProjectPanel, showSettingsPanel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isQuickOpenVisible) {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsQuickOpenVisible(false);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setQuickOpenIndex((value) => Math.min(Math.max(quickOpenFiles.length - 1, 0), value + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setQuickOpenIndex((value) => Math.max(0, value - 1));
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const selected = quickOpenFiles[quickOpenIndex] ?? quickOpenFiles[0];
          if (selected) {
            void runSafely(() => handleQuickOpenPath(selected));
          }
          return;
        }
      }

      if (eventMatchesShortcut(event, shortcuts.togglePreview)) {
        event.preventDefault();
        handleTogglePreviewShortcut();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.quickOpen)) {
        event.preventDefault();
        openQuickOpen();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.projectSearch)) {
        event.preventDefault();
        openProjectSearch();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.findInFile) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.findInFile();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.replaceInFile) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.replaceInFile();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.goToLine) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.goToLine();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.codex)) {
        event.preventDefault();
        editorShortcutActionsRef.current.focusCodex();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.codexContext) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.sendCodexContext();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.save)) {
        event.preventDefault();
        if (project) {
          void runSafely(handleSaveShortcut);
        }
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.toggleComment) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.toggleComment();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.reviewMode) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.toggleReviewMode();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.insertReviewComment) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        editorShortcutActionsRef.current.insertReviewComment();
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.syncPdf) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        if (project && activePath && !activeAsset && compileResult?.success) {
          void runSafely(handleSyncPdfFromSource);
        }
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.exportPdf) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        if (project && compileResult?.success) {
          void runSafely(handleExportPdfOutput);
        }
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.cleanBuild) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        if (project && !isCompiling) {
          void runSafely(handleCleanBuild);
        }
        return;
      }

      if (eventMatchesShortcut(event, shortcuts.compile) && !isFormFieldOutsideEditor(event.target)) {
        event.preventDefault();
        if (project && !isCompiling && environment?.canCompile !== false) {
          void runSafely(handleCompile);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    project,
    activePath,
    content,
    tabs,
    isCompiling,
    environment?.canCompile,
    isQuickOpenVisible,
    quickOpenFiles,
    quickOpenIndex,
    shortcuts,
    viewMode,
    activeAsset,
    compileResult,
    isReviewMode,
  ]);

  useEffect(() => {
    saveBooleanPreference(AUTO_SAVE_PREF_KEY, isAutoSaveEnabled);
  }, [isAutoSaveEnabled]);

  useEffect(() => {
    saveBooleanPreference(AUTO_COMPILE_PREF_KEY, isAutoCompileEnabled);
  }, [isAutoCompileEnabled]);

  useEffect(() => {
    saveNumberPreference(EDITOR_FONT_SIZE_PREF_KEY, editorFontSize);
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
    window.requestAnimationFrame(layoutEditorToPanel);
  }, [editorFontSize]);

  useEffect(() => {
    saveBooleanPreference(EDITOR_WORD_WRAP_PREF_KEY, true);
    editorRef.current?.updateOptions({
      wordWrap: "on",
      wrappingStrategy: "advanced",
      scrollbar: {
        horizontal: "hidden",
        horizontalScrollbarSize: 0,
      },
    });
  }, []);

  useEffect(() => {
    saveNumberPreference(SIDEBAR_WIDTH_PREF_KEY, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    saveNumberPreference(PREVIEW_WIDTH_PREF_KEY, previewWidth);
  }, [previewWidth]);

  useEffect(() => {
    saveViewModePreference(VIEW_MODE_PREF_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    saveBooleanPreference(SIDEBAR_COLLAPSED_PREF_KEY, isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    saveBooleanPreference(PREVIEW_COLLAPSED_PREF_KEY, isPreviewCollapsed);
  }, [isPreviewCollapsed]);

  useEffect(() => {
    saveBooleanPreference(CODEX_COLLAPSED_PREF_KEY, isCodexCollapsed);
  }, [isCodexCollapsed]);

  useEffect(() => {
    saveBooleanPreference(OUTLINE_COLLAPSED_PREF_KEY, isOutlineCollapsed);
  }, [isOutlineCollapsed]);

  useEffect(() => {
    saveBooleanPreference(STRUCTURE_COLLAPSED_PREF_KEY, isStructureCollapsed);
  }, [isStructureCollapsed]);

  useEffect(() => {
    saveBooleanPreference(SYMBOLS_COLLAPSED_PREF_KEY, isSymbolsCollapsed);
  }, [isSymbolsCollapsed]);

  useEffect(() => {
    saveBooleanPreference(TODOS_COLLAPSED_PREF_KEY, isTodosCollapsed);
  }, [isTodosCollapsed]);

  useEffect(() => {
    if (!project || !tabs.some((tab) => tab.path === activePath)) return;
    saveProjectEditorSession(project.root, {
      activePath,
      openPaths: tabs.map((tab) => tab.path),
      recentPaths: recentFilePaths,
    });
  }, [project?.root, activePath, tabs, recentFilePaths]);

  useEffect(() => {
    setIsReplaceConfirmVisible(false);
  }, [searchQuery, replaceText]);

  useEffect(() => {
    setQuickOpenIndex((value) => Math.min(value, Math.max(quickOpenFiles.length - 1, 0)));
  }, [quickOpenFiles.length]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const frame = window.requestAnimationFrame(() => projectSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!createEntryDraft) return;
    const frame = window.requestAnimationFrame(() => {
      createEntryInputRef.current?.focus();
      createEntryInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createEntryDraft]);

  useEffect(() => {
    if (!renameEntryDraft) return;
    const frame = window.requestAnimationFrame(() => {
      renameEntryInputRef.current?.focus();
      renameEntryInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renameEntryDraft]);

  useEffect(() => {
    if (!isGoToLineOpen) return;
    const frame = window.requestAnimationFrame(() => {
      goToLineInputRef.current?.focus();
      goToLineInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isGoToLineOpen]);

  useEffect(() => {
    if (!activePath || activeAsset) {
      setIsGoToLineOpen(false);
    }
  }, [activePath, activeAsset]);

  useEffect(() => {
    if (!isQuickOpenVisible) return;
    const frame = window.requestAnimationFrame(() => {
      quickOpenInputRef.current?.focus();
      quickOpenInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isQuickOpenVisible]);

  useEffect(() => {
    const shouldAutoCompile = isAutoCompileEnabled && environment?.canCompile === true;
    if (
      !project ||
      isCodexRunning ||
      !hasUnsavedTabs() ||
      (!isAutoSaveEnabled && !shouldAutoCompile)
    ) {
      return;
    }
    setAutoSaveState("idle");
    const timer = window.setTimeout(() => {
      void runAutoSave();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    project?.root,
    project?.mainFile,
    activePath,
    content,
    tabs,
    isAutoSaveEnabled,
    isAutoCompileEnabled,
    isCompiling,
    isCodexRunning,
    environment?.canCompile,
  ]);

  useEffect(() => {
    const element = editorPanelRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setIsEditorCompact(element.clientWidth < 430);
      window.requestAnimationFrame(layoutEditorToPanel);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (!isEditorReady || activeAsset || !activePath) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model || model.getValue() === content) return;
    model.setValue(content);
  }, [activeAsset, activePath, content, isEditorReady]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!isEditorReady || !editor) return;
    const monacoApi = monacoRef.current;
    if (!monacoApi) return;

    const saveAction = editor.addAction({
      id: "latex-studio.save",
      label: "保存当前项目",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS],
      run: () => {
        void editorShortcutActionsRef.current.save();
      },
    });
    const compileAction = editor.addAction({
      id: "latex-studio.compile",
      label: "编译当前项目",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter],
      run: () => {
        void editorShortcutActionsRef.current.compile();
      },
    });
    const quickOpenAction = editor.addAction({
      id: "latex-studio.quickOpen",
      label: "快速打开文件",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyP],
      run: () => {
        editorShortcutActionsRef.current.quickOpen();
      },
    });
    const projectSearchAction = editor.addAction({
      id: "latex-studio.projectSearch",
      label: "项目内搜索",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyF],
      run: () => {
        editorShortcutActionsRef.current.projectSearch();
      },
    });
    const findInFileAction = editor.addAction({
      id: "latex-studio.findInFile",
      label: "当前文件查找",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyF],
      run: () => {
        editorShortcutActionsRef.current.findInFile();
      },
    });
    const replaceInFileAction = editor.addAction({
      id: "latex-studio.replaceInFile",
      label: "当前文件替换",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF],
      run: () => {
        editorShortcutActionsRef.current.replaceInFile();
      },
    });
    const goToLineAction = editor.addAction({
      id: "latex-studio.goToLine",
      label: "跳转到行号",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyG],
      run: () => {
        editorShortcutActionsRef.current.goToLine();
      },
    });
    const focusCodexAction = editor.addAction({
      id: "latex-studio.focusCodex",
      label: "聚焦 Codex 修改输入框",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyJ],
      run: () => {
        editorShortcutActionsRef.current.focusCodex();
      },
    });
    const sendCodexContextAction = editor.addAction({
      id: "latex-studio.sendCodexContext",
      label: "把当前选区或光标送入 Codex 上下文",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyK],
      run: () => {
        editorShortcutActionsRef.current.sendCodexContext();
      },
    });
    const toggleCommentAction = editor.addAction({
      id: "latex-studio.toggleComment",
      label: "注释或取消注释当前行",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Slash],
      run: () => {
        editorShortcutActionsRef.current.toggleComment();
      },
    });
    const reviewModeAction = editor.addAction({
      id: "latex-studio.reviewMode",
      label: "切换 Review 批注模式",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyM],
      run: () => {
        editorShortcutActionsRef.current.toggleReviewMode();
      },
    });
    const insertReviewCommentAction = editor.addAction({
      id: "latex-studio.insertReviewComment",
      label: "添加 Review 批注",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyA],
      run: () => {
        editorShortcutActionsRef.current.insertReviewComment();
      },
    });
    const syncPdfAction = editor.addAction({
      id: "latex-studio.syncPdf",
      label: "从源码定位到 PDF",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyP],
      run: () => {
        void editorShortcutActionsRef.current.syncPdf();
      },
    });
    const boldAction = editor.addAction({
      id: "latex-studio.bold",
      label: "LaTeX 加粗选区",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyB],
      run: () => {
        editorShortcutActionsRef.current.insertLatex("bold");
      },
    });
    const italicAction = editor.addAction({
      id: "latex-studio.italic",
      label: "LaTeX 斜体选区",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyI],
      run: () => {
        editorShortcutActionsRef.current.insertLatex("italic");
      },
    });
    const closeTabAction = editor.addAction({
      id: "latex-studio.closeActiveTab",
      label: "关闭当前标签",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyW],
      run: () => {
        void editorShortcutActionsRef.current.closeActiveTab();
      },
    });
    const previousTabAction = editor.addAction({
      id: "latex-studio.previousTab",
      label: "切换到左侧标签",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.BracketLeft],
      run: () => {
        editorShortcutActionsRef.current.switchTab(-1);
      },
    });
    const nextTabAction = editor.addAction({
      id: "latex-studio.nextTab",
      label: "切换到右侧标签",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.BracketRight],
      run: () => {
        editorShortcutActionsRef.current.switchTab(1);
      },
    });

    return () => {
      saveAction.dispose();
      compileAction.dispose();
      quickOpenAction.dispose();
      projectSearchAction.dispose();
      findInFileAction.dispose();
      replaceInFileAction.dispose();
      goToLineAction.dispose();
      focusCodexAction.dispose();
      sendCodexContextAction.dispose();
      toggleCommentAction.dispose();
      reviewModeAction.dispose();
      insertReviewCommentAction.dispose();
      syncPdfAction.dispose();
      boldAction.dispose();
      italicAction.dispose();
      closeTabAction.dispose();
      previousTabAction.dispose();
      nextTabAction.dispose();
    };
  }, [isEditorReady]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!isEditorReady || !editor) return;
    const updateEditorStatus = () => {
      setEditorContextHint(formatCodexContextHint(readCodexEditorContext()));
      const position = editor.getPosition();
      if (position) {
        setEditorCursorPosition({ line: position.lineNumber, column: position.column });
      }
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (model) {
        setEditorWordSummary(formatEditorWordSummary(countEditorText(model.getValue())));
      }
      if (selection && model && !selection.isEmpty()) {
        const startLine = selection.getStartPosition().lineNumber;
        const endLine = selection.getEndPosition().lineNumber;
        const selectedText = model.getValueInRange(selection);
        const selectedCount = countEditorText(selectedText);
        setEditorSelectionSummary(
          `选区 ${endLine - startLine + 1} 行 / ${selectedCount.words} 词 / ${selectedCount.characters} 字`,
        );
      } else {
        setEditorSelectionSummary("");
      }
    };
    updateEditorStatus();
    const selectionDisposable = editor.onDidChangeCursorSelection(updateEditorStatus);
    const contentDisposable = editor.onDidChangeModelContent(updateEditorStatus);
    return () => {
      selectionDisposable.dispose();
      contentDisposable.dispose();
    };
  }, [isEditorReady, activePath, project?.root]);

  useEffect(() => {
    const monacoApi = monacoRef.current;
    if (!isEditorReady || !monacoApi) return;

    const symbolDisposable = monacoApi.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["{", ",", ":", "/", "."],
      provideCompletionItems: (model, position) => {
        const linePrefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const referenceContext = latexReferenceCompletionContext(linePrefix);
        if (referenceContext) {
          const symbols = projectSymbols.filter((symbol) => symbol.kind === referenceContext.kind);
          const tokenLower = referenceContext.token.toLowerCase();
          const suggestions = symbols
            .filter((symbol) => !tokenLower || symbol.key.toLowerCase().includes(tokenLower))
            .slice(0, 100)
            .map((symbol) => ({
              label: symbol.key,
              kind:
                symbol.kind === "citation"
                  ? monacoApi.languages.CompletionItemKind.Reference
                  : monacoApi.languages.CompletionItemKind.Variable,
              insertText: symbol.key,
              detail:
                symbol.kind === "citation"
                  ? `${symbol.detail ?? "bib"} · ${symbol.file}:${symbol.line}`
                  : `label · ${symbol.file}:${symbol.line}`,
              documentation:
                symbol.kind === "citation"
                  ? `BibTeX key from ${symbol.file}:${symbol.line}`
                  : `LaTeX label from ${symbol.file}:${symbol.line}`,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: referenceContext.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              sortText: symbol.kind === "label" ? `0-${symbol.key}` : `1-${symbol.key}`,
            }));
          return { suggestions };
        }

        const fileContext = latexFileCompletionContext(linePrefix);
        if (!fileContext) {
          return { suggestions: [] };
        }
        const tokenLower = fileContext.token.toLowerCase();
        const suggestions = allProjectFiles
          .filter((file) => latexFileMatchesContext(file, fileContext))
          .filter((file) => !tokenLower || file.toLowerCase().includes(tokenLower))
          .slice(0, 100)
          .map((file, index) => ({
            label: file,
            kind: monacoApi.languages.CompletionItemKind.File,
            insertText: latexFileCompletionInsertText(file, fileContext.command),
            detail: latexFileCompletionDetail(fileContext.kind),
            documentation: `Project file: ${file}`,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: fileContext.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
            sortText: `${String(index).padStart(3, "0")}-${file}`,
          }));
        return { suggestions };
      },
    });

    const snippetDisposable = monacoApi.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\", "b", "s", "e", "f", "t"],
      provideCompletionItems: (model, position) => {
        const linePrefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        if (latexReferenceCompletionContext(linePrefix) || latexFileCompletionContext(linePrefix)) {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const startColumn =
          word.startColumn > 1 && linePrefix[word.startColumn - 2] === "\\"
            ? word.startColumn - 1
            : word.startColumn;
        const range = {
          startLineNumber: position.lineNumber,
          startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };
        const suggestions = latexSnippetSuggestions(monacoApi).map((snippet) => ({
          label: snippet.label,
          kind: monacoApi.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules:
            monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snippet.detail,
          documentation: snippet.documentation,
          range,
          sortText: snippet.sortText,
        }));
        return { suggestions };
      },
    });

    const hoverDisposable = monacoApi.languages.registerHoverProvider("latex", {
      provideHover: (model, position) => {
        const reference = latexReferenceAtPosition(model, position);
        if (!reference) {
          const fileReference = latexFileReferenceAtPosition(model, position, allProjectFiles);
          if (!fileReference) return null;
          return {
            range: fileReference.range,
            contents: [
              { value: `**项目文件** \`${fileReference.path}\`` },
              {
                value: fileReference.resolvedPath
                  ? `将打开 \`${fileReference.resolvedPath}\``
                  : "未在当前项目中找到匹配文件。",
              },
              { value: "按住 Cmd/Ctrl 点击可打开这个项目文件。" },
            ],
          };
        }

        const symbol = projectSymbols.find(
          (candidate) => candidate.kind === reference.kind && candidate.key === reference.key,
        );
        const kindLabel = reference.kind === "citation" ? "citation" : "label";
        if (!symbol) {
          return {
            range: reference.range,
            contents: [
              { value: `未找到 ${kindLabel} \`${reference.key}\`` },
              { value: "检查拼写，或在左侧“引用与标签”面板确认可用条目。" },
            ],
          };
        }

        return {
          range: reference.range,
          contents: [
            { value: `**${kindLabel}** \`${reference.key}\`` },
            {
              value:
                reference.kind === "citation"
                  ? `${symbol.detail ?? "BibTeX"} · \`${symbol.file}:${symbol.line}\``
                  : `label · \`${symbol.file}:${symbol.line}\``,
            },
            {
              value:
                reference.kind === "citation"
                  ? "按住 Cmd/Ctrl 点击可跳到 BibTeX 条目，也可在左侧“引用与标签”面板打开或复制。"
                  : "按住 Cmd/Ctrl 点击可跳到 label 定义，也可在左侧“引用与标签”面板打开。",
            },
          ],
        };
      },
    });

    return () => {
      symbolDisposable.dispose();
      snippetDisposable.dispose();
      hoverDisposable.dispose();
    };
  }, [allProjectFiles, isEditorReady, projectSymbols]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!isEditorReady || !editor || activeAsset) return;

    const mouseDisposable = editor.onMouseDown((event) => {
      const browserEvent = event.event.browserEvent;
      if (!browserEvent.metaKey && !browserEvent.ctrlKey) return;

      const model = editor.getModel();
      const position = event.target.position;
      if (!model || !position) return;

      const reference = latexReferenceAtPosition(model, position);
      if (!reference) {
        const fileReference = latexFileReferenceAtPosition(model, position, allProjectFiles);
        if (!fileReference) return;
        event.event.preventDefault();
        event.event.stopPropagation();
        if (!fileReference.resolvedPath) {
          setStatus(`未找到项目文件：${fileReference.path}`);
          return;
        }
        void openProjectPathFromEditor(fileReference.resolvedPath).catch((error) => setStatus(errorMessage(error)));
        return;
      }

      const symbol = projectSymbols.find(
        (candidate) => candidate.kind === reference.kind && candidate.key === reference.key,
      );
      if (!symbol) {
        setStatus(`未找到 ${reference.kind === "citation" ? "citation" : "label"}：${reference.key}`);
        return;
      }

      event.event.preventDefault();
      event.event.stopPropagation();
      void openSymbolFromReferenceRef.current(symbol).catch((error) => setStatus(errorMessage(error)));
    });

    return () => mouseDisposable.dispose();
  }, [activeAsset, allProjectFiles, isEditorReady, projectSymbols]);

  const activeLanguage = useMemo(() => languageForPath(activePath), [activePath]);
  const activeEditorModelPath = useMemo(() => {
    if (project?.root && activePath) {
      return `${project.root.replace(/\/+$/, "")}/${activePath}`;
    }
    return activePath || "main.tex";
  }, [activePath, project?.root]);
  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath), [tabs, activePath]);
  const pendingCloseTab = useMemo(
    () => tabs.find((tab) => tab.path === pendingCloseTabPath) ?? null,
    [tabs, pendingCloseTabPath],
  );
  const activeDisplayPath = activeAsset?.path ?? activePath;
  const visibleOutlineItems = useMemo(
    () => filterOutlineItems(outline, outlineQuery).slice(0, 120),
    [outline, outlineQuery],
  );
  const visibleStructureDocuments = useMemo(
    () => projectDocumentFiles.slice(0, MAX_PROJECT_STRUCTURE_DOCUMENTS),
    [projectDocumentFiles],
  );
  const visibleStructureDependencies = useMemo(
    () => projectDependencies.slice(0, MAX_PROJECT_STRUCTURE_DEPENDENCIES),
    [projectDependencies],
  );
  const activeOutlineItem = useMemo(
    () => activeOutlineItemForCursor(outline, activePath, editorCursorPosition.line),
    [outline, activePath, editorCursorPosition.line],
  );
  const visibleProjectSymbols = useMemo(
    () => filterProjectSymbols(projectSymbols, symbolQuery).slice(0, 80),
    [projectSymbols, symbolQuery],
  );
  const visibleReferenceIssues = useMemo(
    () => projectReferenceIssues.slice(0, MAX_CODEX_REFERENCE_ISSUES),
    [projectReferenceIssues],
  );
  const pendingProjectTodos = useMemo(
    () => projectTodos.filter((item) => !item.resolved),
    [projectTodos],
  );
  const resolvedProjectTodos = useMemo(
    () => projectTodos.filter((item) => item.resolved),
    [projectTodos],
  );
  const visibleProjectTodos = useMemo(
    () => (showResolvedTodos ? resolvedProjectTodos : pendingProjectTodos).slice(0, MAX_CODEX_TODOS),
    [pendingProjectTodos, resolvedProjectTodos, showResolvedTodos],
  );
  const projectSearchGroups = useMemo(
    () => groupSearchResultsByFile(searchResults),
    [searchResults],
  );
  const dirtyTabCount = tabs.filter((tab) => tab.dirty).length;
  const renameDraftHasDirtyTabs = renameEntryDraft
    ? tabs.some(
        (tab) =>
          (tab.path === renameEntryDraft.fromPath || tab.path.startsWith(`${renameEntryDraft.fromPath}/`)) &&
          tab.dirty,
      )
    : false;
  const deleteDraftHasDirtyTabs = deleteEntryDraft
    ? tabs.some(
        (tab) =>
          (tab.path === deleteEntryDraft.path || tab.path.startsWith(`${deleteEntryDraft.path}/`)) && tab.dirty,
      )
    : false;
  const texFiles = useMemo(() => collectProjectFiles(files).filter((file) => file.endsWith(".tex")), [files]);
  const codexDiffContextHint = useMemo(
    () =>
      diffSummary?.changedFiles.length
        ? `当前 diff：${diffSummary.changedFiles.length} 个文件，${Math.min(diffSummary.unifiedDiff.length, MAX_CODEX_DIFF_CONTEXT).toLocaleString("zh-CN")}/${diffSummary.unifiedDiff.length.toLocaleString("zh-CN")} 字符可作为 Codex 上下文`
        : "",
    [diffSummary],
  );
  const codexMentionQuery = useMemo(
    () => codexMentionQueryAtCursor(codexPrompt, codexPromptCursor),
    [codexPrompt, codexPromptCursor],
  );
  const codexMentionSuggestions = useMemo(
    () =>
      project && isCodexPromptFocused && codexMentionQuery
        ? codexMentionSuggestionsForQuery(codexMentionQuery, allProjectFiles, projectSymbols)
        : [],
    [allProjectFiles, codexMentionQuery, isCodexPromptFocused, project, projectSymbols],
  );
  const activeCodexMentionSuggestion =
    codexMentionSuggestions[Math.min(codexMentionIndex, codexMentionSuggestions.length - 1)] ??
    codexMentionSuggestions[0];
  useEffect(() => {
    setCodexMentionIndex(0);
  }, [codexMentionQuery?.trigger, codexMentionQuery?.query]);
  useEffect(() => {
    if (codexMentionSuggestions.length && codexMentionIndex >= codexMentionSuggestions.length) {
      setCodexMentionIndex(0);
    }
  }, [codexMentionIndex, codexMentionSuggestions.length]);
  const selectedEngine = draftSettings?.engine ?? projectSettings?.engine ?? "xelatex";
  const selectedEngineStatus = environment ? engineStatus(environment, selectedEngine) : undefined;
  const pdfPath = compileResult?.success ? compileResult.pdfPath : undefined;
  const showEditor = viewMode !== "preview";
  const showPreview = viewMode !== "editor";
  const compileFailed = Boolean(compileResult && !compileResult.success);
  const canSubmitCodexPrompt = Boolean(
    project && codexPrompt.trim() && !isCodexRunning && environment?.canRunCodex !== false,
  );
  const codexContextTitleHint = pinnedCodexContext
    ? `已锁定 · ${formatCodexContextHint(pinnedCodexContext)}`
    : editorContextHint;
  const hasCodexVisibleContext = Boolean(
    pinnedCodexContext ||
      codexPromptReferencedFiles.length ||
      codexPromptReferencedSymbols.length ||
      (isCodexDiffContextEnabled && canUseCodexDiffContext) ||
      (isCodexContextOnlyEnabled && canUseCodexContextScope),
  );
  const codexPreflightItems = useMemo(() => {
    if (!project || !codexPrompt.trim()) return [];
    const items: Array<{ key: string; label: string; detail: string; tone?: "scope" | "safe" | "warn" }> = [
      { key: "project", label: "项目", detail: project.name || shortFileName(project.root) },
    ];
    if (pinnedCodexContext) {
      items.push({
        key: "pinned",
        label: codexContextKindLabel(pinnedCodexContext, true),
        detail: `${shortFileName(pinnedCodexContext.file)}:${pinnedCodexContext.cursorLine}`,
        tone: "safe",
      });
    } else if (!activeAsset && activePath) {
      items.push({ key: "active", label: "当前文件", detail: shortFileName(activePath), tone: "safe" });
    }
    if (codexPromptReferencedFiles.length) {
      items.push({
        key: "files",
        label: `@文件 ${codexPromptReferencedFiles.length}`,
        detail: codexPromptReferencedFiles.slice(0, 2).map(shortFileName).join("、"),
        tone: "safe",
      });
    }
    if (codexPromptReferencedSymbols.length) {
      items.push({
        key: "symbols",
        label: `#符号 ${codexPromptReferencedSymbols.length}`,
        detail: codexPromptReferencedSymbols.slice(0, 2).map((symbol) => symbol.key).join("、"),
        tone: "safe",
      });
    }
    if (isCodexDiffContextEnabled && canUseCodexDiffContext) {
      items.push({ key: "diff", label: "带 diff", detail: `${diffSummary?.changedFiles.length ?? 0} 文件`, tone: "warn" });
    }
    items.push(
      isCodexContextOnlyEnabled && canUseCodexContextScope
        ? { key: "scope", label: "允许修改", detail: `${codexEditableScopeFiles.length} 个上下文文件`, tone: "scope" }
        : { key: "scope", label: "允许修改", detail: "当前项目内", tone: "warn" },
    );
    return items;
  }, [
    activeAsset,
    activePath,
    canUseCodexContextScope,
    canUseCodexDiffContext,
    codexEditableScopeFiles.length,
    codexPrompt,
    codexPromptReferencedFiles,
    codexPromptReferencedSymbols,
    diffSummary?.changedFiles.length,
    isCodexContextOnlyEnabled,
    isCodexDiffContextEnabled,
    pinnedCodexContext,
    project,
  ]);
  const shouldShowCodexPreflight = Boolean(project && codexPrompt.trim() && !isCodexRunning);
  const hasSuccessfulPdf = Boolean(compileResult?.success);
  const isExistingPdfPreview = Boolean(compileResult?.success && !compileResult.command.length);
  const isPdfPossiblyStale = hasSuccessfulPdf && sourceRevision > compiledSourceRevision;
  const pdfFreshnessLabel = isPdfPossiblyStale
    ? "PDF 可能过期"
    : lastSuccessfulCompileAt
      ? `更新于 ${formatCompileTime(lastSuccessfulCompileAt)}`
      : isExistingPdfPreview
        ? "已加载已有 PDF"
        : "PDF 已更新";
  const previewSubtitle = isCompiling
    ? "正在编译"
    : compileFailed
      ? "编译失败"
      : compileResult?.success
        ? pdfFreshnessLabel
        : "等待编译";
  const editorCompileStatus = isCompiling
    ? "编译中"
    : compileFailed
      ? `编译错误 ${compileResult?.diagnostics.length ?? 0}`
      : compileResult?.success
        ? pdfFreshnessLabel
        : "尚未编译";
  const activeOutlineStatus = activeOutlineItem
    ? `${outlineKindLabel(activeOutlineItem.kind)} · ${activeOutlineItem.title || "(空标题)"}`
    : "";
  const selectedProjectTemplate =
    PROJECT_TEMPLATES.find((template) => template.value === newProjectTemplate) ?? PROJECT_TEMPLATES[0];
  const workspaceClassName = [
    "workspace",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isPreviewCollapsed ? "preview-collapsed" : "",
    isReviewMode ? "workspace-review" : "",
    `workspace-${viewMode}`,
  ]
    .filter(Boolean)
    .join(" ");
  const workspaceStyle = {
    "--sidebar-width": `${isSidebarCollapsed ? 48 : sidebarWidth}px`,
    "--preview-width": `${isPreviewCollapsed ? 48 : previewWidth}px`,
  } as CSSProperties;

  async function runSafely(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function currentProjectSignaturePaths(extraPaths: string[] = []) {
    return uniqueTextPaths([...allProjectFiles, ...tabs.map((tab) => tab.path), ...extraPaths]);
  }

  async function rememberCurrentProjectSaveSignature(root = project?.root, paths = currentProjectSignaturePaths()) {
    if (!root) return;
    const signature = await computeProjectTextSaveSignature(root, paths);
    lastSavedHistorySignatureRef.current = { root, signature };
    saveProjectSaveHistorySignature(root, signature);
  }

  async function recordSavedProjectHistory(label: string, extraPaths: string[] = []) {
    if (!project) return false;
    if (!isVersionedSaveHistoryLabel(label)) {
      return false;
    }
    const paths = currentProjectSignaturePaths(extraPaths);
    const signature = await computeProjectTextSaveSignature(project.root, paths);
    const previousSignature =
      lastSavedHistorySignatureRef.current.root === project.root
        ? lastSavedHistorySignatureRef.current.signature
        : loadProjectSaveHistorySignature(project.root);
    if (signature === previousSignature) {
      return false;
    }
    await createProjectHistorySnapshot(project.root, label);
    lastSavedHistorySignatureRef.current = { root: project.root, signature };
    saveProjectSaveHistorySignature(project.root, signature);
    await refreshProjectHistory(project.root);
    return true;
  }

  async function saveOpenTabsWithHistory(
    label: string,
    options: { forceActive?: boolean; verifyActive?: boolean } = {},
    extraPaths: string[] = [],
  ) {
    const savedCount = await saveAllOpenTabs(options);
    const recordedHistory = await recordSavedProjectHistory(label, extraPaths);
    return { savedCount, recordedHistory };
  }

  async function refreshProjectFiles(root = project?.root, mainFile = project?.mainFile) {
    if (!root) return null;
    const [
      nextFiles,
      nextOutline,
      nextOverview,
      nextPreambleContext,
      nextDocumentFiles,
      nextDependencies,
      nextSymbols,
      nextTodos,
      nextReferenceIssues,
    ] = await Promise.all([
      listProjectFiles(root),
      listProjectOutline(root),
      listProjectOverview(root),
      readProjectPreambleContext(root, mainFile),
      listProjectDocumentFiles(root),
      listProjectDependencies(root),
      listProjectSymbols(root),
      listProjectTodos(root),
      listProjectReferenceIssues(root),
    ]);
    const nextLocalStyleContexts = await readProjectLocalStyleContexts(root, nextDependencies);
    const nextMacroSummaries = await readProjectMacroSummaries(
      root,
      nextDocumentFiles,
      nextLocalStyleContexts,
    );
    setFiles(nextFiles);
    setOutline(nextOutline);
    setProjectOverview(nextOverview);
    setProjectPreambleContext(nextPreambleContext);
    setProjectLocalStyleContexts(nextLocalStyleContexts);
    setProjectMacroSummaries(nextMacroSummaries);
    setProjectDocumentFiles(nextDocumentFiles);
    setProjectDependencies(nextDependencies);
    setProjectSymbols(nextSymbols);
    setProjectTodos(nextTodos);
    setProjectReferenceIssues(nextReferenceIssues);
    return {
      files: nextFiles,
      outline: nextOutline,
      overview: nextOverview,
      preambleContext: nextPreambleContext,
      localStyleContexts: nextLocalStyleContexts,
      macroSummaries: nextMacroSummaries,
      documentFiles: nextDocumentFiles,
      dependencies: nextDependencies,
      symbols: nextSymbols,
      todos: nextTodos,
      referenceIssues: nextReferenceIssues,
    };
  }

  async function readProjectPreambleContext(root: string, mainFile?: string) {
    if (!mainFile || !isTextPath(mainFile)) return "";
    try {
      const mainContent = await readFile(root, mainFile);
      return extractLatexPreambleContext(mainFile, mainContent);
    } catch {
      return "";
    }
  }

  async function readProjectLocalStyleContexts(root: string, dependencies: ProjectDependency[]) {
    const stylePaths = uniqueTextPaths(
      dependencies
        .map((dependency) => dependency.resolvedPath ?? "")
        .filter(isCodexLocalStyleContextPath),
    ).slice(0, MAX_CODEX_LOCAL_STYLE_CONTEXT_FILES);
    const contexts: CodexReferencedFileContext[] = [];
    for (const path of stylePaths) {
      try {
        const content = await readFile(root, path);
        const truncated = content.length > MAX_CODEX_LOCAL_STYLE_CONTEXT;
        contexts.push({
          path,
          content: truncated ? content.slice(0, MAX_CODEX_LOCAL_STYLE_CONTEXT) : content,
          originalLength: content.length,
          truncated,
        });
      } catch {
        // Stale dependency entries are ignored; backend path confinement still applies to reads.
      }
    }
    return contexts;
  }

  async function readProjectMacroSummaries(
    root: string,
    documentFiles: string[],
    localStyleContexts: CodexReferencedFileContext[],
  ) {
    const macroByKey = new Map<string, CodexLatexMacroSummary>();
    const sourcePaths = uniqueTextPaths(documentFiles.filter(isTextPath)).slice(0, MAX_CODEX_MACRO_SOURCE_FILES);
    for (const path of sourcePaths) {
      try {
        for (const macro of parseLatexMacroSummaries(path, await readFile(root, path))) {
          const key = `${macro.path}:${macro.line}:${macro.name}:${macro.command}`;
          if (!macroByKey.has(key)) macroByKey.set(key, macro);
          if (macroByKey.size >= MAX_CODEX_MACRO_SUMMARIES) return [...macroByKey.values()];
        }
      } catch {
        // Stale document order entries should not block Codex context construction.
      }
    }
    for (const styleContext of localStyleContexts) {
      for (const macro of parseLatexMacroSummaries(styleContext.path, styleContext.content)) {
        const key = `${macro.path}:${macro.line}:${macro.name}:${macro.command}`;
        if (!macroByKey.has(key)) macroByKey.set(key, macro);
        if (macroByKey.size >= MAX_CODEX_MACRO_SUMMARIES) return [...macroByKey.values()];
      }
    }
    return [...macroByKey.values()];
  }

  async function refreshRecentProjects() {
    setRecentProjects(await listRecentProjects());
  }

  async function refreshCodexHistory(root = project?.root) {
    if (!root) {
      setCodexHistory([]);
      return;
    }
    setCodexHistory(await listCodexHistory(root));
  }

  async function refreshProjectHistory(root = project?.root) {
    if (!root) {
      setProjectHistory([]);
      return;
    }
    setProjectHistory(await listProjectHistory(root));
  }

  async function openTextFile(
    path: string,
    options: { line?: number; column?: number | null; forceReload?: boolean } = {},
  ) {
    if (!project || !isTextPath(path)) return;
    setActiveAsset(null);
    const existing = tabs.find((tab) => tab.path === path);
    if (existing && !options.forceReload) {
      setActivePath(path);
      setContent(existing.content);
      rememberRecentFile(path);
      setPendingLine(options.line ?? null);
      setPendingColumn(options.column ?? null);
      return;
    }
    const fileContent = await readFile(project.root, path);
    setTabs((current) => {
      const nextTab = { path, content: fileContent, dirty: false };
      if (current.some((tab) => tab.path === path)) {
        return current.map((tab) => (tab.path === path ? nextTab : tab));
      }
      return [...current, nextTab];
    });
    setActivePath(path);
    setContent(fileContent);
    rememberRecentFile(path);
    setPendingLine(options.line ?? null);
    setPendingColumn(options.column ?? null);
  }

  function switchToTab(tab: EditorTab) {
    setActiveAsset(null);
    setActivePath(tab.path);
    setContent(tab.content);
    rememberRecentFile(tab.path);
    setPendingLine(null);
    setPendingColumn(null);
    window.requestAnimationFrame(layoutEditorToPanel);
  }

  async function closeTab(path: string, options: { discardDirty?: boolean } = {}) {
    const tab = tabs.find((candidate) => candidate.path === path);
    if (!tab) return;
    const latestContent = path === activePath ? editorRef.current?.getValue() ?? content : tab.content;
    const isDirty = tab.dirty || latestContent !== tab.content;
    if (isDirty && !options.discardDirty) {
      setPendingCloseTabPath(path);
      setStatus(`${path} 还没有保存，请选择保存或不保存关闭。`);
      return;
    }
    setPendingCloseTabPath((current) => (current === path ? null : current));
    const nextTabs = tabs.filter((candidate) => candidate.path !== path);
    setTabs(nextTabs);
    if (activePath !== path) return;
    const fallback = nextTabs[nextTabs.length - 1];
    if (fallback) {
      switchToTab(fallback);
    } else if (project) {
      await openTextFile(project.mainFile, { forceReload: true });
    } else {
      setActivePath("");
      setContent("");
    }
  }

  async function handleSaveAndCloseTab(path: string) {
    if (!project) return;
    const tab = tabs.find((candidate) => candidate.path === path);
    if (!tab) return;
    const latestContent = path === activePath ? editorRef.current?.getValue() ?? content : tab.content;
    await saveFile(project.root, path, latestContent);
    await recordSavedProjectHistory("手动保存", [path]);
    setPendingCloseTabPath(null);
    await refreshProjectFiles();
    setTabs((current) =>
      current.map((candidate) =>
        candidate.path === path ? { ...candidate, content: latestContent, dirty: false } : candidate,
      ),
    );
    await closeTab(path, { discardDirty: true });
    setStatus(`${path} 已保存并关闭。`);
  }

  async function closeActiveTab() {
    if (activeAsset) {
      setActiveAsset(null);
      return;
    }
    if (activePath) {
      await closeTab(activePath);
    }
  }

  function switchTabByOffset(offset: number) {
    if (!tabs.length) return;
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.path === activePath));
    const nextIndex = (activeIndex + offset + tabs.length) % tabs.length;
    switchToTab(tabs[nextIndex]);
  }

  async function saveAllOpenTabs(options: { forceActive?: boolean; verifyActive?: boolean } = {}) {
    if (!project) return 0;
    const shouldFlushActiveEditor = Boolean(!activeAsset && activePath && isTextPath(activePath));
    const latestActiveContent = shouldFlushActiveEditor ? editorRef.current?.getValue() ?? content : content;
    const modelContents = collectCurrentProjectModelContents(project.root, editorRef.current, monacoRef.current);
    if (shouldFlushActiveEditor && activePath && !modelContents.has(activePath)) {
      modelContents.set(activePath, latestActiveContent);
    }
    const snapshotByPath = new Map(tabs.map((tab) => [tab.path, tab]));
    for (const [modelPath, modelContent] of modelContents) {
      const existing = snapshotByPath.get(modelPath);
      snapshotByPath.set(modelPath, {
        path: modelPath,
        content: modelContent,
        dirty: Boolean(
          existing?.dirty ||
            !existing ||
            existing.content !== modelContent ||
            (options.forceActive && modelPath === activePath),
        ),
      });
    }
    if (shouldFlushActiveEditor && activePath && !snapshotByPath.has(activePath)) {
      const existing = snapshotByPath.get(activePath);
      snapshotByPath.set(activePath, {
        path: activePath,
        content: latestActiveContent,
        dirty: Boolean(options.forceActive || !existing || existing.dirty || existing.content !== latestActiveContent),
      });
    }
    const snapshot = [...snapshotByPath.values()];
    const dirtySnapshot = snapshot.filter((tab) => tab.dirty);
    const savedByPath = new Map<string, string>();
    for (const tab of dirtySnapshot) {
      await saveFile(project.root, tab.path, tab.content);
      savedByPath.set(tab.path, tab.content);
    }
    if (options.verifyActive) {
      const verifyPaths = new Set<string>(activePath ? [activePath] : []);
      for (const path of modelContents.keys()) {
        verifyPaths.add(path);
      }
      for (const path of verifyPaths) {
        if (!savedByPath.has(path)) continue;
        const diskContent = await readFile(project.root, path);
        const expectedContent = savedByPath.get(path) ?? "";
        if (diskContent !== expectedContent) {
          throw new Error(`${path} 保存后读回内容不一致，已停止编译以避免使用旧源码。`);
        }
      }
    }
    const latestContentAfterSave = shouldFlushActiveEditor ? editorRef.current?.getValue() ?? latestActiveContent : latestActiveContent;
    setTabs((current) => {
      const updated = current.map((tab) => {
        const nextContent = tab.path === activePath && shouldFlushActiveEditor ? latestContentAfterSave : tab.content;
        if (!savedByPath.has(tab.path)) {
          return tab.path === activePath && shouldFlushActiveEditor ? { ...tab, content: nextContent } : tab;
        }
        return { ...tab, content: nextContent, dirty: nextContent !== savedByPath.get(tab.path) };
      });
      if (activePath && shouldFlushActiveEditor && !updated.some((tab) => tab.path === activePath)) {
        updated.push({
          path: activePath,
          content: latestContentAfterSave,
          dirty: !savedByPath.has(activePath),
        });
      }
      return updated;
    });
    if (shouldFlushActiveEditor) {
      setContent(latestContentAfterSave);
    }
    await refreshProjectFiles();
    return dirtySnapshot.length;
  }

  async function reloadOpenTabsFromDisk() {
    if (!project) return;
    const nextTabs: EditorTab[] = [];
    for (const tab of tabs) {
      try {
        nextTabs.push({
          path: tab.path,
          content: await readFile(project.root, tab.path),
          dirty: false,
        });
      } catch {
        // File may have been removed by Codex or a filesystem operation.
      }
    }
    setTabs(nextTabs);
    const active = nextTabs.find((tab) => tab.path === activePath) ?? nextTabs[0];
    if (active) {
      setActivePath(active.path);
      setContent(active.content);
    } else if (project) {
      await openTextFile(project.mainFile, { forceReload: true });
    }
  }

  function existingPdfCompileResult(existingPdfPath: string): CompileResult {
    return {
      success: true,
      pdfPath: existingPdfPath,
      log: "已加载上次编译生成的 PDF。",
      diagnostics: [],
      command: [],
    };
  }

  function applyExistingPdfPreview(existingPdfPath: string | null, resetRevision = false) {
    lastCompileFailedRef.current = false;
    setCompileResult(existingPdfPath ? existingPdfCompileResult(existingPdfPath) : null);
    setPdfRevision((value) => (resetRevision ? (existingPdfPath ? 1 : 0) : value + 1));
    setCompiledSourceRevision(sourceRevisionRef.current);
    setLastSuccessfulCompileAt(null);
  }

  async function refreshExistingPdfPreview(projectRoot: string) {
    const existingPdfPath = await getExistingPdfOutput(projectRoot);
    applyExistingPdfPreview(existingPdfPath);
    return existingPdfPath;
  }

  async function activateProject(nextProject: ProjectSummary, message: string) {
    compileRequestSerialRef.current += 1;
    lastCompileFailedRef.current = false;
    const [settings, editorSession, existingPdfPath] = await Promise.all([
      getProjectSettings(nextProject.root),
      restoreEditorSessionTabs(nextProject.root, nextProject.mainFile),
      getExistingPdfOutput(nextProject.root),
    ]);
    setProject(nextProject);
    setProjectSettings(settings);
    setDraftSettings(settings);
    setProjectNameDraft(settings.displayName ?? nextProject.name);
    setProjectPath(nextProject.root);
    setTabs(editorSession.tabs);
    setActivePath(editorSession.activeTab.path);
    setRecentFilePaths(
      uniqueTextPaths([
        editorSession.activeTab.path,
        ...(editorSession.recentPaths ?? []),
        ...editorSession.tabs.map((tab) => tab.path),
      ]).slice(0, MAX_RECENT_EDITOR_FILES),
    );
    setActiveAsset(null);
    setContent(editorSession.activeTab.content);
    setOutline([]);
    setProjectOverview(null);
    setProjectPreambleContext("");
    setProjectLocalStyleContexts([]);
    setProjectMacroSummaries([]);
    setProjectDocumentFiles([]);
    setProjectDependencies([]);
    setProjectSymbols([]);
    setProjectTodos([]);
    setProjectReferenceIssues([]);
    sourceRevisionRef.current = 0;
    setSourceRevision(0);
    setCompiledSourceRevision(0);
    setLastSuccessfulCompileAt(null);
    applyExistingPdfPreview(existingPdfPath, true);
    setAutoSaveState("idle");
    setCodexEvents([]);
    setCodexAnswer("");
    setCodexConversationPrompt("");
    setPinnedCodexContext(null);
    setCodexHistory([]);
    setProjectHistory([]);
    setHistoryDiffSummary(null);
    setHistoryDiffItem(null);
    setHistoryRestoreItem(null);
    setDiffSummary(null);
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    setPendingCloseTabPath(null);
    setSearchQuery("");
    setReplaceText("");
    setSearchResults([]);
    setCreateEntryDraft(null);
    setRenameEntryDraft(null);
    setDeleteEntryDraft(null);
    setIsQuickOpenVisible(false);
    setQuickOpenQuery("");
    setQuickOpenIndex(0);
    setOutlineQuery("");
    setSymbolQuery("");
    setIsTodosCollapsed(false);
    setWordCount(null);
    setShowSettingsPanel(false);
    setShowWordCountPanel(false);
    setShowHistoryPanel(false);
    const latestProjectFiles = await refreshProjectFiles(nextProject.root, nextProject.mainFile);
    await rememberCurrentProjectSaveSignature(
      nextProject.root,
      collectProjectFiles(latestProjectFiles?.files ?? []),
    );
    await refreshCodexHistory(nextProject.root);
    await refreshProjectHistory(nextProject.root);
    await refreshRecentProjects();
    setStatus(existingPdfPath ? `${message} 已加载上次编译的 PDF。` : message);
    setShowProjectPanel(false);
  }

  async function handleCreateProject(input?: string) {
    if (!confirmDiscardUnsavedTabs("新建项目")) return;
    const nextProject = await createProject((input ?? newProjectName).trim(), undefined, newProjectTemplate);
    setNewProjectName("");
    await activateProject(nextProject, "项目已创建。");
  }

  async function handleOpenProject() {
    if (!confirmDiscardUnsavedTabs("打开项目")) return;
    if (!projectPath.trim()) {
      setStatus("请先输入项目文件夹路径。");
      return;
    }
    const nextProject = await openProject(projectPath.trim());
    await activateProject(nextProject, "项目已打开。");
  }

  async function handleChooseProjectFolder() {
    if (!confirmDiscardUnsavedTabs("打开项目")) return;
    const selected = await chooseProjectFolder();
    if (!selected) return;
    setProjectPath(selected);
    const nextProject = await openProject(selected);
    await activateProject(nextProject, "项目已打开。");
  }

  async function handleImportProjectZip() {
    if (!confirmDiscardUnsavedTabs("导入 ZIP 项目")) return;
    const selected = await chooseProjectZip();
    if (!selected) return;
    setStatus("正在导入 ZIP 项目...");
    const nextProject = await importProjectZip(selected);
    await activateProject(nextProject, "ZIP 项目已导入。");
  }

  async function handleOpenRecentProject(recent: RecentProject) {
    if (!confirmDiscardUnsavedTabs("切换项目")) return;
    const nextProject = await openProject(recent.root);
    await activateProject(nextProject, "项目已打开。");
  }

  async function handleSaveProjectSettings() {
    if (!project || !draftSettings) return;
    await saveOpenTabsWithHistory("设置前保存");
    const normalizedShortcuts = normalizeShortcutMap(shortcutDrafts);
    const previousMainFile = project.mainFile;
    const previousBuildDir = projectSettings?.buildDir;
    const summary = await updateProjectSettings(project.root, draftSettings);
    const settings = await getProjectSettings(summary.root);
    setProject(summary);
    setProjectSettings(settings);
    setDraftSettings(settings);
    setProjectNameDraft(settings.displayName ?? summary.name);
    setShortcuts(normalizedShortcuts);
    setShortcutDrafts(normalizedShortcuts);
    saveShortcutPreferences(normalizedShortcuts);
    await refreshRecentProjects();
    if (summary.mainFile !== previousMainFile && isTextPath(summary.mainFile)) {
      await openTextFile(summary.mainFile, { forceReload: true });
    }
    setShowSettingsPanel(false);
    if (summary.mainFile !== previousMainFile || settings.buildDir !== previousBuildDir) {
      const existingPdfPath = await refreshExistingPdfPreview(summary.root);
      setStatus(
        existingPdfPath
          ? "项目设置已保存，并已刷新已有 PDF 预览。"
          : "项目设置已保存。当前主文件还没有可预览的已有 PDF。",
      );
    } else {
      setStatus("项目设置已保存。");
    }
  }

  async function handleSaveProjectDisplayName() {
    if (!project || !projectSettings) return;
    const nextSettings = {
      ...projectSettings,
      displayName: projectNameDraft.trim() || null,
    };
    const summary = await updateProjectSettings(project.root, nextSettings);
    const settings = await getProjectSettings(summary.root);
    setProject(summary);
    setProjectSettings(settings);
    setDraftSettings(settings);
    setProjectNameDraft(settings.displayName ?? summary.name);
    await refreshRecentProjects();
    setStatus("项目名称已更新。");
  }

  function handleResetShortcuts() {
    setShortcutDrafts(DEFAULT_SHORTCUTS);
    setStatus("已恢复默认快捷键，保存设置后生效。");
  }

  async function handleSetMainFile(node: FileNode) {
    if (!project || !projectSettings || node.kind !== "file" || !node.path.toLowerCase().endsWith(".tex")) return;
    await saveOpenTabsWithHistory("切换主文件前保存");
    const nextSettings = { ...projectSettings, mainFile: node.path };
    const summary = await updateProjectSettings(project.root, nextSettings);
    const settings = await getProjectSettings(summary.root);
    setProject(summary);
    setProjectSettings(settings);
    setDraftSettings(settings);
    const existingPdfPath = await refreshExistingPdfPreview(summary.root);
    await refreshRecentProjects();
    setStatus(
      existingPdfPath
        ? `已将 ${node.path} 设为主文件，并已刷新 PDF 预览。`
        : `已将 ${node.path} 设为主文件。当前主文件还没有可预览的已有 PDF。`,
    );
  }

  async function handleFileSelect(node: FileNode) {
    if (!project || node.kind !== "file") return;
    if (isTextPath(node.path)) {
      await openTextFile(node.path);
      return;
    }
    const asset = await readProjectAssetFile(project.root, node.path);
    setActiveAsset(asset);
    setPendingLine(null);
    setPendingColumn(null);
    setStatus(`已打开资源预览：${node.path}`);
  }

  async function openProjectPathFromEditor(path: string) {
    if (!project) return;
    if (isTextPath(path)) {
      await openTextFile(path);
      return;
    }
    if (isPreviewableAssetPath(path)) {
      const asset = await readProjectAssetFile(project.root, path);
      setActiveAsset(asset);
      setPendingLine(null);
      setPendingColumn(null);
      setStatus(`已打开资源预览：${path}`);
      return;
    }
    setStatus(`${path} 不是可编辑或可预览的项目文件。`);
  }

  async function handleProjectDependencyClick(dependency: ProjectDependency) {
    if (!project) return;
    if (dependency.resolvedPath) {
      await openProjectPathFromEditor(dependency.resolvedPath);
      setStatus(`已打开 ${dependency.resolvedPath}。`);
      return;
    }
    await openTextFile(dependency.sourceFile, { line: dependency.line });
    setStatus(`未找到 ${dependency.target}，已定位到引用位置。`);
  }

  function handleAddProjectDocumentToCodex(path: string) {
    const order = projectDocumentFiles.indexOf(path) + 1;
    insertCodexPromptContext(
      `上下文：@${path}，文档顺序${order > 0 ? `第 ${order} 个` : "中的"}文件。`,
      `已把 ${shortFileName(path)} 加入 Codex 上下文。`,
    );
  }

  function handleAddProjectDependencyToCodex(dependency: ProjectDependency) {
    const contextPath = dependency.resolvedPath ?? dependency.sourceFile;
    const resolvedHint = dependency.resolvedPath
      ? `解析到 @${dependency.resolvedPath}`
      : `未解析，引用位置 @${dependency.sourceFile}:${dependency.line}`;
    insertCodexPromptContext(
      `上下文：@${contextPath}，文件引用 ${dependency.sourceFile}:${dependency.line} \\${dependency.command}{${dependency.target}}，${resolvedHint}。`,
      `已把 ${shortFileName(contextPath)} 的文件引用上下文加入 Codex。`,
    );
  }

  function openQuickOpen() {
    if (!project) return;
    setQuickOpenQuery(activeDisplayPath ? shortFileName(activeDisplayPath) : "");
    setQuickOpenIndex(0);
    setIsQuickOpenVisible(true);
  }

  function openProjectSearch() {
    if (!project) return;
    setIsSidebarCollapsed(false);
    setIsSearchOpen(true);
  }

  function toggleProjectSearch() {
    if (!project) return;
    setIsSidebarCollapsed(false);
    setIsSearchOpen((value) => !value);
  }

  function runEditorSearchAction(actionId: string, successStatus: string, failureStatus: string) {
    if (!activePath || activeAsset || !editorRef.current) {
      setStatus("当前没有可查找的文本编辑器。");
      return;
    }
    const action = editorRef.current.getAction(actionId);
    if (!action) {
      setStatus(failureStatus);
      return;
    }
    editorRef.current.focus();
    void action.run();
    setStatus(successStatus);
  }

  function handleFindInCurrentFile() {
    runEditorSearchAction("actions.find", "已打开当前文件查找。", "当前编辑器不支持查找。");
  }

  function handleReplaceInCurrentFile() {
    runEditorSearchAction(
      "editor.action.startFindReplaceAction",
      "已打开当前文件替换。",
      "当前编辑器不支持替换。",
    );
  }

  function adjustEditorFontSize(delta: number) {
    const nextValue = clamp(editorFontSize + delta, MIN_EDITOR_FONT_SIZE, MAX_EDITOR_FONT_SIZE);
    setEditorFontSize(nextValue);
    setStatus(`编辑器字号 ${nextValue}px。`);
  }

  editorShortcutActionsRef.current = {
    save: async () => {
      if (project) {
        await handleSaveShortcut();
      }
    },
    compile: async () => {
      if (project && !isCompiling && environment?.canCompile !== false) {
        await handleCompile();
      }
    },
    quickOpen: openQuickOpen,
    projectSearch: openProjectSearch,
    findInFile: handleFindInCurrentFile,
    replaceInFile: handleReplaceInCurrentFile,
    goToLine: handleGoToLine,
    focusCodex: focusCodexPrompt,
    sendCodexContext: handleSendEditorContextToCodex,
    toggleComment: handleToggleLatexComment,
    toggleReviewMode: handleToggleReviewMode,
    insertReviewComment: handleInsertReviewComment,
    syncPdf: async () => {
      if (project && activePath && !activeAsset && compileResult?.success) {
        await handleSyncPdfFromSource();
      }
    },
    insertLatex: (id) => {
      const action = LATEX_INSERT_ACTIONS.find((candidate) => candidate.id === id);
      if (action) {
        handleLatexInsertAction(action);
      }
    },
    closeActiveTab,
    switchTab: switchTabByOffset,
  };

  async function handleQuickOpenPath(path: string) {
    if (!project || !path) return;
    setIsQuickOpenVisible(false);
    setQuickOpenQuery("");
    setQuickOpenIndex(0);
    await handleFileSelect({
      name: shortFileName(path),
      path,
      kind: "file",
    });
  }

  async function handleCreateEntry(kind: "file" | "directory", parentPath = parentDirectory(activeDisplayPath)) {
    if (!project) return;
    setIsSearchOpen(false);
    setRenameEntryDraft(null);
    setDeleteEntryDraft(null);
    setCreateEntryDraft({
      kind,
      parentPath,
      path: suggestedProjectEntryPath(kind, parentPath),
    });
    setStatus(kind === "file" ? "输入新文件路径后按 Enter 创建。" : "输入新文件夹路径后按 Enter 创建。");
  }

  async function handleSubmitCreateEntry(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project || !createEntryDraft) return;
    const nextPath = createEntryDraft.path.trim();
    if (!nextPath) {
      setStatus("请输入要创建的项目内相对路径。");
      return;
    }
    const kind = createEntryDraft.kind;
    const label = kind === "file" ? "文件" : "文件夹";
    await createAutomaticHistorySnapshot(`新建${label} ${nextPath} 前`);
    await createProjectEntry(project.root, nextPath, kind);
    setCreateEntryDraft(null);
    await refreshProjectFiles();
    if (kind === "file" && isTextPath(nextPath)) {
      await openTextFile(nextPath, { forceReload: true });
    }
    setStatus(`${nextPath} 已创建。已保存操作前历史版本。`);
  }

  async function handleImportFiles(parentPath = parentDirectory(activeDisplayPath)) {
    if (!project) return;
    const sourcePaths = await chooseImportFiles();
    if (!sourcePaths.length) return;
    await createAutomaticHistorySnapshot(`导入 ${sourcePaths.length} 个文件前`);
    const imported = await importProjectFiles(project.root, parentPath, sourcePaths);
    await refreshProjectFiles();
    const firstText = imported.find(isTextPath);
    if (firstText) {
      await openTextFile(firstText, { forceReload: true });
    } else {
      const firstAsset = imported.find(isPreviewableAssetPath);
      if (firstAsset) {
        const asset = await readProjectAssetFile(project.root, firstAsset);
        setActiveAsset(asset);
      }
    }
    setStatus(`已导入 ${imported.length} 个文件。已保存操作前历史版本。`);
  }

  async function handleRenameEntry(node?: FileNode) {
    if (!project) return;
    const targetPath = node?.path ?? activeDisplayPath;
    if (!targetPath) return;
    if (renameEntryDraft?.fromPath === targetPath) {
      setRenameEntryDraft(null);
      setStatus("已取消重命名。");
      return;
    }
    setIsSidebarCollapsed(false);
    setIsSearchOpen(false);
    setCreateEntryDraft(null);
    setDeleteEntryDraft(null);
    setRenameEntryDraft({ fromPath: targetPath, path: targetPath });
    setStatus(`输入 ${targetPath} 的新路径后按 Enter 重命名。`);
  }

  async function handleSubmitRenameEntry(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project || !renameEntryDraft) return;
    const targetPath = renameEntryDraft.fromPath;
    const nextPath = renameEntryDraft.path.trim();
    if (!nextPath) {
      setStatus("请输入新的项目内相对路径。");
      return;
    }
    if (nextPath === targetPath) {
      setRenameEntryDraft(null);
      return;
    }
    const nextMainFile = remapActivePathAfterRename(project.mainFile, targetPath, nextPath);
    if (nextMainFile !== project.mainFile && !nextMainFile.toLowerCase().endsWith(".tex")) {
      setStatus("主文件重命名后仍需要是 .tex 文件。");
      return;
    }
    const hasAffectedDirtyTabs = tabs.some(
      (tab) => (tab.path === targetPath || tab.path.startsWith(`${targetPath}/`)) && tab.dirty,
    );
    if (hasAffectedDirtyTabs) {
      await saveAllOpenTabs();
    }
    await createAutomaticHistorySnapshot(`重命名 ${targetPath} 前`);
    const renameResult = await renameProjectEntry(project.root, targetPath, nextPath);
    if (nextMainFile !== project.mainFile && projectSettings) {
      const summary = await updateProjectSettings(project.root, { ...projectSettings, mainFile: nextMainFile });
      const settings = await getProjectSettings(summary.root);
      setProject(summary);
      setProjectSettings(settings);
      setDraftSettings(settings);
      await refreshRecentProjects();
    }
    setRenameEntryDraft(null);
    await refreshProjectFiles();
    const nextActivePath = remapActivePathAfterRename(activePath, targetPath, nextPath);
    const remappedTabs = tabs.map((tab) => ({
      ...tab,
      path: remapActivePathAfterRename(tab.path, targetPath, nextPath),
    }));
    const nextTabs: EditorTab[] = [];
    for (const tab of remappedTabs) {
      try {
        nextTabs.push({
          path: tab.path,
          content: await readFile(project.root, tab.path),
          dirty: false,
        });
      } catch {
        // The renamed or moved entry may remove a stale open tab.
      }
    }
    setTabs(nextTabs);
    const nextActiveTab = nextTabs.find((tab) => tab.path === nextActivePath) ?? nextTabs[0];
    if (nextActiveTab && isTextPath(nextActiveTab.path)) {
      setActivePath(nextActiveTab.path);
      setContent(nextActiveTab.content);
      setPendingLine(null);
      setPendingColumn(null);
    }
    if (activeAsset) {
      const nextAssetPath = remapActivePathAfterRename(activeAsset.path, targetPath, nextPath);
      if (nextAssetPath !== activeAsset.path) {
        if (isPreviewableAssetPath(nextAssetPath)) {
          setActiveAsset(await readProjectAssetFile(project.root, nextAssetPath));
        } else {
          setActiveAsset(null);
        }
      }
    }
    const referenceMessage = renameResult.updatedReferences
      ? `同步更新 ${renameResult.updatedReferenceFiles.length} 个源码文件中的 ${renameResult.updatedReferences} 处 LaTeX 引用。`
      : "未发现需要同步的 LaTeX 引用。";
    setStatus(`${targetPath} 已重命名为 ${nextPath}。${referenceMessage} 已保存操作前历史版本。`);
  }

  async function handleDeleteEntry(node?: FileNode) {
    if (!project) return;
    const targetPath = node?.path ?? activeDisplayPath;
    if (!targetPath) return;
    if (isProjectMainPathAffected(project.mainFile, targetPath)) {
      setStatus("不能删除当前主文件；请先在项目设置或右键菜单中切换主文件。");
      return;
    }
    setIsSearchOpen(false);
    setCreateEntryDraft(null);
    setRenameEntryDraft(null);
    setDeleteEntryDraft({ path: targetPath, usages: [], isCheckingUsages: true });
    setStatus(`正在检查 ${targetPath} 是否仍被 LaTeX 源码引用...`);
    try {
      const usages = await listProjectFileUsages(project.root, targetPath);
      setDeleteEntryDraft((current) =>
        current?.path === targetPath ? { ...current, usages, isCheckingUsages: false } : current,
      );
      setStatus(
        usages.length
          ? `${targetPath} 仍被 ${usages.length} 处 LaTeX 引用使用，删除前请确认。`
          : `确认后将删除 ${targetPath}，并先保存历史版本。`,
      );
    } catch (error) {
      setDeleteEntryDraft((current) =>
        current?.path === targetPath ? { ...current, isCheckingUsages: false } : current,
      );
      setStatus(`无法检查 LaTeX 引用：${errorMessage(error)}。仍可手动确认删除。`);
    }
  }

  async function handleSubmitDeleteEntry(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project || !deleteEntryDraft) return;
    const targetPath = deleteEntryDraft.path;
    if (isProjectMainPathAffected(project.mainFile, targetPath)) {
      setStatus("不能删除当前主文件；请先切换主文件。");
      return;
    }
    await createAutomaticHistorySnapshot(`删除 ${targetPath} 前`);
    await deleteProjectEntry(project.root, targetPath);
    setDeleteEntryDraft(null);
    await refreshProjectFiles();
    const remainingTabs = tabs.filter(
      (tab) => tab.path !== targetPath && !tab.path.startsWith(`${targetPath}/`),
    );
    setTabs(remainingTabs);
    if (activeAsset && (activeAsset.path === targetPath || activeAsset.path.startsWith(`${targetPath}/`))) {
      setActiveAsset(null);
    }
    if (activePath === targetPath || activePath.startsWith(`${targetPath}/`)) {
      const fallback = remainingTabs.find((tab) => tab.path === project.mainFile) ?? remainingTabs[0];
      if (fallback) {
        setActivePath(fallback.path);
        setContent(fallback.content);
      } else {
        await openTextFile(project.mainFile, { forceReload: true });
      }
      setPendingLine(null);
      setPendingColumn(null);
    }
    setStatus(`${targetPath} 已删除。可从历史版本恢复。`);
  }

  async function handleSave() {
    await handleSaveShortcut();
  }

  async function handleSaveShortcut() {
    if (!project) return;
    const { savedCount, recordedHistory } = await saveOpenTabsWithHistory("手动保存");
    if (!savedCount && !recordedHistory) {
      setStatus("没有需要保存的修改。");
      return;
    }
    setAutoSaveState("saved");
    setStatus(
      recordedHistory
        ? !savedCount
          ? "已记录当前保存状态为历史版本。"
          : savedCount === 1
          ? "已保存当前修改，并记录历史版本。"
          : `已保存 ${savedCount} 个文件，并记录历史版本。`
        : savedCount === 1
          ? "已保存当前修改。"
          : `已保存 ${savedCount} 个文件。`,
    );
  }

  async function handleCompile() {
    await compileActiveProject("manual");
  }

  async function handleCompileFromScratch() {
    if (!project) return;
    await saveOpenTabsWithHistory("编译前保存");
    setStatus("正在清理构建缓存并从零编译...");
    await cleanProjectBuild(project.root);
    lastCompileFailedRef.current = false;
    setCompileResult(null);
    setLastSuccessfulCompileAt(null);
    setPdfRevision((value) => value + 1);
    await compileActiveProject("manual");
  }

  async function compileActiveProject(source: "manual" | "auto"): Promise<CompileResult | null> {
    if (!project) return null;
    const compileSerial = compileRequestSerialRef.current + 1;
    compileRequestSerialRef.current = compileSerial;
    const shouldCleanStaleFailure = Boolean(lastCompileFailedRef.current || (compileResult && !compileResult.success));
    await saveOpenTabsWithHistory(source === "auto" ? "自动编译前保存" : "编译前保存", {
      forceActive: true,
      verifyActive: true,
    });
    if (shouldCleanStaleFailure) {
      setStatus("上次编译失败，正在清理构建缓存后重试...");
      await cleanProjectBuild(project.root);
      setLastSuccessfulCompileAt(null);
      setPdfRevision((value) => value + 1);
    }
    setIsCompiling(true);
    clearStaleCompileFailure();
    try {
      const result = await compileProject({ projectRoot: project.root, mainFile: project.mainFile });
      if (compileSerial !== compileRequestSerialRef.current) {
        return result;
      }
      applyCompileResult(result);
      if (result.success) {
        if (source === "manual") {
          if (viewMode === "editor") {
            handleViewModeChange("split");
          }
          setIsPreviewCollapsed(false);
        }
        setStatus(source === "auto" ? "自动编译完成。" : "编译完成，PDF 已刷新。");
      } else if (source === "manual" && (await revealFirstCompileDiagnostic(result))) {
        setStatus(`编译失败，已定位到 ${firstDiagnosticLocation(result, project.root)}。`);
      } else {
        setStatus("编译失败，请查看日志。");
      }
      return result;
    } catch (error) {
      lastCompileFailedRef.current = true;
      throw error;
    } finally {
      if (compileSerial === compileRequestSerialRef.current) {
        setIsCompiling(false);
      }
    }
  }

  async function runAutoSave() {
    const shouldAutoCompile = isAutoCompileEnabled && environment?.canCompile === true && !isCompiling;
    if (!project || !hasUnsavedTabs() || (!isAutoSaveEnabled && !shouldAutoCompile)) return;
    if (isAutoSaveEnabled) {
      setAutoSaveState("saving");
    }
    try {
      const { savedCount } = await saveOpenTabsWithHistory(isAutoSaveEnabled ? "自动保存" : "自动编译前保存");
      if (isAutoSaveEnabled) {
        setAutoSaveState("saved");
      }
      if (savedCount && shouldAutoCompile) {
        await compileActiveProject("auto");
      }
    } catch (error) {
      if (isAutoSaveEnabled) {
        setAutoSaveState("error");
      }
      setStatus(`${isAutoSaveEnabled ? "自动保存" : "自动编译前保存"}失败：${errorMessage(error)}`);
    }
  }

  async function handleCancelCompile() {
    if (!project) return;
    const cancelled = await cancelCompile(project.root);
    setStatus(cancelled ? "已取消编译。" : "当前没有正在运行的编译任务。");
    setIsCompiling(false);
  }

  async function handleCleanBuild() {
    if (!project) return;
    setStatus("正在清理构建缓存...");
    await cleanProjectBuild(project.root);
    lastCompileFailedRef.current = false;
    setCompileResult(null);
    setLastSuccessfulCompileAt(null);
    setPdfRevision((value) => value + 1);
    setStatus("构建缓存已清理。");
  }

  async function handleOpenPdfOutput() {
    if (!project || !pdfPath) return;
    await openPdfFile(project.root, pdfPath);
    setStatus("已用系统 PDF 阅读器打开当前输出。");
  }

  async function handleRevealPdfOutput() {
    if (!project || !pdfPath) return;
    await revealPdfFile(project.root, pdfPath);
    setStatus("已在 Finder 中定位当前 PDF。");
  }

  async function handleExportPdfOutput() {
    if (!project || !pdfPath) return;
    const target = await exportPdfFile(project.root, pdfPath);
    setStatus(target ? `已导出 PDF：${target}` : "已取消导出 PDF。");
  }

  async function handleSyncPdfFromSource() {
    if (!project || !activePath || activeAsset) return;
    if (!pdfPath) {
      setStatus("请先成功编译项目，再从源码定位到 PDF。");
      return;
    }
    const position = editorRef.current?.getPosition();
    const line = position?.lineNumber ?? 1;
    const column = position?.column ?? 1;
    await saveOpenTabsWithHistory("定位 PDF 前保存");
    setStatus("正在定位 PDF...");
    const location = await synctexForwardSearch(project.root, activePath, line, column, pdfPath);
    if (viewMode === "editor") {
      handleViewModeChange("split");
    }
    setIsPreviewCollapsed(false);
    setPdfSyncTarget({ ...location, nonce: Date.now() });
    setStatus(`已定位到 PDF 第 ${location.page} 页。`);
  }

  async function handleSyncSourceFromPdf(page: number, x: number, y: number) {
    if (!project || !pdfPath) return;
    setStatus("正在从 PDF 定位源码...");
    const location = await synctexReverseSearch(project.root, page, x, y, pdfPath);
    if (!isTextPath(location.file)) {
      setStatus(`SyncTeX 返回的文件不可编辑：${location.file}`);
      return;
    }
    if (viewMode === "preview") {
      handleViewModeChange("split");
    }
    await openTextFile(location.file, { line: location.line, column: location.column });
    setSourceSyncHighlight({ file: location.file, line: location.line, nonce: Date.now() });
    setStatus(`已定位到 ${location.file}:${location.line}。`);
  }

  async function handleExportProjectZip() {
    if (!project) return;
    await saveOpenTabsWithHistory("导出项目前保存");
    setShowProjectPanel(false);
    setStatus("正在导出项目源码...");
    const target = await exportProjectZip(project.root);
    setStatus(target ? `项目源码已导出：${target}` : "已取消导出项目源码。");
  }

  async function handleCountWords() {
    if (!project) return;
    await saveOpenTabsWithHistory("统计字数前保存");
    setStatus("正在统计项目字数...");
    const result = await countProjectWords(project.root);
    setWordCount(result);
    setShowWordCountPanel(true);
    setStatus(`项目字数：${result.words.toLocaleString("zh-CN")} 词。`);
  }

  async function handleOpenHistoryPanel() {
    if (!project) return;
    await refreshProjectHistory(project.root);
    setShowProjectPanel(false);
    setShowSettingsPanel(false);
    setShowWordCountPanel(false);
    setShowHistoryPanel((value) => !value);
  }

  async function createAutomaticHistorySnapshot(label: string) {
    if (!project) return;
    try {
      await saveAllOpenTabs();
      await createProjectHistorySnapshot(project.root, label);
      await rememberCurrentProjectSaveSignature();
      await refreshProjectHistory(project.root);
    } catch (error) {
      setStatus(`自动保存历史版本失败：${errorMessage(error)}`);
    }
  }

  async function handleRestoreHistorySnapshot(item: ProjectHistoryItem) {
    if (!project) return;
    setHistoryRestoreItem(item);
    setHistoryDiffItem(item);
    setHistoryDiffSummary(null);
    setShowHistoryPanel(true);
    setStatus(`确认后可恢复到历史版本：${item.label}。`);
  }

  async function handleConfirmRestoreHistorySnapshot(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project || !historyRestoreItem) return;
    const item = historyRestoreItem;
    await createAutomaticHistorySnapshot(`恢复“${item.label}”前`);
    setStatus("正在恢复历史版本...");
    const summary = await restoreProjectHistorySnapshot(project.root, item.snapshotId);
    setHistoryRestoreItem(null);
    await activateProject(summary, `已恢复历史版本：${item.label}。`);
  }

  async function handlePreviewHistoryDiff(item: ProjectHistoryItem) {
    if (!project) return;
    await saveOpenTabsWithHistory("查看历史差异前保存");
    const summary = await getProjectHistoryDiff(project.root, item.snapshotId);
    setHistoryDiffSummary(summary);
    setHistoryDiffItem(item);
    setShowHistoryPanel(true);
    setStatus(
      summary.changedFiles.length
        ? `已显示“${item.label}”与当前项目的差异。`
        : `当前项目与“${item.label}”没有文件差异。`,
    );
  }

  async function handleProjectSearch() {
    if (!project || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      await saveAllOpenTabs();
      const results = await searchProjectFiles(project.root, searchQuery.trim());
      setSearchResults(results);
      setStatus(results.length ? `找到 ${results.length} 条结果。` : "没有找到匹配内容。");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleProjectReplace() {
    if (!project || !searchQuery) return;
    setIsReplaceConfirmVisible(true);
    setStatus("请在项目搜索面板中确认本次精确替换。");
  }

  async function handleConfirmProjectReplace() {
    if (!project || !searchQuery) return;
    setIsReplacing(true);
    try {
      await saveAllOpenTabs();
      await createAutomaticHistorySnapshot(`替换“${searchQuery}”前`);
      const result = await replaceProjectText(project.root, searchQuery, replaceText);
      setIsReplaceConfirmVisible(false);
      await refreshProjectFiles();
      await reloadOpenTabsFromDisk();
      const results = searchQuery.trim()
        ? await searchProjectFiles(project.root, searchQuery.trim())
        : [];
      setSearchResults(results);
      setStatus(
        result.replacements
          ? `已在 ${result.files.length} 个文件中替换 ${result.replacements} 处。`
          : "没有找到可替换的精确匹配。",
      );
    } finally {
      setIsReplacing(false);
    }
  }

  async function handleSearchResultClick(result: SearchResult) {
    await openTextFile(result.file, { line: result.line });
  }

  async function handleOutlineItemClick(item: OutlineItem) {
    await openTextFile(item.file, { line: item.line });
  }

  async function handleAddOutlineItemToCodex(item: OutlineItem) {
    await handleOutlineItemClick(item);
    const labelToken = item.kind === "label" && item.title ? ` #${item.title}` : "";
    const targetTitle = item.title || "(空标题)";
    insertCodexPromptContext(
      `上下文：@${item.file}${labelToken}，${outlineKindLabel(item.kind)}「${targetTitle}」。`,
      `已把 ${outlineKindLabel(item.kind)}「${targetTitle}」加入 Codex 上下文。`,
    );
  }

  async function handleTodoClick(item: ProjectTodo) {
    await openTextFile(item.file, { line: item.line });
  }

  async function handleAddTodoToCodex(item: ProjectTodo) {
    await handleTodoClick(item);
    insertCodexPromptContext(
      `上下文：@${item.file}，批注 ${shortFileName(item.file)}:${item.line}「${item.message}」。`,
      `已把 ${shortFileName(item.file)}:${item.line} 的批注加入 Codex 上下文。`,
    );
  }

  async function handleSetTodoCommentResolved(item: ProjectTodo, resolved: boolean) {
    if (!project) return;
    await saveOpenTabsWithHistory(resolved ? "批注完成前保存" : "批注恢复前保存");
    const fileContent = await readFile(project.root, item.file);
    const lines = fileContent.split("\n");
    const lineIndex = item.line - 1;
    const line = lines[lineIndex];
    if (line === undefined) {
      setStatus("没有找到这条待办批注所在的源码行。");
      return;
    }

    const nextLine = rewriteLatexTodoCommentState(line, resolved);
    if (nextLine === line) {
      setStatus("没有找到可更新状态的 TODO/FIXME/NOTE/REVIEW 批注。");
      return;
    }

    lines[lineIndex] = nextLine;
    const nextContent = lines.join("\n");
    await saveFile(project.root, item.file, nextContent);
    await recordSavedProjectHistory(resolved ? "批注标记完成" : "批注恢复待处理", [item.file]);
    if (activePath === item.file) {
      editorRef.current?.setValue(nextContent);
      setContent(nextContent);
    }
    setTabs((current) =>
      current.map((tab) =>
        tab.path === item.file ? { ...tab, content: nextContent, dirty: false } : tab,
      ),
    );
    await refreshProjectFiles();
    setStatus(
      resolved
        ? `已完成 ${shortFileName(item.file)}:${item.line} 的批注。`
        : `已恢复 ${shortFileName(item.file)}:${item.line} 的批注。`,
    );
  }

  async function handleResolveTodoComment(item: ProjectTodo) {
    await handleSetTodoCommentResolved(item, true);
  }

  async function handleRestoreTodoComment(item: ProjectTodo) {
    await handleSetTodoCommentResolved(item, false);
  }

  async function handleOpenSymbol(symbol: ProjectSymbol) {
    await openTextFile(symbol.file, { line: symbol.line });
  }

  async function handleAddSymbolToCodex(symbol: ProjectSymbol) {
    await handleOpenSymbol(symbol);
    insertCodexPromptContext(
      `上下文：#${symbol.key}，${symbol.kind === "citation" ? "引用" : "标签"}。`,
      `已把 ${symbol.key} 加入 Codex 上下文。`,
    );
  }

  async function handleReferenceIssueClick(issue: ProjectReferenceIssue) {
    await openTextFile(issue.file, { line: issue.line });
    setStatus(`已定位到缺失${referenceIssueKindLabel(issue.kind)}：${issue.key}`);
  }

  async function handleFixReferenceIssueWithCodex(issue: ProjectReferenceIssue) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    await saveOpenTabsWithHistory("Codex 引用前保存");
    let sourceContext = "";
    try {
      sourceContext = referenceIssueSourceSnippet(issue.file, await readFile(project.root, issue.file), issue.line);
    } catch {
      sourceContext = `${issue.file}:${issue.line}\nUnable to read this source file before running Codex.`;
    }
    const prompt = buildReferenceIssueFixPrompt(project, issue, sourceContext);
    const projectContext = buildCodexProjectContext(
      project,
      projectSettings,
      projectOverview,
      projectPreambleContext,
      projectLocalStyleContexts,
      projectMacroSummaries,
      projectDocumentFiles,
      projectDependencies,
      files,
      outline,
      projectSymbols,
      projectTodos,
      projectReferenceIssues,
      compileResult,
      tabs,
    );
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    const allowedFiles = codexAllowedFilesForReferenceIssues([issue], allProjectFiles, projectBibFiles);
    await handleReferenceIssueClick(issue);
    await runCodexPrompt(projectContext ? `${prompt}\n\n${projectContext}` : prompt, prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `缺失引用相关文件：${allowedFiles.join("、")}` : undefined,
    });
  }

  async function handleFixAllReferenceIssuesWithCodex() {
    if (!project || isCodexRunning || environment?.canRunCodex === false || !projectReferenceIssues.length) return;
    await saveOpenTabsWithHistory("Codex 批量引用前保存");
    const sourceContexts: string[] = [];
    const contentByFile = new Map<string, string>();
    for (const issue of projectReferenceIssues.slice(0, MAX_CODEX_REFERENCE_SOURCE_SNIPPETS)) {
      try {
        let fileContent = contentByFile.get(issue.file);
        if (fileContent === undefined) {
          fileContent = await readFile(project.root, issue.file);
          contentByFile.set(issue.file, fileContent);
        }
        const snippet = referenceIssueSourceSnippet(issue.file, fileContent, issue.line);
        if (snippet) sourceContexts.push(snippet);
      } catch {
        sourceContexts.push(`${issue.file}:${issue.line}\nUnable to read this source file before running Codex.`);
      }
    }
    const prompt = buildReferenceIssuesFixPrompt(project, projectReferenceIssues, sourceContexts);
    const projectContext = buildCodexProjectContext(
      project,
      projectSettings,
      projectOverview,
      projectPreambleContext,
      projectLocalStyleContexts,
      projectMacroSummaries,
      projectDocumentFiles,
      projectDependencies,
      files,
      outline,
      projectSymbols,
      projectTodos,
      projectReferenceIssues,
      compileResult,
      tabs,
    );
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    const allowedFiles = codexAllowedFilesForReferenceIssues(projectReferenceIssues, allProjectFiles, projectBibFiles);
    await handleReferenceIssueClick(projectReferenceIssues[0]);
    await runCodexPrompt(projectContext ? `${prompt}\n\n${projectContext}` : prompt, prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `缺失引用相关文件：${allowedFiles.length} 个` : undefined,
    });
  }

  openSymbolFromReferenceRef.current = handleOpenSymbol;

  async function handleCopySymbol(symbol: ProjectSymbol) {
    const snippet = latexSnippetForSymbol(symbol);
    try {
      await navigator.clipboard.writeText(snippet);
      setStatus(`已复制 ${snippet}`);
    } catch (error) {
      setStatus(`复制失败：${errorMessage(error)}`);
    }
  }

  async function handleInsertSymbol(symbol: ProjectSymbol) {
    const snippet = latexSnippetForSymbol(symbol);
    if (!insertTextAtEditorSelection(snippet, "reference-panel")) {
      await handleCopySymbol(symbol);
      return;
    }
    setStatus(`已插入 ${snippet}`);
  }

  function handleStartBibEntryDraft() {
    setIsSymbolsCollapsed(false);
    setBibEntryDraft({
      targetFile: defaultBibTargetFile,
      entryType: "article",
      key: "",
      author: "",
      title: "",
      year: "",
      venue: "",
      insertCitation: true,
    });
  }

  async function handleSubmitBibEntryDraft(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !bibEntryDraft) return;
    const key = sanitizeBibKey(bibEntryDraft.key);
    const targetFile = normalizeBibTargetFile(bibEntryDraft.targetFile);
    if (!key) {
      setStatus("请输入 BibTeX key。");
      return;
    }
    if (!targetFile) {
      setStatus("目标文件必须是项目内 .bib 文件。");
      return;
    }
    if (projectSymbols.some((symbol) => symbol.kind === "citation" && symbol.key === key)) {
      setStatus(`BibTeX key ${key} 已存在，请换一个 key。`);
      return;
    }

    await saveOpenTabsWithHistory(`新增 BibTeX ${key} 前保存`);
    await createAutomaticHistorySnapshot(`新增 BibTeX ${key} 前`);
    const exists = allProjectFiles.includes(targetFile);
    let currentBib = "";
    if (exists) {
      currentBib = await readFile(project.root, targetFile);
    }
    const nextEntry = buildBibEntry({ ...bibEntryDraft, key, targetFile });
    const separator = currentBib.trim() ? "\n\n" : "";
    const nextContent = `${currentBib.replace(/\s*$/, "")}${separator}${nextEntry}\n`;
    await saveFile(project.root, targetFile, nextContent);
    await refreshProjectFiles();
    await openTextFile(targetFile, { forceReload: true, line: nextContent.split("\n").length - nextEntry.split("\n").length + 1 });
    setBibEntryDraft(null);

    if (bibEntryDraft.insertCitation && activePath && activePath.endsWith(".tex")) {
      setPendingEditorInsertion({
        text: `\\cite{${key}}`,
        source: "bib-entry-draft",
        status: `已新增 BibTeX 条目并插入 \\cite{${key}}。`,
      });
      await openTextFile(activePath);
    }
    setStatus(
      exists
        ? `已添加 BibTeX 条目 ${key} 到 ${targetFile}。`
        : `已创建 ${targetFile} 并添加 BibTeX 条目 ${key}。`,
    );
  }

  function handleInsertSnippetFromAsset(snippet: string) {
    if (!activePath || !isTextPath(activePath)) {
      setStatus("当前没有可插入的 .tex 编辑器。");
      return false;
    }
    if (activeAsset || !editorRef.current) {
      setPendingEditorInsertion({
        text: snippet,
        source: "asset-preview",
        status: "已插入 LaTeX 代码。",
      });
      setActiveAsset(null);
      setStatus("正在切回编辑器并插入代码...");
      return true;
    }
    if (insertTextAtEditorSelection(snippet, "asset-preview")) {
      setStatus("已插入 LaTeX 代码。");
      return true;
    }
    setStatus("当前没有可插入的文本光标。");
    return false;
  }

  function insertTextAtEditorSelection(text: string, source: string) {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    if (!editor || !selection || activeAsset) {
      return false;
    }
    editor.executeEdits(source, [
      {
        range: selection,
        text,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
    const nextContent = editor.getValue();
    setContent(nextContent);
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activePath ? { ...tab, content: nextContent, dirty: true } : tab,
      ),
    );
    markSourceEdited();
    return true;
  }

  function markActiveFileDirty(nextContent: string) {
    setContent(nextContent);
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activePath ? { ...tab, content: nextContent, dirty: true } : tab,
      ),
    );
    markSourceEdited();
  }

  function handleToggleLatexComment() {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!editor || !selection || !model || activeAsset || !activePath) {
      setStatus("当前没有可注释的 LaTeX 编辑器。");
      return;
    }

    const startLine = selection.startLineNumber;
    const endLine =
      selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
        ? selection.endLineNumber - 1
        : selection.endLineNumber;
    const lineNumbers = Array.from(
      { length: Math.max(1, endLine - startLine + 1) },
      (_, index) => startLine + index,
    );
    const nonEmptyLines = lineNumbers.filter((lineNumber) => model.getLineContent(lineNumber).trim());
    const targetLines = nonEmptyLines.length ? nonEmptyLines : lineNumbers;
    const shouldUncomment = targetLines.every((lineNumber) =>
      /^\s*% ?/.test(model.getLineContent(lineNumber)),
    );
    const edits = targetLines.map((lineNumber) => {
      const line = model.getLineContent(lineNumber);
      const indentLength = line.match(/^\s*/)?.[0].length ?? 0;
      if (shouldUncomment) {
        const commentMatch = line.slice(indentLength).match(/^% ?/);
        const removeLength = commentMatch?.[0].length ?? 0;
        return {
          range: {
            startLineNumber: lineNumber,
            startColumn: indentLength + 1,
            endLineNumber: lineNumber,
            endColumn: indentLength + removeLength + 1,
          },
          text: "",
          forceMoveMarkers: true,
        };
      }
      return {
        range: {
          startLineNumber: lineNumber,
          startColumn: indentLength + 1,
          endLineNumber: lineNumber,
          endColumn: indentLength + 1,
        },
        text: "% ",
        forceMoveMarkers: true,
      };
    });

    editor.executeEdits("latex-toggle-comment", edits);
    markActiveFileDirty(editor.getValue());
    editor.setSelection(selection);
    editor.focus();
    setStatus(shouldUncomment ? "已取消注释。" : "已注释选中行。");
  }

  function handleInsertTodoComment() {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!editor || !selection || !model || activeAsset || !activePath) {
      setStatus("当前没有可插入批注的 LaTeX 编辑器。");
      return;
    }

    const targetLine = selection.getStartPosition().lineNumber;
    const line = model.getLineContent(targetLine);
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const placeholder = "描述需要修改的问题";
    const prefix = `${indent}% TODO: `;
    const insertedText = `${prefix}${placeholder}\n`;
    editor.executeEdits("latex-insert-todo-comment", [
      {
        range: {
          startLineNumber: targetLine,
          startColumn: 1,
          endLineNumber: targetLine,
          endColumn: 1,
        },
        text: insertedText,
        forceMoveMarkers: true,
      },
    ]);
    markActiveFileDirty(editor.getValue());
    const startColumn = prefix.length + 1;
    editor.setSelection({
      startLineNumber: targetLine,
      startColumn,
      endLineNumber: targetLine,
      endColumn: startColumn + placeholder.length,
    });
    editor.focus();
    setStatus("已插入 TODO 批注；保存后会出现在左侧待办批注。");
  }

  function handleToggleReviewMode() {
    if (!project) return;
    const nextMode = !isReviewMode;
    setIsReviewMode(nextMode);
    if (nextMode) {
      setIsSidebarCollapsed(false);
      setIsTodosCollapsed(false);
      setShowResolvedTodos(false);
      editorRef.current?.focus();
      setStatus(
        `已进入 Review 批注模式。使用 ${shortcuts.reviewMode} 可退出，${shortcuts.insertReviewComment} 可添加 REVIEW 批注。`,
      );
    } else {
      reviewDecorationCollectionRef.current?.clear();
      setStatus("已退出 Review 批注模式。");
    }
  }

  function handleInsertReviewComment() {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!editor || !selection || !model || activeAsset || !activePath) {
      setStatus("当前没有可插入批注的 LaTeX 编辑器。");
      return;
    }

    const targetLine = selection.getStartPosition().lineNumber;
    const line = model.getLineContent(targetLine);
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const placeholder = "写下审阅意见";
    const prefix = `${indent}% REVIEW: `;
    const selectedText = model.getValueInRange(selection);
    const hasSelection = !selection.isEmpty() && selectedText.length > 0;
    const selectedTextWithLineEnd = selectedText.endsWith("\n") ? selectedText : `${selectedText}\n`;
    const insertedText = hasSelection
      ? `${prefix}${placeholder}\n${selectedTextWithLineEnd}${indent}% REVIEW-END\n`
      : `${prefix}${placeholder}\n`;
    editor.executeEdits("latex-insert-review-comment", [
      {
        range: hasSelection
          ? selection
          : {
              startLineNumber: targetLine,
              startColumn: 1,
              endLineNumber: targetLine,
              endColumn: 1,
            },
        text: insertedText,
        forceMoveMarkers: true,
      },
    ]);
    markActiveFileDirty(editor.getValue());
    const startColumn = prefix.length + 1;
    editor.setSelection({
      startLineNumber: targetLine,
      startColumn,
      endLineNumber: targetLine,
      endColumn: startColumn + placeholder.length,
    });
    setIsReviewMode(true);
    setIsSidebarCollapsed(false);
    setIsTodosCollapsed(false);
    setShowResolvedTodos(false);
    editor.focus();
    setStatus(hasSelection ? "已为选中内容添加 REVIEW 批注高亮。" : "已插入 REVIEW 批注；保存后会出现在左侧待办批注。");
  }

  function handleLatexInsertAction(action: LatexInsertAction) {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!editor || !selection || !model || activeAsset || !activePath) {
      setStatus("当前没有可插入的 LaTeX 编辑器。");
      return;
    }

    const selectedText = selection.isEmpty() ? "" : model.getValueInRange(selection);
    const body = selectedText || action.placeholder;
    const insertedText = `${action.before}${body}${action.after}`;
    const startOffset = model.getOffsetAt(selection.getStartPosition());
    editor.executeEdits("latex-insert-toolbar", [
      {
        range: selection,
        text: insertedText,
        forceMoveMarkers: true,
      },
    ]);

    const nextContent = editor.getValue();
    markActiveFileDirty(nextContent);

    const bodyStart = model.getPositionAt(startOffset + action.before.length);
    const bodyEnd = model.getPositionAt(startOffset + action.before.length + body.length);
    editor.setSelection({
      startLineNumber: bodyStart.lineNumber,
      startColumn: bodyStart.column,
      endLineNumber: bodyEnd.lineNumber,
      endColumn: bodyEnd.column,
    });
    editor.focus();
    setStatus(`已插入 ${action.label}。`);
  }

  async function handleOpenDiffTarget(file: string, line?: number) {
    if (!isTextPath(file)) {
      setStatus(`${file} 不是可编辑文本文件。`);
      return;
    }
    await openTextFile(file, { line });
  }

  function handleJumpToCodexChange(direction: -1 | 1) {
    if (!activeCodexChangeLines.length || activeAsset) return;
    const currentLine = editorRef.current?.getPosition()?.lineNumber ?? editorCursorPosition.line;
    const nextLine =
      direction > 0
        ? activeCodexChangeLines.find((line) => line > currentLine) ?? activeCodexChangeLines[0]
        : [...activeCodexChangeLines].reverse().find((line) => line < currentLine) ??
          activeCodexChangeLines[activeCodexChangeLines.length - 1];
    if (!nextLine) return;
    editorRef.current?.revealLineInCenter(nextLine);
    editorRef.current?.setPosition({ lineNumber: nextLine, column: 1 });
    editorRef.current?.focus();
    setStatus(`已跳转到第 ${nextLine} 行的 Codex 修改。`);
  }

  function handleHideCodexHighlights() {
    if (!diffSummary) return;
    setHiddenCodexHighlightRunId(diffSummary.runId);
    codexDecorationCollectionRef.current?.clear();
    setStatus("已隐藏编辑器中的 Codex 修改高亮；diff 和撤回仍保留。");
  }

  function handleGoToLine() {
    if (!activePath || activeAsset) return;
    const defaultLine = editorRef.current?.getPosition()?.lineNumber ?? pendingLine ?? 1;
    setGoToLineValue(defaultLine.toString());
    setIsGoToLineOpen(true);
    setStatus("输入行号后按 Enter 跳转。");
  }

  function handleSubmitGoToLine(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!activePath || activeAsset) return;
    const input = goToLineValue.trim();
    if (!input) {
      setStatus("请输入要跳转的行号。");
      return;
    }
    const line = Number.parseInt(input, 10);
    if (!Number.isFinite(line) || line < 1) {
      setStatus("请输入有效行号。");
      return;
    }
    if (viewMode === "preview") {
      handleViewModeChange("split");
    }
    setIsPreviewCollapsed(false);
    setPendingLine(line);
    setPendingColumn(null);
    editorRef.current?.revealLineInCenter(line);
    editorRef.current?.setPosition({ lineNumber: line, column: 1 });
    editorRef.current?.focus();
    setIsGoToLineOpen(false);
    setStatus(`已跳转到第 ${line} 行。`);
  }

  function readCodexEditorContext(): CodexEditorContext | null {
    if (activeAsset) return null;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activePath) return null;

    const selection = editor.getSelection();
    const position = editor.getPosition();
    const cursorLine = position?.lineNumber ?? selection?.positionLineNumber ?? 1;
    const cursorColumn = position?.column ?? selection?.positionColumn ?? 1;
    const rawSelectedText = selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
    const hasSelectedText = rawSelectedText.trim().length > 0;
    const selectionStartLine = selection?.getStartPosition().lineNumber;
    const selectionEndLine = selection?.getEndPosition().lineNumber;
    const selectedText =
      hasSelectedText && rawSelectedText.length > MAX_CODEX_SELECTION_CONTEXT
        ? rawSelectedText.slice(0, MAX_CODEX_SELECTION_CONTEXT)
        : rawSelectedText;
    const nearby = readEditorNearbyContext(model, cursorLine);
    const activeSection = activeOutlineItemForCursor(outline, activePath, cursorLine);
    const activeSectionSource = activeSection
      ? readEditorActiveSectionContext(model, outline, activePath, activeSection)
      : null;

    return {
      source: "editor",
      file: activePath,
      cursorLine,
      cursorColumn,
      activeSection: activeSection
        ? {
            kind: activeSection.kind,
            title: activeSection.title,
            line: activeSection.line,
            level: activeSection.level,
          }
        : undefined,
      activeSectionSource: activeSectionSource ?? undefined,
      selectedText,
      selectedCharCount: rawSelectedText.length,
      selectionStartLine: hasSelectedText ? selectionStartLine : undefined,
      selectionEndLine: hasSelectedText ? selectionEndLine : undefined,
      truncated: hasSelectedText && rawSelectedText.length > MAX_CODEX_SELECTION_CONTEXT,
      nearbyStartLine: nearby.startLine,
      nearbyEndLine: nearby.endLine,
      nearbyText: nearby.text,
      nearbyTruncated: nearby.truncated,
    };
  }

  function buildCodexPrompt(
    userPrompt: string,
    contextOverride?: {
      files: FileNode[];
      outline: OutlineItem[];
      overview?: ProjectOverview;
      preambleContext?: string;
      localStyleContexts?: CodexReferencedFileContext[];
      macroSummaries?: CodexLatexMacroSummary[];
      documentFiles?: string[];
      dependencies?: ProjectDependency[];
      symbols?: ProjectSymbol[];
      todos?: ProjectTodo[];
    },
    referencedFiles: CodexReferencedFileContext[] = [],
    referencedSymbols: CodexReferencedSymbolContext[] = [],
    contextCitationSources: CodexReferencedSymbolContext[] = [],
  ) {
    const isPinnedContext = Boolean(pinnedCodexContext);
    const context = pinnedCodexContext ?? readCodexEditorContext();
    const effectiveFiles = contextOverride?.files ?? files;
    const effectiveProjectFiles = collectProjectFiles(effectiveFiles);
    const effectiveSymbols = contextOverride?.symbols ?? projectSymbols;
    const effectiveTodos = contextOverride?.todos ?? projectTodos;
    const projectContext = buildCodexProjectContext(
      project,
      projectSettings,
      contextOverride?.overview ?? projectOverview,
      contextOverride?.preambleContext ?? projectPreambleContext,
      contextOverride?.localStyleContexts ?? projectLocalStyleContexts,
      contextOverride?.macroSummaries ?? projectMacroSummaries,
      contextOverride?.documentFiles ?? projectDocumentFiles,
      contextOverride?.dependencies ?? projectDependencies,
      effectiveFiles,
      contextOverride?.outline ?? outline,
      effectiveSymbols,
      effectiveTodos,
      projectReferenceIssues,
      compileResult,
      tabs,
    );

    const locationLines = [];
    if (projectContext) {
      locationLines.push(projectContext);
    }
    if (isCodexDiffContextEnabled && diffSummary?.changedFiles.length) {
      locationLines.push(buildCodexDiffContext(diffSummary));
    }
    const shouldApplyCodexContextScope =
      isCodexContextOnlyEnabled && codexPrompt.trim() === userPrompt.trim() && codexEditableScopeFiles.length > 0;
    if (shouldApplyCodexContextScope) {
      locationLines.push(buildCodexEditScopeContext(codexEditableScopeFiles));
    }
    if (referencedFiles.length) {
      locationLines.push(buildCodexReferencedFilesContext(referencedFiles));
    }
    if (referencedSymbols.length) {
      locationLines.push(buildCodexReferencedSymbolsContext(referencedSymbols));
    }
    if (contextCitationSources.length) {
      locationLines.push(buildCodexContextCitationSourcesContext(contextCitationSources));
    }

    if (!context) {
      return locationLines.length ? `${userPrompt}\n\n${locationLines.join("\n\n")}` : userPrompt;
    }

    locationLines.push(
      isPinnedContext ? "Pinned editor context from LaTeX Studio:" : "Current editor context from LaTeX Studio:",
      isPinnedContext
        ? "- The user explicitly locked this editor context before typing the Codex request; treat it as the primary target even if the cursor later moved."
        : "- This context was read from the current editor state when the Codex request started.",
      `- Active file: ${context.file}`,
      `- Cursor: line ${context.cursorLine}, column ${context.cursorColumn}`,
    );
    if (context.activeSection) {
      locationLines.push(
        `- Active outline item: ${context.activeSection.kind} ${context.activeSection.title || "(empty title)"} at line ${context.activeSection.line}`,
      );
    }
    const contextCitations = codexContextCitations(context, effectiveSymbols);
    const contextLabelRefs = codexContextLabelRefs(context, effectiveSymbols);
    const contextDefinedLabels = codexContextDefinedLabels(context);
    const contextEnvironments = codexContextEnvironments(context);
    const contextGraphics = codexContextGraphics(context, effectiveProjectFiles);
    const contextTodos = codexContextTodos(context, effectiveTodos);

    if (context.selectedText.trim()) {
      const isDiffHunkContext = context.source === "diff-hunk";
      locationLines.push(
        isDiffHunkContext
          ? `- Locked Codex diff hunk range: lines ${context.selectionStartLine}-${context.selectionEndLine}`
          : `- Selected range: lines ${context.selectionStartLine}-${context.selectionEndLine}`,
        isDiffHunkContext
          ? "- This is the exact Codex diff hunk the user chose to continue revising; treat this hunk and its nearby source as the primary target."
          : "- If the user refers to \"this\", \"selected text\", \"here\", or similar wording, treat this selected range as the target.",
        "",
        isDiffHunkContext ? "Current source from locked diff hunk:" : "Selected text:",
        "```latex",
        context.selectedText,
        "```",
      );
      if (context.truncated) {
        locationLines.push(
          `Selection was truncated to ${MAX_CODEX_SELECTION_CONTEXT} characters for context; inspect the file before applying broad edits.`,
        );
      }
    } else {
      if (context.activeSectionSource) {
        locationLines.push(
          `- Active section source range: lines ${context.activeSectionSource.startLine}-${context.activeSectionSource.endLine}`,
          "- If the user asks to revise this section, polish here, expand this part, or similar wording, treat this active section as the target.",
          "",
          "Active section source:",
          "```latex",
          context.activeSectionSource.text,
          "```",
        );
        if (context.activeSectionSource.truncated) {
          locationLines.push(
            `Active section source was truncated to ${MAX_CODEX_ACTIVE_SECTION_CONTEXT} characters; inspect the file before applying broad edits.`,
          );
        }
      }
      locationLines.push(
        "- No text is selected. If the user refers to \"here\" or the current location, use the active file and cursor line as the default target.",
        `- Nearby source range: lines ${context.nearbyStartLine}-${context.nearbyEndLine}`,
        "",
        "Nearby source around cursor:",
        "```latex",
        context.nearbyText,
        "```",
      );
      if (context.nearbyTruncated) {
        locationLines.push(
          `Nearby source was truncated to ${MAX_CODEX_NEARBY_CONTEXT} characters; inspect the file before applying broad edits.`,
        );
      }
    }
    if (contextCitations.length) {
      locationLines.push(
        "",
        `Citations referenced in current editor context (${contextCitations.length} shown):`,
        ...contextCitations.map((symbol) => {
          const detail = symbol.detail ? ` - ${symbol.detail}` : "";
          return `- ${symbol.key} (${symbol.file}:${symbol.line})${detail}`;
        }),
      );
    }
    if (contextLabelRefs.length) {
      locationLines.push(
        "",
        `Labels referenced in current editor context (${contextLabelRefs.length} shown):`,
        ...contextLabelRefs.map((symbol) => {
          const detail = symbol.detail ? ` - ${symbol.detail}` : "";
          return `- ${symbol.key} (${symbol.file}:${symbol.line})${detail}`;
        }),
      );
    }
    if (contextDefinedLabels.length) {
      locationLines.push(
        "",
        `Labels defined in current editor context (${contextDefinedLabels.length} shown):`,
        "- If you rewrite this area, preserve these \\label keys unless the user explicitly asks to rename them.",
        ...contextDefinedLabels.map((label) => `- line ${label.line}: ${label.key}`),
      );
    }
    if (contextEnvironments.length) {
      locationLines.push(
        "",
        `LaTeX environments in current editor context (${contextEnvironments.length} shown):`,
        "- Preserve matching \\begin/\\end structure, captions, and labels unless the user explicitly asks to restructure them.",
        ...contextEnvironments.map((environment) => {
          const label = environment.label ? ` label=${environment.label}` : "";
          const caption = environment.caption ? ` caption="${environment.caption}"` : "";
          return `- line ${environment.line}: ${environment.name}${label}${caption}`;
        }),
      );
    }
    if (contextGraphics.length) {
      locationLines.push(
        "",
        `Graphics referenced in current editor context (${contextGraphics.length} shown):`,
        ...contextGraphics.map((reference) => {
          const resolved = reference.resolvedPath ? ` -> ${reference.resolvedPath}` : " -> unresolved";
          return `- line ${reference.range.startLineNumber}: \\${reference.command}{${reference.path}}${resolved}`;
        }),
      );
    }
    if (contextTodos.length) {
      locationLines.push(
        "",
        `Unresolved TODO/review comments in current editor context (${contextTodos.length} shown):`,
        ...contextTodos.map(
          (item) => `- [${item.kind}] ${item.file}:${item.line}: ${item.message}`,
        ),
      );
    }

    return `${userPrompt}\n\n${locationLines.join("\n")}`;
  }

  async function prepareCodexPrompt(userPrompt: string) {
    await saveOpenTabsWithHistory("Codex 前保存");
    const latestContext = await refreshProjectFiles();
    const latestSymbols = latestContext?.symbols ?? projectSymbols;
    const referencedFiles = project
      ? await readCodexReferencedFileContexts(
          project.root,
          userPrompt,
          collectProjectFiles(latestContext?.files ?? files),
        )
      : [];
    const referencedSymbols = project
      ? await readCodexReferencedSymbolContexts(project.root, userPrompt, latestSymbols)
      : [];
    const contextCitationSources =
      project && !activeAsset
        ? await readCodexContextCitationSourceContexts(project.root, readCodexEditorContext(), latestSymbols)
        : [];
    return buildCodexPrompt(
      userPrompt,
      latestContext ?? undefined,
      referencedFiles,
      referencedSymbols,
      contextCitationSources,
    );
  }

  async function readCodexReferencedFileContexts(
    projectRoot: string,
    userPrompt: string,
    projectFiles: string[],
  ): Promise<CodexReferencedFileContext[]> {
    const mentionedPaths = resolveCodexFileMentionPaths(
      userPrompt,
      uniqueTextPaths(projectFiles),
      MAX_CODEX_REFERENCED_FILES,
    );
    const contexts: CodexReferencedFileContext[] = [];
    for (const path of mentionedPaths) {
      try {
        const content = await readFile(projectRoot, path);
        const truncated = content.length > MAX_CODEX_REFERENCED_FILE_CONTEXT;
        contexts.push({
          path,
          content: truncated ? content.slice(0, MAX_CODEX_REFERENCED_FILE_CONTEXT) : content,
          originalLength: content.length,
          truncated,
        });
      } catch {
        // Path confinement and file availability are enforced by the backend; stale mentions are ignored.
      }
    }
    return contexts;
  }

  async function readCodexReferencedSymbolContexts(
    projectRoot: string,
    userPrompt: string,
    symbols: ProjectSymbol[],
  ): Promise<CodexReferencedSymbolContext[]> {
    const mentionedKeys = resolveCodexSymbolMentionKeys(userPrompt, symbols, MAX_CODEX_REFERENCED_SYMBOLS);
    const symbolByKey = new Map(symbols.map((symbol) => [symbol.key.toLowerCase(), symbol]));
    const mentionedSymbols = mentionedKeys
      .map((key) => symbolByKey.get(key.toLowerCase()))
      .filter((symbol): symbol is ProjectSymbol => Boolean(symbol));
    return readCodexSymbolSourceContexts(projectRoot, mentionedSymbols, MAX_CODEX_REFERENCED_SYMBOLS);
  }

  async function readCodexContextCitationSourceContexts(
    projectRoot: string,
    context: CodexEditorContext | null,
    symbols: ProjectSymbol[],
  ): Promise<CodexReferencedSymbolContext[]> {
    if (!context) return [];
    const citationSymbols = codexContextCitations(context, symbols).slice(0, MAX_CODEX_CONTEXT_CITATION_SOURCES);
    return readCodexSymbolSourceContexts(projectRoot, citationSymbols, MAX_CODEX_CONTEXT_CITATION_SOURCES);
  }

  async function readCodexSymbolSourceContexts(
    projectRoot: string,
    symbols: ProjectSymbol[],
    maxSymbols: number,
  ): Promise<CodexReferencedSymbolContext[]> {
    const contexts: CodexReferencedSymbolContext[] = [];
    const seen = new Set<string>();
    for (const symbol of symbols) {
      const dedupeKey = `${symbol.kind}:${symbol.key}:${symbol.file}:${symbol.line}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      try {
        const content = await readFile(projectRoot, symbol.file);
        contexts.push(readCodexSymbolSourceContext(symbol, content));
      } catch {
        // Symbols can become stale between indexing and prompt submission.
      }
      if (contexts.length >= maxSymbols) break;
    }
    return contexts;
  }

  async function handleRunCodex() {
    if (!project || !codexPrompt.trim()) return;
    const userPrompt = codexPrompt.trim();
    await runCodexPrompt(await prepareCodexPrompt(userPrompt), userPrompt);
  }

  async function handleAskCodex() {
    if (!project || !codexPrompt.trim()) return;
    const userPrompt = codexPrompt.trim();
    await runCodexAskPrompt(await prepareCodexPrompt(userPrompt), userPrompt);
  }

  async function handleCopyCodexAnswer() {
    if (!codexAnswer.trim()) return;
    try {
      await navigator.clipboard.writeText(codexAnswer);
      setStatus("已复制 Codex 输出。");
    } catch (error) {
      setStatus(`复制 Codex 输出失败：${errorMessage(error)}`);
    }
  }

  async function handleCopyDiffText(text: string, label: string) {
    const content = text.trim() || "没有 diff 内容。";
    try {
      await navigator.clipboard.writeText(content);
      setStatus(`已复制${label}。`);
    } catch (error) {
      setStatus(`复制${label}失败：${errorMessage(error)}`);
    }
  }

  function handleUseCodexAnswerAsEditPrompt() {
    if (!codexAnswer.trim()) return;
    setCodexPrompt(
      [
        "请根据下面这段 Codex 问答建议，直接修改当前 LaTeX 项目中的相关文件。",
        "修改前请先检查项目文件；不要编造不存在的引用、数据或事实；如果建议里有多个候选方案，请选择最稳妥、最小范围的一种。",
        "",
        "Codex 问答建议：",
        "```text",
        codexAnswer.trim(),
        "```",
      ].join("\n"),
    );
    setIsCodexCollapsed(false);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(0, 0);
      setCodexPromptCursor(0);
    });
    setStatus("已把 Codex 回答转为修改指令，可点击“执行”应用。");
  }

  function handleInsertCodexAnswerAsReviewComment() {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!codexAnswer.trim()) return;
    if (!editor || !selection || !model || activeAsset || !activePath || !isTextPath(activePath)) {
      setStatus("当前没有可插入批注的 LaTeX 编辑器。");
      return;
    }
    if (viewMode === "preview") {
      handleViewModeChange("split");
    }
    const indent = model.getLineContent(selection.startLineNumber).match(/^\s*/)?.[0] ?? "";
    const selectedText = selection.isEmpty() ? "" : model.getValueInRange(selection);
    const reviewComment = formatCodexAnswerReviewComment(codexAnswer, indent, selectedText);
    if (!reviewComment) return;
    editor.executeEdits("codex-answer-review-comment", [
      {
        range: selection,
        text: reviewComment,
        forceMoveMarkers: true,
      },
    ]);
    markActiveFileDirty(editor.getValue());
    setIsReviewMode(true);
    setIsSidebarCollapsed(false);
    setIsTodosCollapsed(false);
    setShowResolvedTodos(false);
    editor.focus();
    setStatus("已把 Codex 输出插入为 REVIEW 批注；保存后会出现在左侧批注。");
  }

  function handleSendEditorContextToCodex() {
    if (!project || activeAsset || environment?.canRunCodex === false) {
      setStatus("当前没有可交给 Codex 的 LaTeX 编辑器。");
      return;
    }
    const context = readCodexEditorContext();
    if (!context) {
      setStatus("当前没有可交给 Codex 的编辑器上下文。");
      return;
    }
    const hasSelection = context.selectedText.trim().length > 0;
    setPinnedCodexContext(context);
    setIsCodexCollapsed(false);
    window.requestAnimationFrame(() => codexPromptInputRef.current?.focus());
    setStatus(hasSelection ? "已锁定当前选区作为 Codex 上下文，请输入修改要求。" : "已锁定当前光标位置作为 Codex 上下文，请输入修改要求。");
  }

  function insertCodexPromptContext(text: string, statusMessage: string) {
    if (!project || environment?.canRunCodex === false) {
      setStatus("当前不可使用 Codex。");
      return;
    }
    const insertion = text.trim();
    if (!insertion) return;
    const currentPrompt = codexPrompt;
    const nextPrompt = currentPrompt.includes(insertion)
      ? currentPrompt
      : `${currentPrompt}${currentPrompt && !/\s$/.test(currentPrompt) ? " " : ""}${insertion} `;
    const nextCursor = nextPrompt.length;
    setCodexPrompt(nextPrompt);
    setCodexPromptCursor(nextCursor);
    setIsSidebarCollapsed(false);
    setIsCodexCollapsed(false);
    setIsCodexPromptFocused(true);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
    setStatus(statusMessage);
  }

  function focusCodexPrompt() {
    if (!project) return;
    setIsSidebarCollapsed(false);
    setIsCodexCollapsed(false);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(
        codexPromptInputRef.current.value.length,
        codexPromptInputRef.current.value.length,
      );
      setCodexPromptCursor(codexPromptInputRef.current?.selectionStart ?? codexPrompt.length);
    });
    setStatus("已聚焦 Codex 输入框。");
  }

  function syncCodexPromptCursor(input: HTMLTextAreaElement | null) {
    if (!input) return;
    setCodexPromptCursor(input.selectionStart ?? input.value.length);
  }

  function handleCodexPromptChange(input: HTMLTextAreaElement) {
    setCodexPrompt(input.value);
    setCodexPromptCursor(input.selectionStart ?? input.value.length);
  }

  function handleInsertCodexMention(
    suggestion: CodexMentionSuggestion | undefined = activeCodexMentionSuggestion,
    query: CodexMentionQuery | null = codexMentionQuery,
  ) {
    if (!suggestion || !query) return;
    const insertion = `${query.trigger}${suggestion.value}`;
    const before = codexPrompt.slice(0, query.start);
    const after = codexPrompt.slice(query.end);
    const spacer = after.length && !/^[\s,;，。；：!?！？)）\]}]/.test(after) ? " " : "";
    const nextPrompt = `${before}${insertion}${spacer}${after}`;
    const nextCursor = before.length + insertion.length + spacer.length;
    setCodexPrompt(nextPrompt);
    setCodexPromptCursor(nextCursor);
    setIsCodexPromptFocused(true);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function handleOpenCodexContextFile(path: string) {
    await openTextFile(path);
    focusCodexPrompt();
  }

  async function handleOpenCodexContextSymbol(symbol: ProjectSymbol) {
    await handleOpenSymbol(symbol);
    focusCodexPrompt();
  }

  function handleRemoveCodexPromptMention(trigger: "@" | "#", value: string) {
    const nextPrompt = removeCodexPromptMention(codexPrompt, trigger, value);
    setCodexPrompt(nextPrompt);
    const nextCursor = nextPrompt.length;
    setCodexPromptCursor(nextCursor);
    setIsCodexPromptFocused(true);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
    setStatus(`已移除 ${trigger}${value} 上下文引用。`);
  }

  async function runCodexPrompt(
    prompt: string,
    displayPrompt = prompt,
    options: { allowedFiles?: string[]; scopeLabel?: string } = {},
  ) {
    if (!project || !prompt.trim()) return;
    const explicitScopeFiles = uniqueTextPaths((options.allowedFiles ?? []).filter(isTextPath));
    const contextScopeFiles = explicitScopeFiles.length
      ? explicitScopeFiles
      : isCodexContextOnlyEnabled && codexPrompt.trim() === displayPrompt.trim()
        ? codexEditableScopeFiles
        : [];
    const scopedPrompt =
      explicitScopeFiles.length && !prompt.includes("Codex edit scope lock from LaTeX Studio:")
        ? `${prompt}\n\n${buildCodexEditScopeContext(explicitScopeFiles)}`
        : prompt;
    await saveOpenTabsWithHistory("Codex 前保存");
    setCodexPrompt("");
    setPinnedCodexContext(null);
    setCodexConversationPrompt(options.scopeLabel ? `${displayPrompt.trim()}\n范围：${options.scopeLabel}` : displayPrompt.trim());
    setCodexRunMode("edit");
    setIsCodexRunning(true);
    setIsCodexCancelling(false);
    codexCancelRequestedRef.current = false;
    setCodexEvents([]);
    setCodexAnswer("");
    setDiffSummary(null);
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    try {
      const rawSummary = await runCodexEdit({
        projectRoot: project.root,
        prompt: scopedPrompt,
        autoCompile: false,
        allowedFiles: contextScopeFiles,
      });
      const summary = rawSummary;
      const hasScopeRevertedFiles = Boolean(summary.scopeRevertedFiles?.length);
      setDiffSummary(summary.changedFiles.length || hasScopeRevertedFiles ? summary : null);
      if (summary.changedFiles.length) {
        markSourceEdited();
      }
      await refreshProjectFiles();
      await refreshCodexHistory();
      await reloadOpenTabsFromDisk();
      const firstTextChange = summary.changedFiles.find(isTextPath);
      if (firstTextChange) {
        await openTextFile(firstTextChange, { forceReload: true });
      }
      let recompileResult: CompileResult | null = null;
      let recompileError = "";
      if (summary.changedFiles.length && environment?.canCompile) {
        try {
          recompileResult = await compileActiveProject("auto");
        } catch (error) {
          recompileError = errorMessage(error);
        }
      }
      const scopeRevertedFiles = summary.scopeRevertedFiles ?? [];
      const scopeNotice = scopeRevertedFiles.length
        ? `已自动撤回 ${scopeRevertedFiles.length} 个上下文外文件：${scopeRevertedFiles
            .slice(0, 3)
            .join("、")}${scopeRevertedFiles.length > 3 ? " 等" : ""}。`
        : "";
      if (!summary.changedFiles.length) {
        setStatus(scopeNotice || "Codex 已完成，没有文件变化。");
      } else if (recompileError) {
        setStatus(`Codex 修改已应用，但自动编译启动失败：${recompileError}${scopeNotice ? ` ${scopeNotice}` : ""}`);
      } else if (recompileResult) {
        setStatus(
          `${recompileResult.success ? "Codex 修改已应用并重新编译完成。" : "Codex 修改已应用，但重新编译仍有错误。"}${scopeNotice ? ` ${scopeNotice}` : ""}`,
        );
      } else {
        setStatus(`Codex 修改已应用。${scopeNotice ? ` ${scopeNotice}` : ""}`);
      }
    } catch (error) {
      setStatus(codexCancelRequestedRef.current ? "Codex 已取消。" : errorMessage(error));
    } finally {
      setIsCodexRunning(false);
      setIsCodexCancelling(false);
    }
  }

  async function runCodexAskPrompt(prompt: string, displayPrompt = prompt) {
    if (!project || !prompt.trim()) return;
    await saveOpenTabsWithHistory("Codex 提问前保存");
    setCodexPrompt("");
    setPinnedCodexContext(null);
    setCodexConversationPrompt(displayPrompt.trim());
    setCodexRunMode("ask");
    setIsCodexRunning(true);
    setIsCodexCancelling(false);
    codexCancelRequestedRef.current = false;
    setCodexEvents([]);
    setCodexAnswer("");
    setDiffSummary(null);
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    try {
      const result = await runCodexAsk({
        projectRoot: project.root,
        prompt,
      });
      setCodexAnswer(result.response);
      setStatus("Codex 分析完成。");
    } catch (error) {
      setStatus(codexCancelRequestedRef.current ? "Codex 已取消。" : errorMessage(error));
    } finally {
      setIsCodexRunning(false);
      setIsCodexCancelling(false);
    }
  }

  async function handleFixCompileWithCodex(result: CompileResult) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const sourceContext = await buildDiagnosticSourceContext(project, result.diagnostics);
    const prompt = buildCompileFixPrompt(project, result, sourceContext);
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    const allowedFiles = codexAllowedFilesForDiagnostics(project, result.diagnostics, allProjectFiles);
    await runCodexPrompt(await prepareCodexPrompt(prompt), prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `编译诊断相关文件：${allowedFiles.length} 个` : undefined,
    });
  }

  async function handleExplainCompileWithCodex(result: CompileResult) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const sourceContext = await buildDiagnosticSourceContext(project, result.diagnostics);
    const prompt = buildCompileExplainPrompt(project, result, sourceContext);
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    await runCodexAskPrompt(await prepareCodexPrompt(prompt), prompt);
  }

  async function handleFixDiagnosticWithCodex(result: CompileResult, diagnostic: Diagnostic) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const sourceContext = await buildDiagnosticSourceContext(project, [diagnostic, ...result.diagnostics]);
    const prompt = buildDiagnosticFixPrompt(project, result, diagnostic, sourceContext);
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    await handleDiagnosticClick(diagnostic);
    const allowedFiles = codexAllowedFilesForDiagnostics(project, [diagnostic], allProjectFiles);
    await runCodexPrompt(await prepareCodexPrompt(prompt), prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `当前诊断文件：${allowedFiles.join("、")}` : undefined,
    });
  }

  async function handleExplainDiagnosticWithCodex(result: CompileResult, diagnostic: Diagnostic) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const sourceContext = await buildDiagnosticSourceContext(project, [diagnostic, ...result.diagnostics]);
    const prompt = buildDiagnosticExplainPrompt(project, result, diagnostic, sourceContext);
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    await handleDiagnosticClick(diagnostic);
    await runCodexAskPrompt(await prepareCodexPrompt(prompt), prompt);
  }

  async function handleFixTodoWithCodex(item: ProjectTodo) {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    if (item.resolved) {
      setStatus("这条批注已经解决；需要继续处理时请先恢复。");
      return;
    }
    await saveOpenTabsWithHistory("Codex 批注前保存");
    const sourceContext = todoSourceSnippet(item.file, await readFile(project.root, item.file), item.line);
    const prompt = buildTodoFixPrompt(project, item, sourceContext);
    const projectContext = buildCodexProjectContext(
      project,
      projectSettings,
      projectOverview,
      projectPreambleContext,
      projectLocalStyleContexts,
      projectMacroSummaries,
      projectDocumentFiles,
      projectDependencies,
      files,
      outline,
      projectSymbols,
      projectTodos,
      projectReferenceIssues,
      compileResult,
      tabs,
    );
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    await openTextFile(item.file, { line: item.line });
    const allowedFiles = codexAllowedFilesForTodos([item], allProjectFiles);
    await runCodexPrompt(projectContext ? `${prompt}\n\n${projectContext}` : prompt, prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `当前批注文件：${allowedFiles.join("、")}` : undefined,
    });
  }

  async function handleFixAllTodosWithCodex() {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const unresolvedTodos = pendingProjectTodos;
    if (!unresolvedTodos.length) {
      setStatus("暂无未解决批注可交给 Codex。");
      return;
    }

    await saveOpenTabsWithHistory("Codex 批量批注前保存");
    const sourceContexts: string[] = [];
    const contentByFile = new Map<string, string>();
    for (const item of unresolvedTodos.slice(0, MAX_CODEX_TODO_SOURCE_SNIPPETS)) {
      try {
        let fileContent = contentByFile.get(item.file);
        if (fileContent === undefined) {
          fileContent = await readFile(project.root, item.file);
          contentByFile.set(item.file, fileContent);
        }
        const snippet = todoSourceSnippet(item.file, fileContent, item.line);
        if (snippet) sourceContexts.push(snippet);
      } catch {
        sourceContexts.push(`${item.file}:${item.line}\nUnable to read this source file before running Codex.`);
      }
    }

    const prompt = buildTodosFixPrompt(project, unresolvedTodos, sourceContexts);
    const projectContext = buildCodexProjectContext(
      project,
      projectSettings,
      projectOverview,
      projectPreambleContext,
      projectLocalStyleContexts,
      projectMacroSummaries,
      projectDocumentFiles,
      projectDependencies,
      files,
      outline,
      projectSymbols,
      projectTodos,
      projectReferenceIssues,
      compileResult,
      tabs,
    );
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    setShowResolvedTodos(false);
    await openTextFile(unresolvedTodos[0].file, { line: unresolvedTodos[0].line });
    const allowedFiles = codexAllowedFilesForTodos(unresolvedTodos, allProjectFiles);
    await runCodexPrompt(projectContext ? `${prompt}\n\n${projectContext}` : prompt, prompt, {
      allowedFiles,
      scopeLabel: allowedFiles.length ? `未解决批注文件：${allowedFiles.length} 个` : undefined,
    });
  }

  async function handleCancelCodex() {
    if (!project || !isCodexRunning) return;
    codexCancelRequestedRef.current = true;
    setIsCodexCancelling(true);
    const cancelled = await cancelCodexRun(project.root);
    setStatus(cancelled ? "正在取消 Codex..." : "当前没有正在运行的 Codex。");
    if (!cancelled) {
      setIsCodexCancelling(false);
    }
  }

  async function handleRetryCodexRun() {
    if (!project || isCodexRunning || environment?.canRunCodex === false) return;
    const prompt = codexConversationPrompt.trim();
    if (!prompt) return;
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    if (codexRunMode === "ask") {
      await runCodexAskPrompt(await prepareCodexPrompt(prompt), prompt);
    } else {
      await runCodexPrompt(await prepareCodexPrompt(prompt), prompt);
    }
  }

  async function handleOpenCodexHistory(item: CodexHistoryItem) {
    if (!project) return;
    const summary = await getCodexDiff(project.root, item.runId);
    setDiffSummary(summary);
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    setCodexEvents([]);
    setIsCodexCollapsed(false);
    setStatus("已打开历史 Codex diff。");
  }

  function handleReuseCodexHistoryPrompt(item: CodexHistoryItem) {
    const prompt = item.promptPreview?.trim();
    if (!prompt) {
      setStatus("这条历史修改没有可复用的指令。");
      return;
    }
    setCodexPrompt(prompt);
    setIsCodexCollapsed(false);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(prompt.length, prompt.length);
      setCodexPromptCursor(prompt.length);
    });
    setStatus("已载入历史 Codex 指令，可调整后再次执行。");
  }

  function handleRevertCodex() {
    if (!project || !diffSummary?.canRevert) return;
    if (isCodexRunning) {
      setStatus("Codex 正在运行；请先终止或等待完成后再撤回。");
      return;
    }
    setIsCodexRevertConfirmVisible(true);
    setStatus("请在 Codex 面板中确认撤回。");
  }

  function handleAcceptCodexChanges() {
    const runId = diffSummary?.runId ?? null;
    setDiffSummary(null);
    setAcceptedCodexHunkKeys([]);
    setCodexEvents([]);
    setCodexAnswer("");
    setCodexConversationPrompt("");
    setCodexPrompt("");
    setIsCodexRevertConfirmVisible(false);
    setHiddenCodexHighlightRunId(runId);
    codexDecorationCollectionRef.current?.clear();
    setStatus("已确认 Codex 修改。");
  }

  function handleAcceptCodexHunk(file: string, hunk: ParsedDiffHunk, hunkIndex: number) {
    const key = codexDiffHunkKey(file, hunk);
    setAcceptedCodexHunkKeys((current) => (current.includes(key) ? current : [...current, key]));
    setStatus(`已保留 ${file} 的片段 ${hunkIndex + 1}，该片段已从待审列表隐藏。`);
  }

  function handleShowAcceptedCodexHunks() {
    setAcceptedCodexHunkKeys([]);
    setStatus("已重新显示所有 Codex 修改片段。");
  }

  function handleReviseCodexHunk(file: string, hunk: ParsedDiffHunk, hunkIndex: number) {
    if (!project) return;
    const context = codexEditorContextFromHunk(file, hunk);
    const hunkDiff = formatParsedDiffHunk({ file, lines: hunk.lines }, hunk);
    const prompt = [
      `请基于已锁定的 Codex 修改片段继续修改 @${file}。`,
      "只处理这个片段附近的源码；优先保持 LaTeX 可编译，不要扩大到无关章节、引用或格式。",
      "",
      "当前片段 diff：",
      "```diff",
      hunkDiff,
      "```",
      "",
      "你想让 Codex 怎么处理：",
      "例如：改得更学术、保留原意但更简洁、修复这段引入的编译问题。",
      "",
    ].join("\n");
    setCodexPrompt(prompt);
    setCodexPromptCursor(prompt.length);
    setPinnedCodexContext(context);
    setIsCodexContextOnlyEnabled(true);
    setIsSidebarCollapsed(false);
    setIsCodexCollapsed(false);
    setIsCodexPromptFocused(true);
    window.requestAnimationFrame(() => {
      codexPromptInputRef.current?.focus();
      codexPromptInputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
    setStatus(`已锁定 ${file} 的片段 ${hunkIndex + 1}，在输入框末尾写清要求后执行。`);
  }

  async function handleConfirmRevertCodex() {
    if (!project || !diffSummary) return;
    const runId = diffSummary.runId;
    setStatus("正在撤回 Codex 修改...");
    await saveAllOpenTabs();
    await createProjectHistorySnapshot(project.root, "撤回 Codex 修改前");
    await refreshProjectHistory(project.root);
    await revertCodexRun(project.root, runId);
    await refreshProjectFiles();
    await refreshCodexHistory();
    await reloadOpenTabsFromDisk();
    setIsCodexRevertConfirmVisible(false);
    setDiffSummary(null);
    setAcceptedCodexHunkKeys([]);
    setHiddenCodexHighlightRunId(null);
    setStatus("已撤回本次 Codex 修改。可从历史版本恢复撤回前状态。");
  }

  async function handleRevertCodexFile(file: string) {
    if (!project || !diffSummary?.canRevert) return;
    const runId = diffSummary.runId;
    setStatus(`正在撤回 Codex 对 ${file} 的修改...`);
    await saveAllOpenTabs();
    await createProjectHistorySnapshot(project.root, `撤回 Codex 对 ${file} 的修改前`);
    await refreshProjectHistory(project.root);
    const nextSummary = await revertCodexFile(project.root, runId, file);
    await refreshProjectFiles();
    await refreshCodexHistory();
    await reloadOpenTabsFromDisk();
    setDiffSummary(nextSummary.changedFiles.length ? nextSummary : null);
    setAcceptedCodexHunkKeys([]);
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    setStatus(
      nextSummary.changedFiles.length
        ? `已撤回 ${file}；本次 Codex 仍有 ${nextSummary.changedFiles.length} 个文件保留修改。`
        : "已撤回本次 Codex 的全部文件修改。",
    );
  }

  async function handleRevertCodexHunk(file: string, hunk: ParsedDiffHunk, hunkIndex: number) {
    if (!project || !diffSummary?.canRevert) return;
    const runId = diffSummary.runId;
    setStatus(`正在撤回 ${file} 的第 ${hunkIndex + 1} 个 Codex 修改片段...`);
    await saveAllOpenTabs();
    await createProjectHistorySnapshot(project.root, `撤回 Codex 对 ${file} 的片段 ${hunkIndex + 1} 前`);
    await refreshProjectHistory(project.root);
    const currentContent = await readFile(project.root, file);
    const nextContent = revertParsedDiffHunkInContent(currentContent, hunk);
    if (nextContent === currentContent) {
      setStatus("这个修改片段没有需要撤回的内容。");
      return;
    }
    await saveFile(project.root, file, nextContent);
    const nextSummary = await getCodexDiff(project.root, runId);
    await refreshProjectFiles();
    await refreshCodexHistory();
    await reloadOpenTabsFromDisk();
    setDiffSummary(nextSummary.changedFiles.length ? nextSummary : null);
    setAcceptedCodexHunkKeys((current) => current.filter((key) => key !== codexDiffHunkKey(file, hunk)));
    setHiddenCodexHighlightRunId(null);
    setIsCodexRevertConfirmVisible(false);
    setStatus(
      nextSummary.changedFiles.length
        ? `已撤回 ${file} 的片段 ${hunkIndex + 1}；本次 Codex 仍有 ${nextSummary.changedFiles.length} 个文件保留修改。`
        : "已撤回本次 Codex 的全部修改片段。",
    );
  }

  function layoutEditorToPanel() {
    const editor = editorRef.current;
    const host = editorPanelRef.current?.querySelector<HTMLElement>(".monaco-editor-host");
    if (!editor || !host) return;
    const rect = host.getBoundingClientRect();
    editor.layout({
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });
  }

  function startResize(panel: "sidebar" | "preview", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    workspaceRef.current?.classList.add("workspace-resizing");
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? sidebarWidth : previewWidth;
    let nextWidth = startWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (panel === "sidebar") {
        nextWidth = clamp(startWidth + delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        workspaceRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`);
      } else {
        const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
        const sidebarTrackWidth = isSidebarCollapsed ? 48 : sidebarWidth;
        const available =
          workspaceWidth - sidebarTrackWidth - RESIZE_HANDLE_WIDTH - RESIZE_HANDLE_WIDTH;
        const maxPreviewWidth = Math.min(
          MAX_PERSISTED_PREVIEW_WIDTH,
          Math.max(MIN_PREVIEW_WIDTH, available - MIN_EDITOR_WIDTH),
        );
        nextWidth = clamp(startWidth - delta, MIN_PREVIEW_WIDTH, maxPreviewWidth);
        workspaceRef.current?.style.setProperty("--preview-width", `${nextWidth}px`);
      }
      window.requestAnimationFrame(layoutEditorToPanel);
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      workspaceRef.current?.classList.remove("workspace-resizing");
      if (panel === "sidebar") {
        setSidebarWidth(nextWidth);
      } else {
        setPreviewWidth(nextWidth);
      }
      window.requestAnimationFrame(layoutEditorToPanel);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  }

  function handleViewModeChange(nextMode: ViewMode) {
    setViewMode(nextMode);
    if (nextMode === "preview") {
      setIsPreviewCollapsed(false);
    }
    window.requestAnimationFrame(layoutEditorToPanel);
  }

  function handleCycleViewMode() {
    handleViewModeChange(viewMode === "split" ? "preview" : viewMode === "preview" ? "editor" : "split");
  }

  function handleTogglePreviewShortcut() {
    handleViewModeChange(viewMode === "preview" ? "split" : "preview");
  }

  function applyCompileResult(result: CompileResult) {
    lastCompileFailedRef.current = !result.success;
    const nextResult = result.success ? { ...result, diagnostics: [] } : result;
    setCompileResult(nextResult);
    if (result.success) {
      setPdfRevision((value) => value + 1);
      setCompiledSourceRevision(sourceRevisionRef.current);
      setLastSuccessfulCompileAt(Date.now());
    }
  }

  async function handleDiagnosticClick(diagnostic: Diagnostic) {
    await revealDiagnosticLocation(diagnostic);
  }

  async function revealFirstCompileDiagnostic(result: CompileResult) {
    if (!project) return false;
    const diagnostic = firstNavigableDiagnostic(result, project.root);
    if (!diagnostic) return false;
    return revealDiagnosticLocation(diagnostic, { forceSplit: true });
  }

  async function revealDiagnosticLocation(diagnostic: Diagnostic, options?: { forceSplit?: boolean }) {
    if (!project || !diagnostic.file) return;
    const relative = normalizeDiagnosticPath(diagnostic.file, project.root);
    if (!relative || !isTextPath(relative)) return false;
    if (options?.forceSplit || viewMode === "preview") {
      handleViewModeChange("split");
    }
    setIsPreviewCollapsed(false);
    await openTextFile(relative, { line: diagnostic.line ?? undefined, column: diagnostic.column ?? undefined });
    return true;
  }

  async function handleCopyDiagnostic(diagnostic: Diagnostic) {
    const location = formatDiagnosticLocation(diagnostic) || "全局日志";
    const pieces = [
      `[${diagnosticSeverityLabel(diagnostic.severity)}] ${location}`,
      diagnostic.message,
    ];
    if (diagnostic.hint) {
      pieces.push(`建议：${diagnostic.hint}`);
    }
    await navigator.clipboard.writeText(pieces.join("\n"));
    setStatus("已复制当前编译诊断。");
  }

  async function handleCopyDiagnosticCommand(diagnostic: Diagnostic) {
    const command = diagnosticInstallCommand(diagnostic);
    if (!command) {
      setStatus("当前诊断没有可复制的安装命令。");
      return;
    }
    await navigator.clipboard.writeText(command);
    setStatus("已复制缺包安装命令。");
  }

  async function handleCopyCompileLog(result: CompileResult) {
    await navigator.clipboard.writeText(tailLog(result.log));
    setStatus("已复制原始编译日志。");
  }

  function dirtyTabsSnapshot() {
    const latestActiveContent = editorRef.current?.getValue() ?? content;
    return tabs
      .map((tab) =>
        tab.path === activePath
          ? { ...tab, content: latestActiveContent, dirty: tab.dirty || tab.content !== latestActiveContent }
          : tab,
      )
      .filter((tab) => tab.dirty);
  }

  function hasUnsavedTabs() {
    return dirtyTabsSnapshot().length > 0;
  }

  function exitBlockers() {
    const blockers: string[] = [];
    const dirtyCount = dirtyTabsSnapshot().length;
    if (dirtyCount) {
      blockers.push(`${dirtyCount} 个文件尚未保存`);
    }
    if (isCompiling) {
      blockers.push("LaTeX 编译仍在运行");
    }
    if (isCodexRunning) {
      blockers.push("Codex 仍在修改或分析项目");
    }
    return blockers;
  }

  function confirmDiscardUnsavedTabs(action: string) {
    const count = dirtyTabsSnapshot().length;
    if (!count) return true;
    return window.confirm(`还有 ${count} 个文件未保存，${action}会丢弃这些修改。确定继续吗？`);
  }

  const viewModeLabel = viewMode === "editor" ? "编辑" : viewMode === "preview" ? "预览" : "分屏";
  const ViewModeIcon = viewMode === "editor" ? Code2 : viewMode === "preview" ? Eye : Columns2;
  const isCodexCommandCenterActive = Boolean(
    codexPrompt.trim() ||
      isCodexRunning ||
      codexEvents.length ||
      codexAnswer ||
      diffSummary ||
      isCodexRevertConfirmVisible,
  );

  return (
    <div className="app-shell">
      {isQuickOpenVisible && (
        <div
          className="quick-open-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="快速打开文件"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsQuickOpenVisible(false);
            }
          }}
        >
          <div className="quick-open-panel">
            <input
              ref={quickOpenInputRef}
              value={quickOpenQuery}
              onChange={(event) => {
                setQuickOpenQuery(event.target.value);
                setQuickOpenIndex(0);
              }}
              placeholder="快速打开文件"
            />
            <div className="quick-open-list">
              {quickOpenFiles.length ? (
                quickOpenFiles.map((path, index) => {
                  const isCurrentFile = path === activeDisplayPath;
                  const isOpenTab = tabs.some((tab) => tab.path === path);
                  return (
                    <button
                      type="button"
                      className={[
                        "quick-open-item",
                        index === quickOpenIndex ? "quick-open-active" : "",
                        isCurrentFile ? "quick-open-current" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={path}
                      onMouseEnter={() => setQuickOpenIndex(index)}
                      onClick={() => void runSafely(() => handleQuickOpenPath(path))}
                    >
                      <span className="quick-open-file-copy">
                        <span className="quick-open-name">
                          {renderQuickOpenMatch(shortFileName(path), quickOpenQuery)}
                        </span>
                        <small>{renderQuickOpenMatch(path, quickOpenQuery)}</small>
                      </span>
                      <span className="quick-open-badges" aria-hidden={!isCurrentFile && !isOpenTab}>
                        {isCurrentFile && <span className="quick-open-badge quick-open-badge-current">当前</span>}
                        {!isCurrentFile && isOpenTab && (
                          <span className="quick-open-badge quick-open-badge-open">已打开</span>
                        )}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="quick-open-empty">没有匹配文件。</div>
              )}
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <FileText size={20} />
          </div>
          <div className="brand-copy">
            <div className="brand-title">LaTeX Studio</div>
            <div className="brand-subtitle">
              {project ? `当前文件 · ${project.mainFile}` : "本地论文写作台"}
            </div>
          </div>
        </div>
        <button
          ref={projectSummaryButtonRef}
          type="button"
          className="project-summary project-summary-button"
          title={project?.root || "打开或新建项目"}
          onClick={() => {
            setProjectNameDraft(projectSettings?.displayName ?? project?.name ?? "");
            setShowSettingsPanel(false);
            setShowProjectPanel((value) => !value);
          }}
        >
          <span>当前项目</span>
          <strong>{project?.name ?? "未打开项目"}</strong>
          <small>{activePath || "准备写作"}</small>
        </button>
        <div className="project-actions project-actions-minimal">
          <button
            type="button"
            className="primary-button topbar-compile-button"
            onClick={() => void runSafely(handleCompile)}
            disabled={!project || isCompiling || !environment?.canCompile}
            title={`编译 (${shortcuts.compile})`}
          >
            <Play size={16} />
            <span>{isCompiling ? "编译中" : "编译"}</span>
          </button>
          <button
            type="button"
            onClick={() => void runSafely(handleOpenHistoryPanel)}
            disabled={!project}
            title="历史版本"
            aria-label="历史版本"
          >
            <History size={16} />
            <span>历史</span>
          </button>
          <button
            type="button"
            className={isReviewMode ? "topbar-review-button topbar-review-button-active" : "topbar-review-button"}
            onClick={handleToggleReviewMode}
            disabled={!project}
            title={`Review 批注模式 (${shortcuts.reviewMode})；添加批注 ${shortcuts.insertReviewComment}`}
            aria-label="Review 批注模式"
          >
            <MessageSquareText size={16} />
            <span>批注</span>
          </button>
          {isReviewMode && (
            <button
              type="button"
              className="topbar-review-add-button"
              onClick={handleInsertReviewComment}
              disabled={!project || !activePath || Boolean(activeAsset)}
              title={`添加批注 (${shortcuts.insertReviewComment})`}
              aria-label="添加批注"
            >
              <Plus size={16} />
              <span>添加批注</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCycleViewMode}
            title={`切换视图 (${shortcuts.togglePreview})`}
            aria-label="切换视图"
          >
            <ViewModeIcon size={16} />
            <span>{viewModeLabel}</span>
          </button>
          <button
            ref={settingsButtonRef}
            type="button"
            onClick={() => {
              setDraftSettings(projectSettings);
              setShortcutDrafts(shortcuts);
              setShowProjectPanel(false);
              setShowSettingsPanel((value) => !value);
            }}
            disabled={!project}
            title="设置"
          >
            <Settings size={16} />
            <span>设置</span>
          </button>
        </div>
        {showProjectPanel && (
          <div className="project-popover" ref={projectPopoverRef}>
            {project && (
              <form
                className="project-name-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSafely(handleSaveProjectDisplayName);
                }}
              >
                <label>
                  <span>项目名称</span>
                  <input
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    placeholder={project.name}
                    maxLength={120}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!projectNameDraft.trim() || projectNameDraft.trim() === project.name}
                  title="只修改 LaTeX Studio 中显示的项目名称，不移动文件夹"
                >
                  <Save size={15} />
                  <span>保存名称</span>
                </button>
              </form>
            )}
            <div className="project-new-row">
              <input
                className="path-input"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runSafely(() => handleCreateProject(newProjectName));
                  }
                }}
                placeholder="新项目名；留空会自动创建 paper-..."
              />
              <button type="button" onClick={() => void runSafely(() => handleCreateProject(newProjectName))}>
                <Plus size={15} />
                <span>新建项目</span>
              </button>
            </div>
            <div className="project-path-row">
              <input
                className="path-input"
                value={projectPath}
                onChange={(event) => setProjectPath(event.target.value)}
                placeholder="粘贴已有项目文件夹路径，或输入已有项目名"
              />
              <button type="button" onClick={() => void runSafely(handleOpenProject)}>
                <FolderOpen size={15} />
                <span>打开路径</span>
              </button>
              <button type="button" onClick={() => void runSafely(handleChooseProjectFolder)}>
                <FolderOpen size={15} />
                <span>选择文件夹</span>
              </button>
            </div>
            {project && (
              <div className="project-utility-row">
                <button
                  type="button"
                  onClick={() => void runSafely(handleExportProjectZip)}
                  aria-label="导出整个项目为 ZIP"
                >
                  <Download size={15} />
                  <span>导出 ZIP</span>
                </button>
              </div>
            )}
            <div className="template-gallery" aria-label="新建项目模板">
              {PROJECT_TEMPLATES.map((template) => (
                <button
                  type="button"
                  className={`template-card ${newProjectTemplate === template.value ? "template-card-active" : ""}`}
                  key={template.value}
                  onClick={() => setNewProjectTemplate(template.value)}
                  aria-pressed={newProjectTemplate === template.value}
                >
                  <span className="template-card-title">
                    <FileText size={14} />
                    <strong>{template.label}</strong>
                  </span>
                  <span>{template.description}</span>
                  <small>{template.meta}</small>
                </button>
              ))}
            </div>
            <div className="template-preview" aria-label="模板预览">
              <div className="template-preview-copy">
                <span>当前模板</span>
                <strong>{selectedProjectTemplate.label}</strong>
                <p>{selectedProjectTemplate.useCase}</p>
                <div className="template-preview-badges" aria-label="模板特性">
                  <span>{selectedProjectTemplate.engine}</span>
                  {selectedProjectTemplate.features.map((feature) => (
                    <span key={feature}>{feature}</span>
                  ))}
                </div>
              </div>
              <div className="template-file-preview" aria-label="将创建的文件">
                {selectedProjectTemplate.files.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            </div>
            {recentProjects.length > 0 && (
              <div className="recent-projects">
                <div className="recent-title">
                  <History size={14} />
                  <span>最近项目</span>
                </div>
                {recentProjects.slice(0, 6).map((recent) => (
                  <button
                    type="button"
                    className="recent-project"
                    key={recent.root}
                    onClick={() => void runSafely(() => handleOpenRecentProject(recent))}
                    title={recent.root}
                  >
                    <strong>{recent.name}</strong>
                    <span>{recent.root}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {showWordCountPanel && wordCount && (
          <div className="word-count-popover">
            <div className="word-count-heading">
              <Hash size={16} />
              <div>
                <strong>项目字数</strong>
                <span>{project?.name ?? "当前项目"}</span>
              </div>
              <div className="word-count-heading-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void runSafely(handleCountWords)}
                  title="重新统计项目字数"
                  aria-label="重新统计项目字数"
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowWordCountPanel(false)}
                  title="关闭字数统计"
                  aria-label="关闭字数统计"
                >
                  <XCircle size={15} />
                </button>
              </div>
            </div>
            <div className="word-count-summary">
              <div>
                <strong>{wordCount.words.toLocaleString("zh-CN")}</strong>
                <span>词</span>
              </div>
              <div>
                <strong>{wordCount.characters.toLocaleString("zh-CN")}</strong>
                <span>字符</span>
              </div>
              <div>
                <strong>{wordCount.files.length}</strong>
                <span>.tex 文件</span>
              </div>
            </div>
            <div className="word-count-files">
              {wordCount.files.slice(0, 10).map((file) => (
                <button
                  type="button"
                  key={file.file}
                  onClick={() => void runSafely(() => openTextFile(file.file))}
                  title={file.file}
                >
                  <span>{file.file}</span>
                  <strong>{file.words.toLocaleString("zh-CN")}</strong>
                </button>
              ))}
              {wordCount.files.length > 10 && (
                <small>还有 {wordCount.files.length - 10} 个文件未显示。</small>
              )}
            </div>
          </div>
        )}
        {showHistoryPanel && project && (
          <div className="history-popover">
            <div className="history-heading">
              <History size={16} />
              <div>
                <strong>历史版本</strong>
                <span>手动保存/自动保存后记录</span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowHistoryPanel(false)}
                title="关闭历史版本"
                aria-label="关闭历史版本"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="history-list">
              {projectHistory.length ? (
                projectHistory.map((item) => (
                  <div
                    className={[
                      "history-item",
                      historyRestoreItem?.snapshotId === item.snapshotId ? "history-item-restore-pending" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={item.snapshotId}
                  >
                    <div>
                      <strong>{item.label}</strong>
                      <span>
                        {formatHistoryTime(item.createdAt)} · {item.fileCount} 个文件
                      </span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        onClick={() => void runSafely(() => handlePreviewHistoryDiff(item))}
                        title="查看该历史版本和当前项目的差异"
                      >
                        <Code2 size={14} />
                        <span>差异</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void runSafely(() => handleRestoreHistorySnapshot(item))}
                        title="恢复到该历史版本"
                      >
                        <Undo2 size={14} />
                        <span>恢复</span>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-log">还没有保存记录；手动保存或自动保存有变化时会出现在这里。</div>
              )}
            </div>
            {historyRestoreItem && (
              <form
                className="history-restore-panel"
                onSubmit={(event) => void runSafely(() => handleConfirmRestoreHistorySnapshot(event))}
              >
                <div className="history-restore-heading">
                  <AlertTriangle size={16} />
                  <div>
                    <strong>确认恢复到“{historyRestoreItem.label}”</strong>
                    <span>
                      {formatHistoryTime(historyRestoreItem.createdAt)} · {historyRestoreItem.fileCount} 个文件
                    </span>
                  </div>
                </div>
                <p>
                  当前项目会回到这个历史版本；恢复前会自动保存一个“恢复前”历史版本，方便回退。
                </p>
                {dirtyTabCount > 0 && (
                  <div className="history-restore-warning">
                    <AlertTriangle size={14} />
                    <span>{dirtyTabCount} 个未保存文件会先保存，再执行恢复。</span>
                  </div>
                )}
                <div className="history-restore-actions">
                  <button type="button" onClick={() => setHistoryRestoreItem(null)}>
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void runSafely(() => handlePreviewHistoryDiff(historyRestoreItem))}
                  >
                    <Code2 size={14} />
                    <span>查看差异</span>
                  </button>
                  <button type="submit" className="history-restore-confirm">
                    <Undo2 size={14} />
                    <span>确认恢复</span>
                  </button>
                </div>
              </form>
            )}
            {historyDiffItem && historyDiffSummary && (
              <div className="history-diff-panel">
                <div className="history-diff-heading">
                  <strong>{historyDiffItem.label}</strong>
                  <span>当前项目相对此历史版本的差异</span>
                </div>
                <CodexDiffView
                  summary={historyDiffSummary}
                  onOpenTarget={(file, line) => void runSafely(() => handleOpenDiffTarget(file, line))}
                  onCopyDiff={(text, label) => void runSafely(() => handleCopyDiffText(text, label))}
                  summaryHint="恢复历史版本会回到左侧旧内容；当前新增内容显示为绿色。"
                  emptyText="当前项目与这个历史版本没有文件差异。"
                />
              </div>
            )}
          </div>
        )}
        {showSettingsPanel && draftSettings && (
          <div className="settings-popover" ref={settingsPopoverRef}>
            <div className="settings-heading">
              <Settings size={16} />
              <div>
                <strong>项目设置</strong>
                <span>{project?.name ?? "未打开项目"}</span>
              </div>
            </div>
            <label className="settings-field">
              <span>项目名</span>
              <input
                value={draftSettings.displayName ?? project?.name ?? ""}
                onChange={(event) =>
                  setDraftSettings((current) =>
                    current ? { ...current, displayName: event.target.value } : current,
                  )
                }
                placeholder={project?.name ?? "LaTeX Project"}
              />
            </label>
            <label className="settings-field">
              <span>主文件</span>
              <select
                value={draftSettings.mainFile}
                onChange={(event) =>
                  setDraftSettings((current) =>
                    current ? { ...current, mainFile: event.target.value } : current,
                  )
                }
              >
                {texFiles.includes(draftSettings.mainFile) ? null : (
                  <option value={draftSettings.mainFile}>{draftSettings.mainFile}</option>
                )}
                {texFiles.map((file) => (
                  <option value={file} key={file}>
                    {file}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>编译引擎</span>
              <select
                value={draftSettings.engine}
                onChange={(event) =>
                  setDraftSettings((current) =>
                    current
                      ? { ...current, engine: event.target.value as ProjectSettings["engine"] }
                      : current,
                  )
                }
              >
                <option value="xelatex">XeLaTeX</option>
                <option value="pdflatex">pdfLaTeX</option>
                <option value="lualatex">LuaLaTeX</option>
              </select>
            </label>
            <label className="settings-field">
              <span>构建目录</span>
              <input
                value={draftSettings.buildDir}
                onChange={(event) =>
                  setDraftSettings((current) =>
                    current ? { ...current, buildDir: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="settings-field">
              <span>附加 latexmk 参数</span>
              <input
                value={draftSettings.compileArgs.join(" ")}
                placeholder="-bibtex -silent"
                onChange={(event) =>
                  setDraftSettings((current) =>
                    current ? { ...current, compileArgs: parseLatexmkArgs(event.target.value) } : current,
                  )
                }
              />
            </label>
            <div className="settings-hint">
              <AlertTriangle size={16} />
              <span>
                中文论文建议使用 XeLaTeX 或 LuaLaTeX。附加参数只接受安全的 latexmk 选项；
                主文件、构建目录和 shell escape 由 LaTeX Studio 管理。
              </span>
            </div>
            {selectedEngineStatus && !selectedEngineStatus.found && (
              <div className="settings-hint settings-hint-error">
                <AlertTriangle size={16} />
                <span>{selectedEngineStatus.installHint ?? `未检测到 ${selectedEngine}。`}</span>
              </div>
            )}
            <section className="settings-toggles" aria-label="自动行为设置">
              <div className="settings-toggles-heading">
                <strong>自动行为</strong>
              </div>
              <label className={`settings-toggle-row ${isAutoSaveEnabled ? "settings-toggle-row-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={isAutoSaveEnabled}
                  onChange={(event) => setIsAutoSaveEnabled(event.target.checked)}
                />
                <Save size={15} />
                <span>
                  <strong>自动保存</strong>
                  <small>停止输入后写入磁盘</small>
                </span>
              </label>
              <label
                className={[
                  "settings-toggle-row",
                  isAutoCompileEnabled ? "settings-toggle-row-on" : "",
                  environment?.canCompile === false ? "settings-toggle-row-disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  type="checkbox"
                  checked={isAutoCompileEnabled}
                  onChange={(event) => setIsAutoCompileEnabled(event.target.checked)}
                  disabled={environment?.canCompile !== true}
                />
                <RefreshCw size={15} />
                <span>
                  <strong>自动编译</strong>
                  <small>{environment?.canCompile === false ? "需要先安装 LaTeX 环境" : "保存后自动刷新 PDF"}</small>
                </span>
              </label>
            </section>
            <section className="settings-shortcuts" aria-label="快捷键设置">
              <div className="settings-shortcuts-heading">
                <div>
                  <strong>快捷键</strong>
                  <span>点击输入框后直接按新的组合键；清空会回到默认值。</span>
                </div>
                <button type="button" onClick={handleResetShortcuts}>
                  恢复默认
                </button>
              </div>
              <div className="settings-shortcuts-grid">
                {SHORTCUT_DEFINITIONS.map((shortcut) => (
                  <label className="settings-shortcut-field" key={shortcut.id}>
                    <span>
                      <strong>{shortcut.label}</strong>
                      <small>{shortcut.hint}</small>
                    </span>
                    <input
                      value={shortcutDrafts[shortcut.id] ?? DEFAULT_SHORTCUTS[shortcut.id]}
                      placeholder={DEFAULT_SHORTCUTS[shortcut.id]}
                      onChange={(event) =>
                        setShortcutDrafts((current) => ({
                          ...current,
                          [shortcut.id]: normalizeShortcutInput(event.target.value),
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Tab") return;
                        event.preventDefault();
                        if (event.key === "Backspace" || event.key === "Delete") {
                          setShortcutDrafts((current) => ({
                            ...current,
                            [shortcut.id]: "",
                          }));
                          return;
                        }
                        const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent);
                        if (nextShortcut) {
                          setShortcutDrafts((current) => ({
                            ...current,
                            [shortcut.id]: nextShortcut,
                          }));
                        }
                      }}
                    />
                  </label>
                ))}
              </div>
            </section>
            <div className="settings-actions">
              <button type="button" onClick={() => setShowSettingsPanel(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void runSafely(handleSaveProjectSettings)}
              >
                保存设置
              </button>
            </div>
          </div>
        )}
      </header>

      <main ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
        <aside className="sidebar">
          {isSidebarCollapsed ? (
            <button
              type="button"
              className="collapsed-rail"
              onClick={() => setIsSidebarCollapsed(false)}
              title="展开左侧栏"
            >
              <ChevronRight size={18} />
              <span>项目</span>
            </button>
          ) : (
            <>
              <div className="panel-title">
                <FileText size={16} />
                <div className="panel-title-copy">
                  <span>项目文件</span>
                  <small>{project?.name ?? "尚未打开项目"}</small>
                </div>
                <div className="panel-title-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => toggleProjectSearch()}
                    disabled={!project}
                    title={`项目内搜索 (${shortcuts.projectSearch})`}
                    aria-label="项目内搜索"
                  >
                    <Search size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsSidebarCollapsed(true)}
                    title="折叠左侧栏"
                    aria-label="折叠左侧栏"
                  >
                    <ChevronLeft size={16} />
                  </button>
                </div>
              </div>
              {createEntryDraft && (
                <form
                  className="project-create-pane"
                  onSubmit={(event) => void runSafely(() => handleSubmitCreateEntry(event))}
                >
                  <div className="project-create-heading">
                    <strong>{createEntryDraft.kind === "file" ? "新建文件" : "新建文件夹"}</strong>
                    <span>{createEntryDraft.parentPath || project?.name || "项目根目录"}</span>
                  </div>
                  <div className="project-create-kind" aria-label="新建类型">
                    <button
                      type="button"
                      className={createEntryDraft.kind === "file" ? "project-create-kind-active" : ""}
                      onClick={() =>
                        setCreateEntryDraft((current) =>
                          current
                            ? {
                                ...current,
                                kind: "file",
                                path: suggestedProjectEntryPath("file", current.parentPath),
                              }
                            : current,
                        )
                      }
                    >
                      <FilePlus2 size={14} />
                      <span>文件</span>
                    </button>
                    <button
                      type="button"
                      className={createEntryDraft.kind === "directory" ? "project-create-kind-active" : ""}
                      onClick={() =>
                        setCreateEntryDraft((current) =>
                          current
                            ? {
                                ...current,
                                kind: "directory",
                                path: suggestedProjectEntryPath("directory", current.parentPath),
                              }
                            : current,
                        )
                      }
                    >
                      <FolderPlus size={14} />
                      <span>文件夹</span>
                    </button>
                  </div>
                  <div className="project-create-row">
                    <input
                      ref={createEntryInputRef}
                      value={createEntryDraft.path}
                      onChange={(event) =>
                        setCreateEntryDraft((current) =>
                          current ? { ...current, path: event.target.value } : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setCreateEntryDraft(null);
                        }
                      }}
                      placeholder={
                        createEntryDraft.kind === "file"
                          ? "sections/method.tex"
                          : "figures"
                      }
                    />
                    <button type="submit" disabled={!project || !createEntryDraft.path.trim()}>
                      <Plus size={15} />
                      <span>创建</span>
                    </button>
                  </div>
                </form>
              )}
              {renameEntryDraft && (
                <form
                  className="project-rename-pane"
                  onSubmit={(event) => void runSafely(() => handleSubmitRenameEntry(event))}
                >
                  <div className="project-rename-heading">
                    <strong>重命名</strong>
                    <span title={renameEntryDraft.fromPath}>{renameEntryDraft.fromPath}</span>
                  </div>
                  <div className="project-rename-row">
                    <input
                      ref={renameEntryInputRef}
                      value={renameEntryDraft.path}
                      onChange={(event) =>
                        setRenameEntryDraft((current) =>
                          current ? { ...current, path: event.target.value } : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenameEntryDraft(null);
                        }
                      }}
                      placeholder="新的项目内路径"
                    />
                    <button
                      type="submit"
                      disabled={
                        !project ||
                        !renameEntryDraft.path.trim() ||
                        renameEntryDraft.path.trim() === renameEntryDraft.fromPath
                      }
                    >
                      <Pencil size={15} />
                      <span>重命名</span>
                    </button>
                  </div>
                  {renameDraftHasDirtyTabs && (
                    <div className="project-rename-warning">
                      <AlertTriangle size={14} />
                      <span>包含未保存修改，重命名前会先保存这些文件。</span>
                    </div>
                  )}
                </form>
              )}
              {deleteEntryDraft && (
                <form
                  className="project-delete-pane"
                  onSubmit={(event) => void runSafely(() => handleSubmitDeleteEntry(event))}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDeleteEntryDraft(null);
                    }
                  }}
                >
                  <div className="project-delete-heading">
                    <Trash2 size={15} />
                    <div>
                      <strong>删除条目</strong>
                      <span title={deleteEntryDraft.path}>{deleteEntryDraft.path}</span>
                    </div>
                  </div>
                  {deleteDraftHasDirtyTabs && (
                    <div className="project-delete-warning">
                      <AlertTriangle size={14} />
                      <span>包含未保存修改，删除后这些内存中的修改会被丢弃。</span>
                    </div>
                  )}
                  {deleteEntryDraft.isCheckingUsages && (
                    <div className="project-delete-warning">
                      <RefreshCw size={14} />
                      <span>正在检查项目中是否还有 LaTeX 文件引用它...</span>
                    </div>
                  )}
                  {!deleteEntryDraft.isCheckingUsages && deleteEntryDraft.usages.length > 0 && (
                    <div className="project-delete-usages">
                      <div className="project-delete-usages-heading">
                        <AlertTriangle size={14} />
                        <span>删除后下面这些引用会失效</span>
                      </div>
                      <div className="project-delete-usages-list">
                        {deleteEntryDraft.usages.slice(0, 6).map((usage) => (
                          <button
                            type="button"
                            key={`${usage.file}:${usage.line}:${usage.command}:${usage.path}`}
                            onClick={() => void runSafely(() => openTextFile(usage.file, { line: usage.line }))}
                            title={`打开 ${usage.file}:${usage.line}`}
                          >
                            <span>{usage.file}:{usage.line}</span>
                            <small>\{usage.command}{"{"}{usage.path}{"}"}</small>
                          </button>
                        ))}
                        {deleteEntryDraft.usages.length > 6 && (
                          <small>还有 {deleteEntryDraft.usages.length - 6} 处引用未显示。</small>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="project-delete-actions">
                    <button type="button" onClick={() => setDeleteEntryDraft(null)}>
                      取消
                    </button>
                    <button type="submit" className="project-delete-danger">
                      <Trash2 size={15} />
                      <span>确认删除</span>
                    </button>
                  </div>
                </form>
              )}
              {isSearchOpen && (
                <section className="project-search-pane">
                  <form
                    className="project-search-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runSafely(handleProjectSearch);
                    }}
                  >
                    <input
                      ref={projectSearchInputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索项目文本"
                    />
                    <button type="submit" disabled={!project || isSearching || !searchQuery.trim()}>
                      <Search size={15} />
                      <span>{isSearching ? "搜索中" : "搜索"}</span>
                    </button>
                  </form>
                  <div className="project-replace-row">
                    <input
                      value={replaceText}
                      onChange={(event) => setReplaceText(event.target.value)}
                      placeholder="替换为"
                    />
                    <button
                      type="button"
                      onClick={() => void runSafely(handleProjectReplace)}
                      disabled={!project || isReplacing || !searchQuery}
                      title="在项目内精确替换搜索文本"
                    >
                      <Pencil size={15} />
                      <span>{isReplacing ? "替换中" : "精确替换"}</span>
                    </button>
                  </div>
                  {isReplaceConfirmVisible && (
                    <div className="project-replace-confirm">
                      <div className="project-replace-confirm-heading">
                        <AlertTriangle size={15} />
                        <div>
                          <strong>确认全项目替换</strong>
                          <span>
                            {searchResults.length
                              ? `当前搜索结果 ${searchResults.length} 处`
                              : "尚未搜索或没有可见结果"}
                          </span>
                        </div>
                      </div>
                      <div className="project-replace-preview">
                        <code>{searchQuery}</code>
                        <span>替换为</span>
                        <code>{replaceText || "空文本"}</code>
                      </div>
                      <p>执行前会自动保存当前项目的历史版本，替换后可从历史版本恢复。</p>
                      <div className="project-replace-confirm-actions">
                        <button type="button" onClick={() => setIsReplaceConfirmVisible(false)}>
                          取消
                        </button>
                        <button
                          type="button"
                          className="project-replace-confirm-button"
                          onClick={() => void runSafely(handleConfirmProjectReplace)}
                          disabled={isReplacing || !searchQuery.trim()}
                        >
                          <Pencil size={14} />
                          <span>{isReplacing ? "替换中" : "确认替换"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="project-search-results">
                    {projectSearchGroups.length ? (
                      projectSearchGroups.map((group) => (
                        <section className="project-search-group" key={group.file}>
                          <div className="project-search-group-title" title={group.file}>
                            <strong>{group.file}</strong>
                            <span>{group.results.length} 处</span>
                          </div>
                          {group.results.map((result, index) => (
                            <button
                              type="button"
                              className="project-search-result"
                              key={`${result.file}:${result.line}:${result.column}:${index}`}
                              onClick={() => void runSafely(() => handleSearchResultClick(result))}
                              title={`${result.file}:${result.line}`}
                            >
                              <strong>{result.line}:{result.column}</strong>
                              <span>{result.preview || "空行"}</span>
                            </button>
                          ))}
                        </section>
                      ))
                    ) : (
                      <div className="empty-log">
                        {searchQuery ? "按 Enter 搜索项目。" : "输入 label、cite、section 或关键词。"}
                      </div>
                    )}
                  </div>
                </section>
              )}
              <div className="file-tree">
                {project && files.length ? (
                  <FileTreeNode
                    node={{
                      name: project.name,
                      path: "",
                      kind: "directory",
                      children: files,
                    }}
                    isRoot
                    activePath={activeDisplayPath}
                    mainFile={project.mainFile}
                    onRootMenu={() => setShowProjectPanel(true)}
                    onSelect={(nextNode) => void runSafely(() => handleFileSelect(nextNode))}
                    onCreateEntry={(kind, parentPath) =>
                      void runSafely(() => handleCreateEntry(kind, parentPath))
                    }
                    onImportFiles={(parentPath) => void runSafely(() => handleImportFiles(parentPath))}
                    onSetMainFile={(node) => void runSafely(() => handleSetMainFile(node))}
                    onRenameEntry={(node) => void runSafely(() => handleRenameEntry(node))}
                    onDeleteEntry={(node) => void runSafely(() => handleDeleteEntry(node))}
                  />
                ) : (
                  <div className="empty-state">
                    <strong>还没有项目</strong>
                    <span>直接点“新建”会自动创建项目；也可以在“打开”里输入项目名或路径。</span>
                  </div>
                )}
              </div>
              <section
                className={[
                  "codex-command-center",
                  "codex-command-center-sidebar",
                  isCodexCommandCenterActive ? "codex-command-center-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label="Codex 命令"
              >
                <div className="codex-sidebar-title">
                  <Bot size={15} />
                  <span>Codex 修改</span>
                  {codexContextTitleHint && (
                    <small
                      className={[
                        "codex-context-line",
                        pinnedCodexContext ? "codex-context-line-pinned" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={codexContextTitleHint}
                    >
                      {codexContextTitleHint}
                    </small>
                  )}
                  <div className="codex-sidebar-actions">
                    {pinnedCodexContext && (
                      <button
                        type="button"
                        className="codex-context-clear"
                        onClick={() => {
                          setPinnedCodexContext(null);
                          setStatus("已取消锁定 Codex 上下文。");
                        }}
                        title="取消锁定 Codex 上下文"
                        aria-label="取消锁定 Codex 上下文"
                      >
                        <XCircle size={12} />
                      </button>
                    )}
                    {codexReviewBadgeCount ? <small title={codexReviewBadgeTitle}>{codexReviewBadgeCount}</small> : null}
                  </div>
                </div>
                {isCodexCommandCenterActive && (
                  <div className="codex-command-output">
                    {environment?.canRunCodex === false ? (
                      <div className="empty-log">{environment.codex.installHint ?? "未检测到 Codex CLI。"}</div>
                    ) : (
                      <>
                        {!isCodexRunning && diffSummary?.canRevert && isCodexRevertConfirmVisible && (
                          <div className="codex-revert-confirm" role="group" aria-label="确认撤回 Codex 修改">
                            <div className="codex-revert-heading">
                              <Undo2 size={16} />
                              <div>
                                <strong>确认撤回本次 Codex 修改</strong>
                                <span>{diffSummary.changedFiles.length} 个文件将回到本次修改前。</span>
                              </div>
                            </div>
                            <p>撤回前会自动保存一个“撤回 Codex 修改前”的历史版本，方便恢复当前状态。</p>
                            {dirtyTabCount > 0 && (
                              <div className="codex-revert-warning">
                                <AlertTriangle size={14} />
                                <span>{dirtyTabCount} 个未保存文件会先保存，再执行撤回。</span>
                              </div>
                            )}
                            <div className="codex-revert-actions">
                              <button type="button" onClick={() => setIsCodexRevertConfirmVisible(false)}>
                                取消
                              </button>
                              <button
                                type="button"
                                className="codex-revert-danger"
                                onClick={() => void runSafely(handleConfirmRevertCodex)}
                                disabled={isCodexRunning}
                              >
                                <Undo2 size={14} />
                                <span>确认撤回</span>
                              </button>
                            </div>
                          </div>
                        )}
                        {diffSummary ? (
                          <>
                            {(codexConversationPrompt || codexEvents.length > 0) && (
                              <CodexProgressView
                                events={codexEvents}
                                prompt={codexConversationPrompt}
                                changedFiles={diffSummary.changedFiles}
                                isRunning={isCodexRunning}
                                isCancelling={isCodexCancelling}
                                mode={codexRunMode}
                                onCancel={() => void runSafely(handleCancelCodex)}
                                onRetry={() => void runSafely(handleRetryCodexRun)}
                              />
                            )}
                            <div className="codex-accept-row">
                              <div>
                                <strong>
                                  {codexReviewStats && codexReviewStats.totalHunks > 0
                                    ? codexReviewStats.pendingHunks > 0
                                      ? `${codexReviewStats.pendingHunks} 个片段待审`
                                      : "所有片段已保留"
                                    : `${diffSummary.changedFiles.length} 个文件发生变化`}
                                </strong>
                                <span>
                                  {codexReviewStats && codexReviewStats.totalHunks > 0
                                    ? `${diffSummary.changedFiles.length} 个文件发生变化，${codexReviewStats.acceptedHunks} 个片段已保留。确认后隐藏 diff 和编辑器高亮。`
                                    : "确认后隐藏 diff 和编辑器高亮，修改会保留在项目中。"}
                                </span>
                              </div>
                              <button type="button" className="primary-button" onClick={handleAcceptCodexChanges}>
                                <CheckCircle2 size={14} />
                                <span>确认修改</span>
                              </button>
                            </div>
                            <CodexDiffView
                              summary={diffSummary}
                              acceptedHunkKeys={acceptedCodexHunkKeys}
                              onOpenTarget={(file, line) => void runSafely(() => handleOpenDiffTarget(file, line))}
                              onCopyDiff={(text, label) => void runSafely(() => handleCopyDiffText(text, label))}
                              onAcceptHunk={handleAcceptCodexHunk}
                              onReviseHunk={handleReviseCodexHunk}
                              onClearAcceptedHunks={handleShowAcceptedCodexHunks}
                              onRevertFile={(file) => void runSafely(() => handleRevertCodexFile(file))}
                              onRevertHunk={(file, hunk, hunkIndex) =>
                                void runSafely(() => handleRevertCodexHunk(file, hunk, hunkIndex))
                              }
                            />
                          </>
                        ) : codexAnswer ? (
                          <div className="codex-answer">
                            <div className="codex-answer-header">
                              <div className="codex-answer-title">Codex 输出</div>
                              <div className="codex-answer-actions">
                                <button
                                  type="button"
                                  onClick={() => void runSafely(handleCopyCodexAnswer)}
                                  title="复制 Codex 回答"
                                  aria-label="复制 Codex 回答"
                                >
                                  <Clipboard size={13} />
                                  <span>复制</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleUseCodexAnswerAsEditPrompt}
                                  title="把回答转成修改指令"
                                  aria-label="把回答转成修改指令"
                                >
                                  <Pencil size={13} />
                                  <span>转为修改</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleInsertCodexAnswerAsReviewComment}
                                  title="把回答插入为 REVIEW 批注"
                                  aria-label="把回答插入为 REVIEW 批注"
                                >
                                  <MessageSquareText size={13} />
                                  <span>转为批注</span>
                                </button>
                              </div>
                            </div>
                            <pre>{codexAnswer}</pre>
                          </div>
                        ) : codexEvents.length ? (
                          <CodexProgressView
                            events={codexEvents}
                            prompt={codexConversationPrompt}
                            changedFiles={[]}
                            isRunning={isCodexRunning}
                            isCancelling={isCodexCancelling}
                            mode={codexRunMode}
                            onCancel={() => void runSafely(handleCancelCodex)}
                            onRetry={() => void runSafely(handleRetryCodexRun)}
                          />
                        ) : codexHistory.length > 0 ? (
                          <div className="codex-history">
                            <div className="codex-history-title">历史修改</div>
                            {codexHistory.slice(0, 4).map((item) => (
                              <div className="codex-history-item" key={item.runId}>
                                <button
                                  type="button"
                                  className="codex-history-main"
                                  onClick={() => void runSafely(() => handleOpenCodexHistory(item))}
                                  title={item.promptPreview ? `${item.promptPreview}\n${item.runId}` : `打开 ${item.runId}`}
                                >
                                  <span>{formatCodexHistoryTime(item.createdAt)}</span>
                                  <strong>{item.changedFiles.length} 个文件</strong>
                                  <small className="codex-history-prompt">{item.promptPreview || "未记录指令"}</small>
                                  {item.finalMessage && (
                                    <small className="codex-history-message">{item.finalMessage}</small>
                                  )}
                                  <small className="codex-history-files">
                                    {item.changedFiles.slice(0, 2).join(", ") || item.runId}
                                  </small>
                                </button>
                                <button
                                  type="button"
                                  className="codex-history-reuse"
                                  onClick={handleReuseCodexHistoryPrompt.bind(null, item)}
                                  disabled={!item.promptPreview}
                                  title={item.promptPreview ? "复用这条 Codex 指令" : "这条历史没有可复用指令"}
                                  aria-label="复用历史 Codex 指令"
                                >
                                  <Pencil size={13} />
                                  <span>复用</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
                <form
                  className="codex-command-bar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSubmitCodexPrompt) {
                      void runSafely(handleRunCodex);
                    }
                  }}
                >
                  <Bot size={16} />
                  <div className="codex-command-input-stack">
                    {hasCodexVisibleContext && (
                      <div className="codex-context-strip" aria-label="Codex 已选上下文">
                        <span className="codex-context-strip-label">上下文</span>
                        {pinnedCodexContext && (
                          <span className="codex-context-chip codex-context-chip-pinned">
                            <button
                              type="button"
                              className="codex-context-chip-main"
                              onClick={() => void runSafely(() => openTextFile(pinnedCodexContext.file, { line: pinnedCodexContext.cursorLine }))}
                              title={formatCodexContextHint(pinnedCodexContext)}
                            >
                              <LocateFixed size={12} />
                              <span>{codexContextKindLabel(pinnedCodexContext)}</span>
                              <small>{shortFileName(pinnedCodexContext.file)}:{pinnedCodexContext.cursorLine}</small>
                            </button>
                            <button
                              type="button"
                              className="codex-context-chip-remove"
                              onClick={() => {
                                setPinnedCodexContext(null);
                                setStatus("已取消锁定 Codex 上下文。");
                              }}
                              title="清除锁定上下文"
                              aria-label="清除锁定上下文"
                            >
                              <XCircle size={12} />
                            </button>
                          </span>
                        )}
                        {codexPromptReferencedFiles.map((path) => (
                          <span className="codex-context-chip codex-context-chip-file" key={`file:${path}`}>
                            <button
                              type="button"
                              className="codex-context-chip-main"
                              onClick={() => void runSafely(() => handleOpenCodexContextFile(path))}
                              title={`@${path}`}
                            >
                              <FileText size={12} />
                              <span>@{shortFileName(path)}</span>
                            </button>
                            <button
                              type="button"
                              className="codex-context-chip-remove"
                              onClick={() => handleRemoveCodexPromptMention("@", path)}
                              title={`移除 @${path}`}
                              aria-label={`移除 @${path}`}
                            >
                              <XCircle size={12} />
                            </button>
                          </span>
                        ))}
                        {codexPromptReferencedSymbols.map((symbol) => (
                          <span
                            className={`codex-context-chip codex-context-chip-${symbol.kind}`}
                            key={`${symbol.kind}:${symbol.key}`}
                          >
                            <button
                              type="button"
                              className="codex-context-chip-main"
                              onClick={() => void runSafely(() => handleOpenCodexContextSymbol(symbol))}
                              title={`#${symbol.key} · ${symbol.file}:${symbol.line}`}
                            >
                              <Tags size={12} />
                              <span>#{symbol.key}</span>
                            </button>
                            <button
                              type="button"
                              className="codex-context-chip-remove"
                              onClick={() => handleRemoveCodexPromptMention("#", symbol.key)}
                              title={`移除 #${symbol.key}`}
                              aria-label={`移除 #${symbol.key}`}
                            >
                              <XCircle size={12} />
                            </button>
                          </span>
                        ))}
                        {isCodexDiffContextEnabled && canUseCodexDiffContext && (
                          <span className="codex-context-chip codex-context-chip-diff">
                            <span className="codex-context-chip-static">
                              <Code2 size={12} />
                              <span>当前 diff</span>
                              <small>{diffSummary?.changedFiles.length ?? 0} 文件</small>
                            </span>
                          </span>
                        )}
                        {isCodexContextOnlyEnabled && canUseCodexContextScope && (
                          <span className="codex-context-chip codex-context-chip-scope">
                            <span className="codex-context-chip-static">
                              <LocateFixed size={12} />
                              <span>仅改上下文</span>
                              <small>{codexEditableScopeFiles.length} 文件</small>
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                    {shouldShowCodexPreflight && (
                      <div className="codex-preflight-strip" aria-label="Codex 运行前预检">
                        <span className="codex-preflight-label">预检</span>
                        {codexPreflightItems.map((item) => (
                          <span
                            className={`codex-preflight-item ${
                              item.tone ? `codex-preflight-item-${item.tone}` : ""
                            }`}
                            key={item.key}
                            title={`${item.label}：${item.detail}`}
                          >
                            <strong>{item.label}</strong>
                            <small>{item.detail}</small>
                          </span>
                        ))}
                        <span className="codex-preflight-mode">执行会修改文件；问只读分析</span>
                      </div>
                    )}
	                    <textarea
	                      ref={codexPromptInputRef}
	                      value={codexPrompt}
	                      onChange={(event) => handleCodexPromptChange(event.currentTarget)}
	                      onFocus={(event) => {
	                        setIsCodexPromptFocused(true);
	                        syncCodexPromptCursor(event.currentTarget);
	                      }}
	                      onBlur={() => setIsCodexPromptFocused(false)}
	                      onClick={(event) => syncCodexPromptCursor(event.currentTarget)}
	                      onKeyUp={(event) => syncCodexPromptCursor(event.currentTarget)}
	                      onSelect={(event) => syncCodexPromptCursor(event.currentTarget)}
	                      onKeyDown={(event) => {
	                        if (event.nativeEvent.isComposing) return;
	                        if (codexMentionSuggestions.length) {
	                          if (event.key === "ArrowDown") {
	                            event.preventDefault();
	                            setCodexMentionIndex((value) => (value + 1) % codexMentionSuggestions.length);
	                            return;
	                          }
	                          if (event.key === "ArrowUp") {
	                            event.preventDefault();
	                            setCodexMentionIndex(
	                              (value) => (value - 1 + codexMentionSuggestions.length) % codexMentionSuggestions.length,
	                            );
	                            return;
	                          }
	                          if (
	                            event.key === "Tab" ||
	                            (event.key === "Enter" &&
	                              !event.shiftKey &&
	                              !event.altKey &&
	                              !event.metaKey &&
	                              !event.ctrlKey)
	                          ) {
	                            event.preventDefault();
	                            handleInsertCodexMention();
	                            return;
	                          }
	                        }
	                        if (
	                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.altKey &&
                          !event.metaKey &&
                          !event.ctrlKey
                        ) {
                          event.preventDefault();
                          if (canSubmitCodexPrompt) {
                            void runSafely(handleRunCodex);
                          }
                          return;
                        }
                        if (event.altKey && event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                          event.preventDefault();
                          if (canSubmitCodexPrompt) {
                            void runSafely(handleAskCodex);
                          }
                          return;
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          if (canSubmitCodexPrompt) {
                            void runSafely(handleRunCodex);
                          }
                          return;
                        }
                        if (event.key === "Escape") {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder="让 Codex 修改..."
                      title={`Codex 命令条 (${shortcuts.codex} 聚焦，Enter 修改，⌥Enter 提问，Shift+Enter 换行；可用 @文件名 引用项目文件，#label/#citation 引用符号)`}
	                      disabled={!project || environment?.canRunCodex === false}
	                    />
	                    {codexMentionSuggestions.length > 0 && (
	                      <div className="codex-mention-menu" role="listbox" aria-label="Codex 上下文引用建议">
	                        <div className="codex-mention-menu-title">
	                          {codexMentionQuery?.trigger === "@" ? "项目文件" : "标签 / 引用"}
	                        </div>
	                        {codexMentionSuggestions.map((suggestion, index) => (
	                          <button
	                            type="button"
	                            key={`${suggestion.kind}:${suggestion.value}`}
	                            className={[
	                              "codex-mention-item",
	                              index === codexMentionIndex ? "codex-mention-item-active" : "",
	                            ]
	                              .filter(Boolean)
	                              .join(" ")}
	                            onMouseDown={(event) => {
	                              event.preventDefault();
	                              handleInsertCodexMention(suggestion);
	                            }}
	                            role="option"
	                            aria-selected={index === codexMentionIndex}
	                          >
	                            <span className={`codex-mention-kind codex-mention-kind-${suggestion.kind}`}>
	                              {codexMentionKindLabel(suggestion.kind)}
	                            </span>
	                            <span className="codex-mention-copy">
	                              <strong>{suggestion.title}</strong>
	                              <small>{suggestion.detail}</small>
	                            </span>
	                          </button>
	                        ))}
	                      </div>
	                    )}
	                    <div className="codex-command-key-hint">
                      Enter 修改 · ⌥Enter 提问 · Shift+Enter 换行
                    </div>
                  </div>
                  {canUseCodexDiffContext && (
                    <label
                      className={`codex-context-toggle ${isCodexDiffContextEnabled ? "codex-context-toggle-on" : ""}`}
                      title={`带上当前 diff：${codexDiffContextHint}`}
                      aria-label="带上当前 diff"
                    >
                      <input
                        type="checkbox"
                        checked={isCodexDiffContextEnabled}
                        onChange={(event) => setIsCodexDiffContextEnabled(event.target.checked)}
                      />
                      <Code2 size={13} />
                      <span>diff</span>
                    </label>
                  )}
                  {canUseCodexContextScope && (
                    <label
                      className={`codex-context-toggle codex-scope-toggle ${
                        isCodexContextOnlyEnabled ? "codex-context-toggle-on" : ""
                      }`}
                      title={`仅允许 Codex 修改上下文文件：${codexEditableScopeFiles.join("、")}`}
                      aria-label="仅改上下文文件"
                    >
                      <input
                        type="checkbox"
                        checked={isCodexContextOnlyEnabled}
                        onChange={(event) => setIsCodexContextOnlyEnabled(event.target.checked)}
                      />
                      <LocateFixed size={13} />
                      <span>仅上下文</span>
                    </label>
                  )}
                  {!isCodexRunning && diffSummary?.canRevert && (
                    <button
                      type="button"
                      className="codex-command-icon"
                      onClick={handleRevertCodex}
                      title="撤回本次 Codex 修改"
                      aria-label="撤回本次 Codex 修改"
                    >
                      <Undo2 size={16} />
                    </button>
                  )}
                  {isCodexRunning ? (
                    <span
                      className="codex-running-sr-status"
                      aria-live="polite"
                      aria-label="Codex 运行状态"
                    >
                      Codex 正在运行，可在上方运行卡片中终止。
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="codex-command-ask"
                        onClick={() => void runSafely(handleAskCodex)}
                        disabled={!canSubmitCodexPrompt}
                        title="只问 Codex，不修改文件 (⌥Enter)"
                        aria-label="只问 Codex，不修改文件"
                      >
                        <Search size={15} />
                        <span>问</span>
                      </button>
                      <button
                        type="submit"
                        className="primary-button codex-command-submit"
                        disabled={!canSubmitCodexPrompt}
                        title="执行 Codex 修改"
                      >
                        <CornerDownLeft size={16} />
                        <span>执行</span>
                      </button>
                    </>
                  )}
                </form>
              </section>
              <section className={`outline-pane ${isOutlineCollapsed ? "outline-pane-collapsed" : ""}`}>
                <div className="dock-title">
                  <ListTree size={15} />
                  <span>文档大纲</span>
                  {!isOutlineCollapsed && <small>{outline.length || 0}</small>}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsOutlineCollapsed((value) => !value)}
                    title={isOutlineCollapsed ? "展开大纲" : "折叠大纲"}
                    aria-label={isOutlineCollapsed ? "展开大纲" : "折叠大纲"}
                  >
                    {isOutlineCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {!isOutlineCollapsed && (
                  <div className="outline-panel">
                    <input
                      value={outlineQuery}
                      onChange={(event) => setOutlineQuery(event.target.value)}
                      placeholder="搜索大纲 / label"
                      disabled={!project || !outline.length}
                      aria-label="搜索文档大纲"
                    />
                    <div className="outline-list">
                      {project && visibleOutlineItems.length ? (
                        visibleOutlineItems.map((item, index) => {
                          const isActiveOutline =
                            activeOutlineItem &&
                            activeOutlineItem.file === item.file &&
                            activeOutlineItem.line === item.line &&
                            activeOutlineItem.kind === item.kind;
                          return (
                          <div
                            className={`outline-item-row ${isActiveOutline ? "outline-item-row-active" : ""}`}
                            key={`${item.file}:${item.line}:${item.kind}:${index}`}
                          >
                            <button
                              type="button"
                              className={`outline-item outline-level-${Math.min(item.level, 7)} outline-${item.kind} ${
                                isActiveOutline ? "outline-item-active" : ""
                              }`}
                              onClick={() => void runSafely(() => handleOutlineItemClick(item))}
                              title={`${item.file}:${item.line}`}
                            >
                              <span className="outline-kind">{outlineKindLabel(item.kind)}</span>
                              <span className="outline-title">{item.title || "(空标题)"}</span>
                              <span className="outline-location">{shortFileName(item.file)}:{item.line}</span>
                            </button>
                            <button
                              type="button"
                              className="outline-codex-button"
                              onClick={() => void runSafely(() => handleAddOutlineItemToCodex(item))}
                              disabled={environment?.canRunCodex === false}
                              title="加入 Codex 上下文"
                              aria-label={`把 ${outlineKindLabel(item.kind)} ${item.title || "(空标题)"} 加入 Codex 上下文`}
                            >
                              <Bot size={13} />
                            </button>
                          </div>
                        );
                        })
                      ) : (
                        <div className="empty-log">
                          {project
                            ? outlineQuery.trim()
                              ? "没有匹配的大纲项。"
                              : "暂无 section 或 label。"
                            : "打开项目后显示文档大纲。"}
                        </div>
                      )}
                      {outline.length > visibleOutlineItems.length && (
                        <small className="outline-more">
                          {outlineQuery.trim()
                            ? `已筛选 ${visibleOutlineItems.length}/${outline.length} 项。`
                            : `还有 ${outline.length - visibleOutlineItems.length} 个大纲项未显示。`}
                        </small>
                      )}
                    </div>
                  </div>
                )}
              </section>
              <section className={`structure-pane ${isStructureCollapsed ? "structure-pane-collapsed" : ""}`}>
                <div className="dock-title">
                  <Code2 size={15} />
                  <span>项目结构</span>
                  {!isStructureCollapsed && (
                    <small>
                      {projectDocumentFiles.length}/{projectDependencies.length}
                    </small>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsStructureCollapsed((value) => !value)}
                    title={isStructureCollapsed ? "展开项目结构" : "折叠项目结构"}
                    aria-label={isStructureCollapsed ? "展开项目结构" : "折叠项目结构"}
                  >
                    {isStructureCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {!isStructureCollapsed && (
                  <div className="structure-panel">
                    <div className="structure-group">
                      <div className="structure-heading">
                        <span>文档顺序</span>
                        <small>{projectDocumentFiles.length}</small>
                      </div>
                      {project && visibleStructureDocuments.length ? (
                        <div className="structure-list">
                          {visibleStructureDocuments.map((file, index) => (
                            <div className="structure-row" key={`${file}:${index}`}>
                              <button
                                type="button"
                                className={`structure-document ${file === activePath ? "structure-document-active" : ""}`}
                                onClick={() => void runSafely(() => openProjectPathFromEditor(file))}
                                title={file}
                              >
                                <span>{index + 1}</span>
                                <strong>{shortFileName(file)}</strong>
                                <small>{file}</small>
                              </button>
                              <button
                                type="button"
                                className="structure-codex-button"
                                onClick={() => handleAddProjectDocumentToCodex(file)}
                                disabled={environment?.canRunCodex === false}
                                title="加入 Codex 上下文"
                                aria-label={`把 ${file} 加入 Codex 上下文`}
                              >
                                <Bot size={13} />
                              </button>
                            </div>
                          ))}
                          {projectDocumentFiles.length > visibleStructureDocuments.length && (
                            <small className="structure-more">
                              还有 {projectDocumentFiles.length - visibleStructureDocuments.length} 个文档文件未显示。
                            </small>
                          )}
                        </div>
                      ) : (
                        <div className="empty-log">暂无可展示的文档顺序。</div>
                      )}
                    </div>
                    <div className="structure-group">
                      <div className="structure-heading">
                        <span>文件引用</span>
                        <small>{projectDependencies.length}</small>
                      </div>
                      {project && visibleStructureDependencies.length ? (
                        <div className="structure-list">
                          {visibleStructureDependencies.map((dependency, index) => (
                            <div
                              className="structure-row"
                              key={`${dependency.sourceFile}:${dependency.line}:${dependency.command}:${dependency.target}:${index}`}
                            >
                              <button
                                type="button"
                                className={[
                                  "structure-dependency",
                                  dependency.resolvedPath ? "structure-dependency-resolved" : "structure-dependency-missing",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onClick={() => void runSafely(() => handleProjectDependencyClick(dependency))}
                                title={`${dependency.sourceFile}:${dependency.line} \\${dependency.command}{${dependency.target}}`}
                              >
                                <span className="structure-kind">{projectDependencyKindLabel(dependency.kind)}</span>
                                <strong>{dependency.resolvedPath ? shortFileName(dependency.resolvedPath) : dependency.target}</strong>
                                <small>
                                  {shortFileName(dependency.sourceFile)}:{dependency.line}
                                  {dependency.resolvedPath ? ` -> ${dependency.resolvedPath}` : " -> 未找到"}
                                </small>
                              </button>
                              <button
                                type="button"
                                className="structure-codex-button"
                                onClick={() => handleAddProjectDependencyToCodex(dependency)}
                                disabled={environment?.canRunCodex === false}
                                title="加入 Codex 上下文"
                                aria-label={`把 ${dependency.sourceFile}:${dependency.line} 的文件引用加入 Codex 上下文`}
                              >
                                <Bot size={13} />
                              </button>
                            </div>
                          ))}
                          {projectDependencies.length > visibleStructureDependencies.length && (
                            <small className="structure-more">
                              还有 {projectDependencies.length - visibleStructureDependencies.length} 个文件引用未显示。
                            </small>
                          )}
                        </div>
                      ) : (
                        <div className="empty-log">暂无 LaTeX 文件引用。</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
              <section className={`todos-pane ${isTodosCollapsed ? "todos-pane-collapsed" : ""}`}>
                <div className="dock-title">
                  <MessageSquareText size={15} />
                  <span>待办批注</span>
                  {!isTodosCollapsed && <small>{pendingProjectTodos.length}/{projectTodos.length || 0}</small>}
                  {!isTodosCollapsed && pendingProjectTodos.length > 0 && (
                    <button
                      type="button"
                      className="todo-batch-codex-button"
                      onClick={() => void runSafely(handleFixAllTodosWithCodex)}
                      disabled={isCodexRunning || environment?.canRunCodex === false}
                      title={`让 Codex 处理全部 ${pendingProjectTodos.length} 条未解决批注`}
                      aria-label="让 Codex 处理全部未解决批注"
                    >
                      <Bot size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsTodosCollapsed((value) => !value)}
                    title={isTodosCollapsed ? "展开待办批注" : "折叠待办批注"}
                    aria-label={isTodosCollapsed ? "展开待办批注" : "折叠待办批注"}
                  >
                    {isTodosCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {!isTodosCollapsed && (
                  <div className="todo-list">
                    <div className="todo-filter-row" aria-label="批注筛选">
                      <button
                        type="button"
                        className={!showResolvedTodos ? "todo-filter-active" : ""}
                        onClick={() => setShowResolvedTodos(false)}
                      >
                        待处理
                        <span>{pendingProjectTodos.length}</span>
                      </button>
                      <button
                        type="button"
                        className={showResolvedTodos ? "todo-filter-active" : ""}
                        onClick={() => setShowResolvedTodos(true)}
                      >
                        已解决
                        <span>{resolvedProjectTodos.length}</span>
                      </button>
                    </div>
                    {project && visibleProjectTodos.length ? (
                      visibleProjectTodos.map((item, index) => (
                        <div
                          className={`todo-item todo-${item.kind.toLowerCase()} ${item.resolved ? "todo-resolved" : ""}`}
                          key={`${item.file}:${item.line}:${item.kind}:${index}`}
                        >
                          <button
                            type="button"
                            className="todo-main"
                            onClick={() => void runSafely(() => handleTodoClick(item))}
                            title={`${item.file}:${item.line}`}
                          >
                            <span className="todo-kind">{todoKindLabel(item.kind)}</span>
                            <span className="todo-message">{item.message}</span>
                            <span className="todo-location">{shortFileName(item.file)}:{item.line}</span>
                          </button>
                          {item.resolved ? (
                            <button
                              type="button"
                              className="todo-restore-button"
                              onClick={() => void runSafely(() => handleRestoreTodoComment(item))}
                              title="恢复这条已解决批注"
                              aria-label={`恢复 ${item.file}:${item.line} 的已解决批注`}
                            >
                              <RefreshCcw size={14} />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="todo-context-button"
                                onClick={() => void runSafely(() => handleAddTodoToCodex(item))}
                                disabled={environment?.canRunCodex === false}
                                title="加入 Codex 上下文"
                                aria-label={`把 ${item.file}:${item.line} 的批注加入 Codex 上下文`}
                              >
                                <Code2 size={14} />
                              </button>
                              <button
                                type="button"
                                className="todo-codex-button"
                                onClick={() => void runSafely(() => handleFixTodoWithCodex(item))}
                                disabled={isCodexRunning || environment?.canRunCodex === false}
                                title="让 Codex 处理这条待办"
                                aria-label={`让 Codex 处理 ${item.file}:${item.line} 的待办`}
                              >
                                <Bot size={14} />
                              </button>
                              <button
                                type="button"
                                className="todo-resolve-button"
                                onClick={() => void runSafely(() => handleResolveTodoComment(item))}
                                title="标记这条批注为完成"
                                aria-label={`完成 ${item.file}:${item.line} 的批注`}
                              >
                                <CheckCircle2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="empty-log">
                        {project
                          ? showResolvedTodos
                            ? "暂无已解决批注。"
                            : "暂无未解决 % TODO / FIXME / NOTE 批注。"
                          : "打开项目后显示待办批注。"}
                      </div>
                    )}
                    {project && (showResolvedTodos ? resolvedProjectTodos : pendingProjectTodos).length > visibleProjectTodos.length && (
                      <small className="todo-more">
                        还有 {(showResolvedTodos ? resolvedProjectTodos : pendingProjectTodos).length - visibleProjectTodos.length} 条批注未显示。
                      </small>
                    )}
                  </div>
                )}
              </section>
              <section className={`symbols-pane ${isSymbolsCollapsed ? "symbols-pane-collapsed" : ""}`}>
                <div className="dock-title">
                  <Tags size={15} />
                  <span>引用与标签</span>
                  {!isSymbolsCollapsed && <small>{projectSymbols.length || 0}</small>}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsSymbolsCollapsed((value) => !value)}
                    title={isSymbolsCollapsed ? "展开引用与标签" : "折叠引用与标签"}
                    aria-label={isSymbolsCollapsed ? "展开引用与标签" : "折叠引用与标签"}
                  >
                    {isSymbolsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {!isSymbolsCollapsed && (
                  <div className="symbols-panel">
                    {project && projectReferenceIssues.length > 0 && (
                      <div className="reference-issues">
                        <div className="reference-issues-title">
                          <AlertTriangle size={13} />
                          <span>缺失引用</span>
                          <small>{projectReferenceIssues.length}</small>
                          <button
                            type="button"
                            className="reference-issues-codex-all"
                            onClick={() => void runSafely(handleFixAllReferenceIssuesWithCodex)}
                            disabled={isCodexRunning || environment?.canRunCodex === false}
                            title="让 Codex 批量修复缺失引用"
                            aria-label="让 Codex 批量修复缺失引用"
                          >
                            <Bot size={13} />
                            <span>修全部</span>
                          </button>
                        </div>
                        <div className="reference-issues-list">
                          {visibleReferenceIssues.map((issue, index) => (
                            <div
                              className={`reference-issue reference-issue-${issue.kind}`}
                              key={`${issue.kind}:${issue.key}:${issue.file}:${issue.line}:${index}`}
                            >
                              <button
                                type="button"
                                className="reference-issue-main"
                                onClick={() => void runSafely(() => handleReferenceIssueClick(issue))}
                                title={`${issue.file}:${issue.line}`}
                              >
                                <span>{referenceIssueKindLabel(issue.kind)}</span>
                                <strong>{issue.key}</strong>
                                <small>{shortFileName(issue.file)}:{issue.line}</small>
                              </button>
                              <button
                                type="button"
                                className="reference-issue-codex-button"
                                onClick={() => void runSafely(() => handleFixReferenceIssueWithCodex(issue))}
                                disabled={isCodexRunning || environment?.canRunCodex === false}
                                title="让 Codex 修复这条缺失引用"
                                aria-label={`让 Codex 修复 ${issue.file}:${issue.line} 的缺失${referenceIssueKindLabel(issue.kind)}`}
                              >
                                <Bot size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                        {projectReferenceIssues.length > visibleReferenceIssues.length && (
                          <small className="reference-issues-more">
                            还有 {projectReferenceIssues.length - visibleReferenceIssues.length} 个未显示。
                          </small>
                        )}
                      </div>
                    )}
                    <div className="symbols-toolbar">
                      <input
                        value={symbolQuery}
                        onChange={(event) => setSymbolQuery(event.target.value)}
                        placeholder="搜索 cite / label"
                        disabled={!project}
                      />
                      <button
                        type="button"
                        onClick={handleStartBibEntryDraft}
                        disabled={!project}
                        title="新增 BibTeX 条目"
                        aria-label="新增 BibTeX 条目"
                      >
                        <Plus size={13} />
                        <span>BibTeX</span>
                      </button>
                    </div>
                    {bibEntryDraft && (
                      <form className="bib-entry-form" onSubmit={(event) => void runSafely(() => handleSubmitBibEntryDraft(event))}>
                        <div className="bib-entry-heading">
                          <FileText size={13} />
                          <strong>新增 BibTeX</strong>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => setBibEntryDraft(null)}
                            title="关闭新增 BibTeX"
                            aria-label="关闭新增 BibTeX"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                        <div className="bib-entry-grid">
                          <select
                            value={bibEntryDraft.entryType}
                            onChange={(event) =>
                              setBibEntryDraft((current) =>
                                current ? { ...current, entryType: event.target.value as BibEntryDraft["entryType"] } : current,
                              )
                            }
                            aria-label="BibTeX 类型"
                          >
                            <option value="article">article</option>
                            <option value="inproceedings">inproceedings</option>
                            <option value="misc">misc</option>
                          </select>
                          <input
                            value={bibEntryDraft.key}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, key: event.target.value } : current))
                            }
                            placeholder="key"
                            aria-label="BibTeX key"
                          />
                          <input
                            value={bibEntryDraft.author}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, author: event.target.value } : current))
                            }
                            placeholder="author"
                            aria-label="BibTeX author"
                          />
                          <input
                            value={bibEntryDraft.year}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, year: event.target.value } : current))
                            }
                            placeholder="year"
                            aria-label="BibTeX year"
                          />
                          <input
                            className="bib-entry-wide"
                            value={bibEntryDraft.title}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, title: event.target.value } : current))
                            }
                            placeholder="title"
                            aria-label="BibTeX title"
                          />
                          <input
                            value={bibEntryDraft.venue}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, venue: event.target.value } : current))
                            }
                            placeholder="journal / booktitle"
                            aria-label="BibTeX venue"
                          />
                          <input
                            list="project-bib-files"
                            value={bibEntryDraft.targetFile}
                            onChange={(event) =>
                              setBibEntryDraft((current) => (current ? { ...current, targetFile: event.target.value } : current))
                            }
                            placeholder="references.bib"
                            aria-label="目标 BibTeX 文件"
                          />
                          <datalist id="project-bib-files">
                            {projectBibFiles.map((file) => (
                              <option value={file} key={file} />
                            ))}
                          </datalist>
                        </div>
                        <label className="bib-entry-insert">
                          <input
                            type="checkbox"
                            checked={bibEntryDraft.insertCitation}
                            onChange={(event) =>
                              setBibEntryDraft((current) =>
                                current ? { ...current, insertCitation: event.target.checked } : current,
                              )
                            }
                          />
                          <span>创建后插入 citation</span>
                        </label>
                        <div className="bib-entry-actions">
                          <button type="button" onClick={() => setBibEntryDraft(null)}>
                            取消
                          </button>
                          <button type="submit">
                            <Plus size={13} />
                            <span>添加</span>
                          </button>
                        </div>
                      </form>
                    )}
                    <div className="symbols-list">
                      {project && visibleProjectSymbols.length ? (
                        visibleProjectSymbols.map((symbol) => {
                          const snippet = latexSnippetForSymbol(symbol);
                          return (
                            <div
                              className={`symbol-item symbol-${symbol.kind}`}
                              key={`${symbol.kind}:${symbol.key}:${symbol.file}:${symbol.line}`}
                            >
                              <button
                                type="button"
                                className="symbol-main"
                                onClick={() => void runSafely(() => handleOpenSymbol(symbol))}
                                title={`${symbol.file}:${symbol.line}`}
                              >
                                <span className="symbol-kind">{symbol.kind === "citation" ? "cite" : "ref"}</span>
                                <span className="symbol-key">{symbol.key}</span>
                                <span className="symbol-detail">
                                  {symbol.detail ?? symbol.kind} · {shortFileName(symbol.file)}:{symbol.line}
                                </span>
                              </button>
                              <div className="symbol-actions">
                                <button
                                  type="button"
                                  className="icon-button symbol-codex-button"
                                  onClick={() => void runSafely(() => handleAddSymbolToCodex(symbol))}
                                  disabled={environment?.canRunCodex === false}
                                  title="加入 Codex 上下文"
                                  aria-label={`把 ${symbol.key} 加入 Codex 上下文`}
                                >
                                  <Bot size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => void runSafely(() => handleInsertSymbol(symbol))}
                                  title={`插入 ${snippet}`}
                                  aria-label={`插入 ${snippet}`}
                                >
                                  <CornerDownLeft size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => void runSafely(() => handleCopySymbol(symbol))}
                                  title={`复制 ${snippet}`}
                                  aria-label={`复制 ${snippet}`}
                                >
                                  <Clipboard size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="empty-log">
                          {project ? "暂无 cite 或 label。" : "打开项目后显示引用与标签。"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </aside>

        <div
          className="resize-handle sidebar-resize-handle"
          role="separator"
          aria-label="调整左侧栏宽度"
          onPointerDown={(event) => startResize("sidebar", event)}
        >
          <GripVertical size={14} />
        </div>

        {showEditor && (
          <section
            ref={editorPanelRef}
            className={`editor-panel ${isEditorCompact ? "editor-panel-compact" : ""}`}
          >
            <div className="editor-toolbar">
              <div className="editor-tabs" role="tablist" aria-label="已打开文件">
                {activeAsset && (
                  <div className="editor-tab editor-tab-active editor-tab-asset" title={activeAsset.path}>
                    <button type="button" className="editor-tab-main" role="tab" aria-selected>
                      <span>{shortFileName(activeAsset.path)}</span>
                    </button>
                  </div>
                )}
                {tabs.map((tab) => (
                  <div
                    className={[
                      "editor-tab",
                      !activeAsset && tab.path === activePath ? "editor-tab-active" : "",
                      pendingCloseTabPath === tab.path ? "editor-tab-close-pending" : "",
                      hasDiagnosticsForPath(compileResult, tab.path, project?.root) ? "editor-tab-has-diagnostics" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={tab.path}
                    role="presentation"
                    title={tab.path}
                  >
                    <button
                      type="button"
                      className="editor-tab-main"
                      role="tab"
                      aria-selected={tab.path === activePath}
                      onClick={() => switchToTab(tab)}
                    >
                      <span>{shortFileName(tab.path)}</span>
                      {tab.dirty && <span className="tab-dirty-dot" aria-label="未保存" />}
                    </button>
                    <button
                      type="button"
                      className="editor-tab-close"
                      onClick={() => void runSafely(() => closeTab(tab.path))}
                      title={tab.path === activePath ? "关闭标签 (⌘W)" : "关闭标签"}
                      aria-label={`关闭 ${tab.path}`}
                    >
                      <XCircle size={13} />
                    </button>
                  </div>
                ))}
                {pendingCloseTab && (
                  <div className="editor-tab-close-confirm" role="alert">
                    <span title={pendingCloseTab.path}>{shortFileName(pendingCloseTab.path)} 未保存</span>
                    <button
                      type="button"
                      onClick={() => void runSafely(() => handleSaveAndCloseTab(pendingCloseTab.path))}
                    >
                      <Save size={13} />
                      <span>保存并关闭</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void runSafely(() => closeTab(pendingCloseTab.path, { discardDirty: true }))}
                    >
                      <XCircle size={13} />
                      <span>不保存</span>
                    </button>
                    <button type="button" onClick={() => setPendingCloseTabPath(null)}>
                      取消
                    </button>
                  </div>
                )}
                {!tabs.length && !activeAsset && <span className="editor-tab-placeholder">未打开文件</span>}
              </div>
              <div className="latex-insert-toolbar" aria-label="LaTeX 快捷插入">
                <button
                  type="button"
                  className="latex-insert-button latex-insert-context-button"
                  onClick={handleSendEditorContextToCodex}
                  disabled={!project || Boolean(activeAsset) || environment?.canRunCodex === false}
                  title={
                    editorSelectionSummary
                      ? `用 Codex 修改当前选区 (${shortcuts.codexContext})`
                      : `用 Codex 修改当前光标附近内容 (${shortcuts.codexContext})`
                  }
                  aria-label="把当前编辑器上下文发送到 Codex"
                >
                  <Bot size={14} />
                </button>
                <button
                  type="button"
                  className={
                    isReviewMode
                      ? "latex-insert-button latex-insert-review-button latex-insert-button-active"
                      : "latex-insert-button latex-insert-review-button"
                  }
                  onClick={handleToggleReviewMode}
                  disabled={!project || !activePath || Boolean(activeAsset)}
                  title={`Review 批注模式：高亮 REVIEW 内容 (${shortcuts.reviewMode})`}
                  aria-label="Review 批注模式"
                >
                  <MessageSquareText size={14} />
                  <span>批注</span>
                </button>
                <button
                  type="button"
                  className="latex-insert-button latex-insert-review-add-button"
                  onClick={handleInsertReviewComment}
                  disabled={!activePath || Boolean(activeAsset)}
                  title={`添加 Review 批注 (${shortcuts.insertReviewComment})`}
                  aria-label="添加 Review 批注"
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="latex-insert-button latex-insert-comment-button"
                  onClick={handleToggleLatexComment}
                  disabled={!activePath || Boolean(activeAsset)}
                  title="注释/取消注释选中行 (⌘/)"
                  aria-label="注释或取消注释选中行"
                >
                  <MessageSquareText size={14} />
                </button>
                <button
                  type="button"
                  className="latex-insert-button latex-insert-todo-button"
                  onClick={handleInsertTodoComment}
                  disabled={!activePath || Boolean(activeAsset)}
                  title="插入 TODO 批注"
                  aria-label="插入 TODO 批注"
                >
                  <Plus size={14} />
                </button>
                {LATEX_INSERT_ACTIONS.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <button
                      type="button"
                      className="latex-insert-button latex-insert-format-button"
                      key={action.id}
                      onClick={() => handleLatexInsertAction(action)}
                      disabled={!activePath || Boolean(activeAsset)}
                      title={action.title}
                      aria-label={action.title}
                    >
                      <ActionIcon size={14} />
                    </button>
                  );
                })}
              </div>
              <div className="toolbar-actions">
                <label
                  className={`toolbar-toggle ${isAutoSaveEnabled ? "toolbar-toggle-on" : ""}`}
                  title={isAutoSaveEnabled ? "自动保存已开启" : "自动保存已关闭"}
                >
                  <input
                    type="checkbox"
                    checked={isAutoSaveEnabled}
                    onChange={(event) => setIsAutoSaveEnabled(event.target.checked)}
                    disabled={!project}
                  />
                  <Save size={14} />
                  <span>自动保存</span>
                </label>
                <label
                  className={[
                    "toolbar-toggle",
                    isAutoCompileEnabled ? "toolbar-toggle-on" : "",
                    environment?.canCompile === false ? "toolbar-toggle-disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={
                    environment?.canCompile === false
                      ? "当前缺少 LaTeX 编译环境"
                      : isAutoCompileEnabled
                        ? "自动编译已开启"
                        : "自动编译已关闭"
                  }
                >
                  <input
                    type="checkbox"
                    checked={isAutoCompileEnabled}
                    onChange={(event) => setIsAutoCompileEnabled(event.target.checked)}
                    disabled={!project || environment?.canCompile !== true}
                  />
                  <RefreshCw size={14} />
                  <span>自动编译</span>
                </label>
                <span className={`autosave-status autosave-${autoSaveState}`}>
                  {autoSaveStatusLabel(autoSaveState, isAutoSaveEnabled)}
                </span>
                <button
                  type="button"
                  onClick={() => void runSafely(handleSave)}
                  disabled={!project || !dirtyTabCount}
                  title={dirtyTabCount > 1 ? `保存 ${dirtyTabCount} 个已修改文件 (⌘S)` : "保存修改 (⌘S)"}
                >
                  <Save size={16} />
                  <span>保存</span>
                </button>
                <button
                  type="button"
                  onClick={handleFindInCurrentFile}
                  disabled={!activePath || Boolean(activeAsset)}
                  title="当前文件查找 (⌘F)"
                  aria-label="当前文件查找"
                >
                  <Search size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleReplaceInCurrentFile}
                  disabled={!activePath || Boolean(activeAsset)}
                  title="当前文件替换 (⌘⌥F)"
                  aria-label="当前文件替换"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => adjustEditorFontSize(-1)}
                  disabled={!activePath || Boolean(activeAsset) || editorFontSize <= MIN_EDITOR_FONT_SIZE}
                  title={`减小编辑器字号（当前 ${editorFontSize}px）`}
                  aria-label="减小编辑器字号"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => adjustEditorFontSize(1)}
                  disabled={!activePath || Boolean(activeAsset) || editorFontSize >= MAX_EDITOR_FONT_SIZE}
                  title={`增大编辑器字号（当前 ${editorFontSize}px）`}
                  aria-label="增大编辑器字号"
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleGoToLine}
                  disabled={!activePath || Boolean(activeAsset)}
                  title="跳转到行号 (⌘G)"
                  aria-label="跳转到行号"
                >
                  <Hash size={16} />
                </button>
                {isGoToLineOpen && (
                  <form
                    className="go-to-line-form"
                    onSubmit={(event) => handleSubmitGoToLine(event)}
                  >
                    <input
                      ref={goToLineInputRef}
                      value={goToLineValue}
                      onChange={(event) => setGoToLineValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setIsGoToLineOpen(false);
                          editorRef.current?.focus();
                        }
                      }}
                      inputMode="numeric"
                      aria-label="跳转到行号"
                      placeholder="行号"
                    />
                    <button type="submit" title="跳转">
                      <CornerDownLeft size={14} />
                    </button>
                  </form>
                )}
                <button
                  type="button"
                  onClick={() => void runSafely(handleSyncPdfFromSource)}
                  disabled={!project || !activePath || Boolean(activeAsset) || !pdfPath}
                  title={pdfPath ? `从当前源码位置定位到 PDF (${shortcuts.syncPdf})` : "请先成功编译项目"}
                  aria-label="定位到 PDF"
                >
                  <LocateFixed size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void runSafely(handleExportPdfOutput)}
                  disabled={!project || !pdfPath}
                  title={pdfPath ? "导出 PDF" : "请先成功编译项目"}
                  aria-label="导出 PDF"
                >
                  <Download size={16} />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => void runSafely(handleCompile)}
                  disabled={!project || isCompiling || !environment?.canCompile}
                  title={dirtyTabCount ? `编译前会保存 ${dirtyTabCount} 个已修改文件 (⌘Enter)` : "编译 (⌘Enter)"}
                >
                  <Play size={16} />
                  <span>{isCompiling ? "编译中" : "编译"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void runSafely(handleCompileFromScratch)}
                  disabled={!project || isCompiling || !environment?.canCompile}
                  title="清理辅助文件并从零重新编译"
                  aria-label="从零重新编译"
                >
                  <RefreshCcw size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void runSafely(handleCancelCompile)}
                  disabled={!isCompiling}
                  title="取消编译"
                  aria-label="取消编译"
                >
                  <XCircle size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void runSafely(handleCleanBuild)}
                  disabled={!project || isCompiling}
                  title="清理构建缓存"
                  aria-label="清理构建缓存"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {activeAsset ? (
              <Suspense fallback={<AssetPreviewLoadingState />}>
                <AssetPreview
                  asset={activeAsset}
                  onInsertSnippet={handleInsertSnippetFromAsset}
                  onStatus={setStatus}
                />
              </Suspense>
            ) : (
              <div className="monaco-editor-host">
                <Editor
                  height="100%"
                  beforeMount={configureMonacoLatexTheme}
                  theme={MONACO_LATEX_THEME}
                  path={activeEditorModelPath}
                  language={activeLanguage}
                  value={content}
                  options={{
                    fontSize: editorFontSize,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    wrappingStrategy: "advanced",
                    scrollbar: {
                      horizontal: "hidden",
                      horizontalScrollbarSize: 0,
                      vertical: "auto",
                    },
                    lineNumbersMinChars: 4,
                    scrollBeyondLastLine: false,
                    automaticLayout: false,
                  }}
                  onMount={(editor, monacoApi) => {
                    editorRef.current = editor;
                    monacoRef.current = monacoApi;
                    setIsEditorReady(true);
                    window.requestAnimationFrame(layoutEditorToPanel);
                  }}
                  onChange={(value) => {
                    const nextContent = value ?? "";
                    setContent(nextContent);
                    setTabs((current) =>
                      current.map((tab) =>
                        tab.path === activePath ? { ...tab, content: nextContent, dirty: true } : tab,
                      ),
                    );
                    markSourceEdited();
                  }}
                />
              </div>
            )}
            <div className="editor-statusbar" aria-label="编辑器状态">
              <span className="editor-status-path" title={activeDisplayPath || project?.root || ""}>
                {activeDisplayPath || "未打开文件"}
              </span>
              <span>{activeAsset ? "资源预览" : activeLanguage}</span>
              {!activeAsset && (
                <span>
                  行 {editorCursorPosition.line}，列 {editorCursorPosition.column}
                </span>
              )}
              {!activeAsset && activeOutlineStatus && (
                <span className="editor-status-section" title={`${activeOutlineItem?.file}:${activeOutlineItem?.line}`}>
                  {activeOutlineStatus}
                </span>
              )}
              {!activeAsset && isReviewMode && (
                <span className="editor-status-review" role="group" aria-label="Review 批注模式">
                  <MessageSquareText size={12} />
                  <span>Review</span>
                  <button
                    type="button"
                    onClick={handleInsertReviewComment}
                    title={`在当前行或选中内容添加 REVIEW 批注 (${shortcuts.insertReviewComment})`}
                  >
                    添加批注
                  </button>
                </span>
              )}
              {!activeAsset && activeCodexChangeLines.length > 0 && (
                <span className="editor-status-codex-changes" role="group" aria-label="Codex 修改导航">
                  <span title="当前文件中仍显示的 Codex 修改高亮">
                    Codex 修改 {activeCodexChangeIndex + 1}/{activeCodexChangeLines.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleJumpToCodexChange(-1)}
                    title="上一处 Codex 修改"
                    aria-label="上一处 Codex 修改"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleJumpToCodexChange(1)}
                    title="下一处 Codex 修改"
                    aria-label="下一处 Codex 修改"
                  >
                    <ChevronRight size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={handleHideCodexHighlights}
                    title="隐藏编辑器中的 Codex 修改高亮"
                    aria-label="隐藏 Codex 修改高亮"
                  >
                    <XCircle size={12} />
                  </button>
                </span>
              )}
              {!activeAsset && editorWordSummary && <span>{editorWordSummary}</span>}
              {editorSelectionSummary && <span>{editorSelectionSummary}</span>}
              <span>{dirtyTabCount ? `${dirtyTabCount} 个未保存` : "全部已保存"}</span>
              <span className={isPdfPossiblyStale ? "editor-status-pdf-stale" : ""}>{editorCompileStatus}</span>
              <span>{selectedEngine}</span>
            </div>
          </section>
        )}

        {viewMode === "split" && (
          <div
            className="resize-handle preview-resize-handle"
            role="separator"
            aria-label="调整预览区宽度"
            onPointerDown={(event) => startResize("preview", event)}
          >
            <GripVertical size={14} />
          </div>
        )}

        {showPreview && (
          <aside className="preview-panel">
          {isPreviewCollapsed ? (
            <button
              type="button"
              className="collapsed-rail collapsed-rail-preview"
              onClick={() => setIsPreviewCollapsed(false)}
              title="展开预览区"
            >
              <ChevronLeft size={18} />
              <span>预览</span>
            </button>
          ) : (
            <>
              <div className="panel-title">
                <RefreshCw size={16} />
                <div className="panel-title-copy">
                  <span>PDF 预览</span>
                  <small className={isPdfPossiblyStale ? "preview-subtitle-stale" : ""}>{previewSubtitle}</small>
                </div>
                <div className="panel-title-actions" role="toolbar" aria-label="PDF 预览操作">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void runSafely(handleOpenPdfOutput)}
                    disabled={!project || !pdfPath}
                    title={pdfPath ? "用系统 PDF 阅读器打开" : "请先成功编译项目"}
                    aria-label="打开 PDF"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void runSafely(handleRevealPdfOutput)}
                    disabled={!project || !pdfPath}
                    title={pdfPath ? "在 Finder 中显示 PDF" : "请先成功编译项目"}
                    aria-label="在 Finder 中显示 PDF"
                  >
                    <FolderOpen size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void runSafely(handleExportPdfOutput)}
                    disabled={!project || !pdfPath}
                    title={pdfPath ? "导出 PDF" : "请先成功编译项目"}
                    aria-label="导出 PDF"
                  >
                    <Download size={16} />
                  </button>
                  {viewMode === "preview" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void runSafely(handleCompile)}
                        disabled={!project || isCompiling || !environment?.canCompile}
                        title="编译"
                      >
                        <Play size={16} />
                        <span>{isCompiling ? "编译中" : "编译"}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void runSafely(handleCompileFromScratch)}
                        disabled={!project || isCompiling || !environment?.canCompile}
                        title="清理辅助文件并从零重新编译"
                        aria-label="从零重新编译"
                      >
                        <RefreshCcw size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void runSafely(handleCleanBuild)}
                        disabled={!project || isCompiling}
                        title="清理构建缓存"
                        aria-label="清理构建缓存"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsPreviewCollapsed(true)}
                    title="折叠预览区"
                    aria-label="折叠预览区"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {environment && !environment.canCompile && (
                <div className="setup-state">
                  <AlertTriangle size={18} />
                  <span>{environment.latexmk.installHint ?? "未检测到 LaTeX 编译器。"}</span>
                </div>
              )}
              {compileResult && !compileResult.success ? (
                <CompileErrorPanel
                  result={compileResult}
                  canRunCodex={
                    Boolean(project) &&
                    !isCodexRunning &&
                    environment?.canRunCodex !== false
                  }
                  onDiagnosticClick={(diagnostic) =>
                    void runSafely(() => handleDiagnosticClick(diagnostic))
                  }
                  onCopyDiagnostic={(diagnostic) =>
                    void runSafely(() => handleCopyDiagnostic(diagnostic))
                  }
                  onCopyDiagnosticCommand={(diagnostic) =>
                    void runSafely(() => handleCopyDiagnosticCommand(diagnostic))
                  }
                  onCopyCompileLog={() =>
                    void runSafely(() => handleCopyCompileLog(compileResult))
                  }
                  onFixDiagnosticWithCodex={(diagnostic) =>
                    void runSafely(() => handleFixDiagnosticWithCodex(compileResult, diagnostic))
                  }
                  onExplainDiagnosticWithCodex={(diagnostic) =>
                    void runSafely(() => handleExplainDiagnosticWithCodex(compileResult, diagnostic))
                  }
                  onFixWithCodex={() =>
                    void runSafely(() => handleFixCompileWithCodex(compileResult))
                  }
                  onExplainWithCodex={() =>
                    void runSafely(() => handleExplainCompileWithCodex(compileResult))
                  }
                />
              ) : pdfPath ? (
                <Suspense fallback={<PdfPreviewLoadingState />}>
                  <PdfPreview
                    projectRoot={project?.root}
                    pdfPath={pdfPath}
                    revision={pdfRevision}
                    syncTarget={pdfSyncTarget}
                    onSourceSync={(page, x, y) =>
                      void runSafely(() => handleSyncSourceFromPdf(page, x, y))
                    }
                    onStatus={setStatus}
                  />
                </Suspense>
              ) : (
                <PdfPreviewEmptyState />
              )}
            </>
          )}
          </aside>
        )}
      </main>
    </div>
  );
}

function PdfPreviewEmptyState() {
  return (
    <div className="empty-preview">
      <strong>暂无 PDF</strong>
      <span>点击“编译”后会在这里预览生成的文档。</span>
    </div>
  );
}

function PdfPreviewLoadingState() {
  return (
    <div className="empty-preview">
      <strong>正在加载 PDF 预览</strong>
    </div>
  );
}

function AssetPreviewLoadingState() {
  return (
    <div className="empty-preview">
      <strong>正在加载资源预览</strong>
    </div>
  );
}

function CompileErrorPanel({
  result,
  canRunCodex,
  onDiagnosticClick,
  onCopyDiagnostic,
  onCopyDiagnosticCommand,
  onCopyCompileLog,
  onFixDiagnosticWithCodex,
  onExplainDiagnosticWithCodex,
  onFixWithCodex,
  onExplainWithCodex,
}: {
  result: CompileResult;
  canRunCodex: boolean;
  onDiagnosticClick: (diagnostic: Diagnostic) => void;
  onCopyDiagnostic: (diagnostic: Diagnostic) => void;
  onCopyDiagnosticCommand: (diagnostic: Diagnostic) => void;
  onCopyCompileLog: () => void;
  onFixDiagnosticWithCodex: (diagnostic: Diagnostic) => void;
  onExplainDiagnosticWithCodex: (diagnostic: Diagnostic) => void;
  onFixWithCodex: () => void;
  onExplainWithCodex: () => void;
}) {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const visibleDiagnostics = errors.length ? errors : result.diagnostics;
  const [activeDiagnosticIndex, setActiveDiagnosticIndex] = useState(0);
  const activeDiagnostic = visibleDiagnostics[activeDiagnosticIndex] ?? visibleDiagnostics[0];
  const activeInstallCommand = activeDiagnostic ? diagnosticInstallCommand(activeDiagnostic) : "";

  useEffect(() => {
    setActiveDiagnosticIndex(0);
  }, [result]);

  function jumpToDiagnostic(index: number) {
    if (!visibleDiagnostics.length) return;
    const nextIndex = (index + visibleDiagnostics.length) % visibleDiagnostics.length;
    setActiveDiagnosticIndex(nextIndex);
    onDiagnosticClick(visibleDiagnostics[nextIndex]);
  }

  return (
    <div className="compile-error-panel">
      <div className="compile-error-heading">
        <AlertTriangle size={20} />
        <div>
          <strong>编译失败</strong>
          <span>点击错误可跳转到对应源码位置。</span>
        </div>
        <div className="compile-heading-actions">
          <button
            type="button"
            className="compile-codex-explain-button"
            onClick={onExplainWithCodex}
            disabled={!canRunCodex}
            title={canRunCodex ? "让 Codex 解释这次编译失败，不修改文件" : "Codex 当前不可用"}
          >
            <Search size={15} />
            <span>Codex 解释</span>
          </button>
          <button
            type="button"
            className={`compile-codex-fix-button ${errors.length ? "compile-ai-fix-primary" : ""}`}
            onClick={onFixWithCodex}
            disabled={!canRunCodex}
            title={canRunCodex ? "让 Codex 根据错误日志修复项目" : "Codex 当前不可用"}
          >
            <Bot size={15} />
            <span>{errors.length ? "自动 AI 纠错" : "Codex 修复"}</span>
          </button>
        </div>
      </div>
      <div className="compile-diagnostic-nav" aria-label="编译诊断导航">
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex - 1)}
          disabled={!visibleDiagnostics.length}
          title="上一条诊断"
        >
          <ChevronLeft size={14} />
          <span>上一条</span>
        </button>
        <span>
          {visibleDiagnostics.length ? `${activeDiagnosticIndex + 1}/${visibleDiagnostics.length}` : "0"}
        </span>
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex + 1)}
          disabled={!visibleDiagnostics.length}
          title="下一条诊断"
        >
          <span>下一条</span>
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className="compile-diagnostic-fix-button"
          onClick={() => activeDiagnostic && onFixDiagnosticWithCodex(activeDiagnostic)}
          disabled={!canRunCodex || !activeDiagnostic}
          title={canRunCodex ? "让 Codex 只修复当前这条诊断" : "Codex 当前不可用"}
        >
          <Bot size={14} />
          <span>修当前</span>
        </button>
        <button
          type="button"
          className="compile-diagnostic-explain-button"
          onClick={() => activeDiagnostic && onExplainDiagnosticWithCodex(activeDiagnostic)}
          disabled={!canRunCodex || !activeDiagnostic}
          title={canRunCodex ? "让 Codex 解释当前这条诊断，不修改文件" : "Codex 当前不可用"}
        >
          <Search size={14} />
          <span>解释</span>
        </button>
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex)}
          disabled={!activeDiagnostic?.file}
          title={activeDiagnostic?.file ? "跳转到当前诊断源码位置" : "当前诊断没有源码位置"}
        >
          <LocateFixed size={14} />
          <span>定位</span>
        </button>
      </div>
      {activeDiagnostic && (
        <div className="compile-active-diagnostic">
          <div className="compile-active-diagnostic-top">
            <span className={`compile-active-severity diagnostic-${activeDiagnostic.severity}`}>
              {diagnosticSeverityLabel(activeDiagnostic.severity)}
            </span>
            <strong>{formatDiagnosticLocation(activeDiagnostic) || "全局日志"}</strong>
            <div className="compile-active-actions">
              <button
                type="button"
                onClick={() => onCopyDiagnostic(activeDiagnostic)}
                title="复制当前诊断和修复建议"
              >
                <Clipboard size={14} />
                <span>复制</span>
              </button>
              {activeInstallCommand && (
                <button
                  type="button"
                  className="compile-active-command-button"
                  onClick={() => onCopyDiagnosticCommand(activeDiagnostic)}
                  title={activeInstallCommand}
                >
                  <Clipboard size={14} />
                  <span>复制安装命令</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDiagnosticClick(activeDiagnostic)}
                disabled={!activeDiagnostic.file}
                title={activeDiagnostic.file ? "跳转到源码位置" : "当前诊断没有源码位置"}
              >
                <LocateFixed size={14} />
                <span>定位</span>
              </button>
              <button
                type="button"
                className="compile-active-codex-button"
                onClick={() => onFixDiagnosticWithCodex(activeDiagnostic)}
                disabled={!canRunCodex}
                title={canRunCodex ? "让 Codex 修复当前错误" : "Codex 当前不可用"}
              >
                <Bot size={14} />
                <span>Codex 修当前</span>
              </button>
              <button
                type="button"
                className="compile-active-explain-button"
                onClick={() => onExplainDiagnosticWithCodex(activeDiagnostic)}
                disabled={!canRunCodex}
                title={canRunCodex ? "让 Codex 解释当前错误" : "Codex 当前不可用"}
              >
                <Search size={14} />
                <span>解释</span>
              </button>
            </div>
          </div>
          <p>{activeDiagnostic.message}</p>
          {activeDiagnostic.hint && (
            <div className="compile-active-hint">
              <AlertTriangle size={14} />
              <div>
                <strong>建议处理方式</strong>
                <span>{activeDiagnostic.hint}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="diagnostics-list">
        {visibleDiagnostics.length ? (
          visibleDiagnostics.map((diagnostic, index) => (
            <button
              key={`${diagnostic.file ?? "global"}-${diagnostic.line ?? index}-${index}`}
              type="button"
              className={[
                "diagnostic",
                `diagnostic-${diagnostic.severity}`,
                index === activeDiagnosticIndex ? "diagnostic-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                setActiveDiagnosticIndex(index);
                onDiagnosticClick(diagnostic);
              }}
            >
              <span>{diagnosticSeverityLabel(diagnostic.severity)}</span>
              <span>{formatDiagnosticLocation(diagnostic)}</span>
              <span className="diagnostic-copy">
                <span>{diagnostic.message}</span>
                {diagnostic.hint && <small>{diagnostic.hint}</small>}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-log">没有解析到具体行号，请查看原始日志。</div>
        )}
      </div>
      {warnings.length > 0 && errors.length > 0 && (
        <details className="compile-warning-details">
          <summary>{warnings.length} 条附带警告</summary>
          {warnings.map((diagnostic, index) => (
            <button
              key={`${diagnostic.message}-${index}`}
              type="button"
              className="diagnostic diagnostic-warning"
              onClick={() => onDiagnosticClick(diagnostic)}
            >
              <span>警告</span>
              <span>{formatDiagnosticLocation(diagnostic)}</span>
              <span className="diagnostic-copy">
                <span>{diagnostic.message}</span>
                {diagnostic.hint && <small>{diagnostic.hint}</small>}
              </span>
            </button>
          ))}
        </details>
      )}
      <details className="compile-log-details">
        <summary>
          <span>原始日志</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCopyCompileLog();
            }}
            title="复制原始编译日志"
            aria-label="复制原始编译日志"
          >
            <Clipboard size={14} />
            <span>复制日志</span>
          </button>
        </summary>
        <pre>{tailLog(result.log)}</pre>
      </details>
    </div>
  );
}

function CodexProgressView({
  events,
  prompt,
  changedFiles = [],
  isRunning,
  isCancelling,
  mode,
  onCancel,
  onRetry,
}: {
  events: CodexRunEvent[];
  prompt?: string;
  changedFiles?: string[];
  isRunning: boolean;
  isCancelling: boolean;
  mode: CodexRunMode;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const displayEvents = events.filter((event) => event.message.trim());
  const assistantMessages = uniqueStrings(
    displayEvents
      .filter((event) => event.kind === "assistant")
      .map((event) => event.message.trim())
      .filter(Boolean),
  );
  const fileChanges = uniqueStrings(
    displayEvents
      .filter((event) => event.kind === "file-change")
      .map((event) => event.message.trim())
      .filter(Boolean),
  );
  const errors = displayEvents.filter((event) => event.kind === "error");
  const latestError = errors[errors.length - 1];
  const timelineEvents = displayEvents
    .filter((event) => !["file-change", "assistant"].includes(event.kind))
    .slice(-5);
  const state = isCancelling
    ? "正在取消"
    : errors.length && !isRunning
      ? "需要处理"
      : isRunning
        ? mode === "ask"
          ? "正在分析"
          : "正在修改"
        : displayEvents.some((event) => event.kind === "completed")
          ? "已完成"
          : "准备中";
  const completed = displayEvents.some((event) => event.kind === "completed");
  const concreteSummary =
    changedFiles.length > 0
      ? `已完成修改，涉及 ${changedFiles.length} 个文件：${changedFiles.slice(0, 6).join("、")}${
          changedFiles.length > 6 ? `，以及另外 ${changedFiles.length - 6} 个文件` : ""
        }。下方可以确认修改或查看 diff。`
      : completed
        ? mode === "ask"
          ? "Codex 已完成分析，但没有返回可显示的正文。可以展开运行细节查看过程。"
          : "Codex 已完成，本次没有检测到文件变化。可以展开运行细节查看过程。"
        : "Codex 正在处理你的要求，具体回复或修改结果会显示在这里。";
  const headingMessage = assistantMessages.length > 0 ? "Codex 已返回具体输出。" : concreteSummary;
  const canRetry = Boolean(!isRunning && errors.length > 0 && prompt?.trim() && onRetry);

  return (
    <div className="codex-progress-view" aria-label="Codex 运行进度">
      <div className="codex-progress-heading">
        <Bot size={16} />
        <div>
          <strong>{state}</strong>
          <span>{headingMessage}</span>
        </div>
        <span
          className={[
            "codex-progress-state",
            isRunning ? "codex-progress-state-running" : "",
            errors.length ? "codex-progress-state-error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {displayEvents.length} 步
        </span>
        {isRunning && onCancel && (
          <button
            type="button"
            className="codex-stop-button codex-progress-stop"
            onClick={onCancel}
            disabled={isCancelling}
            title={mode === "ask" ? "终止本次 Codex 分析" : "终止本次 Codex 修改"}
            aria-label="终止 Codex"
          >
            <XCircle size={13} />
            <span>{isCancelling ? "终止中" : "终止"}</span>
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="codex-retry-button"
            onClick={onRetry}
            title={mode === "ask" ? "重新运行这次 Codex 分析" : "重新运行这次 Codex 修改"}
            aria-label="重试 Codex"
          >
            <RefreshCcw size={13} />
            <span>重试</span>
          </button>
        )}
      </div>
      <div className="codex-chat-transcript" aria-label="Codex 对话记录">
        {prompt?.trim() && (
          <div className="codex-chat-row codex-chat-row-user">
            <div className="codex-chat-avatar">你</div>
            <div className="codex-chat-bubble">
              <div className="codex-chat-author">你的要求</div>
              <p>{prompt.trim()}</p>
            </div>
          </div>
        )}
        {assistantMessages.length > 0 ? (
          assistantMessages.slice(-4).map((message, index) => (
            <div className="codex-chat-row codex-chat-row-assistant" key={`${index}-${message}`}>
              <div className="codex-chat-avatar">
                <Bot size={13} />
              </div>
              <div className="codex-chat-bubble">
                <div className="codex-chat-author">Codex</div>
                <p>{message}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="codex-chat-row codex-chat-row-assistant codex-chat-row-muted">
            <div className="codex-chat-avatar">
              <Bot size={13} />
            </div>
            <div className="codex-chat-bubble">
              <div className="codex-chat-author">Codex</div>
              <p>{concreteSummary}</p>
            </div>
          </div>
        )}
      </div>
      {fileChanges.length > 0 && (
        <div className="codex-progress-files">
          <div className="codex-progress-section-title">已检测到文件变化</div>
          {fileChanges.slice(0, 8).map((file) => (
            <span key={file}>
              <FileText size={12} />
              {file}
            </span>
          ))}
          {fileChanges.length > 8 && <small>还有 {fileChanges.length - 8} 个文件</small>}
        </div>
      )}
      {errors.length > 0 && (
        <div className="codex-progress-error">
          <AlertTriangle size={14} />
          <span>{latestError?.message ?? "Codex 运行遇到问题。"}</span>
        </div>
      )}
      {timelineEvents.length > 0 && (
        <details className="codex-progress-details">
          <summary>运行细节</summary>
          <div className="codex-progress-timeline">
            {timelineEvents.map((event, index) => (
              <div
                className={`codex-progress-step codex-progress-step-${event.kind}`}
                key={`${event.kind}-${index}-${event.message}`}
              >
                <span />
                <p>{event.message}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function isTextPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return textExtensions.has(extension);
}

function isLatexReferenceSourcePath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return ["tex", "sty", "cls"].includes(extension);
}

function isPreviewableAssetPath(path: string) {
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(
    path.split(".").pop()?.toLowerCase() ?? "",
  );
}

function groupSearchResultsByFile(results: SearchResult[]) {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const existing = groups.get(result.file);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(result.file, [result]);
    }
  }
  return Array.from(groups, ([file, groupResults]) => ({
    file,
    results: groupResults,
  }));
}

function latexSnippetForSymbol(symbol: ProjectSymbol) {
  return symbol.kind === "citation" ? `\\cite{${symbol.key}}` : `\\ref{${symbol.key}}`;
}

function sanitizeBibKey(value: string) {
  return value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9:_./-]/g, "");
}

function normalizeBibTargetFile(value: string) {
  const normalized = value.trim().replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) return "";
  return normalized.toLowerCase().endsWith(".bib") ? normalized : "";
}

function isCodexLocalStyleContextPath(path: string) {
  const normalized = path.trim().replace(/^\.\/+/, "").toLowerCase();
  return /\.(sty|cls|bst|bbx|cbx)$/.test(normalized);
}

function buildBibEntry(draft: BibEntryDraft) {
  const fields: Array<[string, string]> = [
    ["author", draft.author],
    ["title", draft.title],
    ["year", draft.year],
  ];
  const venueField =
    draft.entryType === "article" ? "journal" : draft.entryType === "inproceedings" ? "booktitle" : "howpublished";
  if (draft.venue.trim()) {
    fields.push([venueField, draft.venue]);
  }
  const body = fields
    .map(([field, value]) => [field, normalizeBibFieldValue(value)] as const)
    .filter(([, value]) => value)
    .map(([field, value]) => `  ${field} = {${value}},`)
    .join("\n");
  return `@${draft.entryType}{${draft.key},\n${body || "  title = {Untitled},"}\n}`;
}

function normalizeBibFieldValue(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[{}]/g, "");
}

function referenceIssueKindLabel(kind: ProjectReferenceIssue["kind"]) {
  return kind === "citation" ? "引用" : "标签";
}

function projectDependencyKindLabel(kind: string) {
  if (kind === "tex") return "TeX";
  if (kind === "graphics") return "图";
  if (kind === "bibliography") return "Bib";
  return kind || "文件";
}

function filterOutlineItems(items: OutlineItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    [
      item.kind,
      outlineKindLabel(item.kind),
      item.title,
      item.file,
      shortFileName(item.file),
      `${item.line}`,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function activeOutlineItemForCursor(items: OutlineItem[], activePath: string, line: number) {
  if (!activePath || line < 1) return null;
  return (
    items
      .filter((item) => item.file === activePath && item.kind !== "label" && item.line <= line)
      .sort((left, right) => right.line - left.line || right.level - left.level)[0] ?? null
  );
}

function filterProjectSymbols(symbols: ProjectSymbol[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? symbols.filter((symbol) =>
        [symbol.kind, symbol.key, symbol.detail ?? "", symbol.file]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : symbols;
  return [...filtered].sort((left, right) =>
    symbolKindRank(left.kind) - symbolKindRank(right.kind) ||
    left.key.localeCompare(right.key) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line,
  );
}

function symbolKindRank(kind: ProjectSymbol["kind"]) {
  return kind === "citation" ? 0 : 1;
}

function codexContextCitations(context: CodexEditorContext, symbols: ProjectSymbol[]) {
  const source = codexCitationSource(context);
  if (!source.text.trim()) return [];
  const citationSymbols = new Map(
    symbols
      .filter((symbol) => symbol.kind === "citation")
      .map((symbol) => [symbol.key, symbol]),
  );
  return citationKeysInLatexSource(source.text, source.startLine)
    .map((key) => citationSymbols.get(key))
    .filter((symbol): symbol is ProjectSymbol => Boolean(symbol))
    .slice(0, MAX_CODEX_CONTEXT_CITATIONS);
}

function codexContextLabelRefs(context: CodexEditorContext, symbols: ProjectSymbol[]) {
  const source = codexCitationSource(context);
  if (!source.text.trim()) return [];
  const labelSymbols = new Map(
    symbols
      .filter((symbol) => symbol.kind === "label")
      .map((symbol) => [symbol.key, symbol]),
  );
  return labelKeysInLatexSource(source.text, source.startLine)
    .map((key) => labelSymbols.get(key))
    .filter((symbol): symbol is ProjectSymbol => Boolean(symbol))
    .slice(0, MAX_CODEX_CONTEXT_LABEL_REFS);
}

function codexContextGraphics(context: CodexEditorContext, projectFiles: string[]) {
  const source = codexCitationSource(context);
  if (!source.text.trim()) return [];
  const seen = new Set<string>();
  const references: LatexFileReference[] = [];
  source.text.split(/\r?\n/).forEach((line, index) => {
    for (const reference of latexFileReferencesInLine(line, source.startLine + index, projectFiles)) {
      if (reference.kind !== "graphics" || seen.has(reference.path)) continue;
      seen.add(reference.path);
      references.push(reference);
    }
  });
  return references.slice(0, MAX_CODEX_CONTEXT_GRAPHICS);
}

function codexContextTodos(context: CodexEditorContext, todos: ProjectTodo[]) {
  const range = codexContextLineRange(context);
  return todos
    .filter(
      (item) =>
        !item.resolved &&
        item.file === context.file &&
        item.line >= range.startLine &&
        item.line <= range.endLine,
    )
    .slice(0, MAX_CODEX_CONTEXT_TODOS);
}

function labelKeysInLatexSource(source: string, startLine: number) {
  const seen = new Set<string>();
  const keys: string[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const reference of latexReferencesInLine(line, startLine + index)) {
      if (reference.kind !== "label" || seen.has(reference.key)) continue;
      seen.add(reference.key);
      keys.push(reference.key);
    }
  });
  return keys;
}

function codexContextDefinedLabels(context: CodexEditorContext) {
  const source = codexCitationSource(context);
  if (!source.text.trim()) return [];
  return definedLatexLabelsInSource(source.text, source.startLine).slice(0, MAX_CODEX_CONTEXT_DEFINED_LABELS);
}

function definedLatexLabelsInSource(source: string, startLine: number) {
  const seen = new Set<string>();
  const labels: Array<{ key: string; line: number }> = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const visibleLine = stripLatexLineComment(line);
    const labelPattern = /\\label\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = labelPattern.exec(visibleLine))) {
      const key = match[1].trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      labels.push({ key, line: startLine + index });
    }
  });
  return labels;
}

function codexContextEnvironments(context: CodexEditorContext) {
  const source = codexCitationSource(context);
  if (!source.text.trim()) return [];
  return latexEnvironmentsInSource(source.text, source.startLine).slice(0, MAX_CODEX_CONTEXT_ENVIRONMENTS);
}

function latexEnvironmentsInSource(source: string, startLine: number) {
  const environments: Array<{ name: string; line: number; label?: string; caption?: string }> = [];
  const stack: Array<{ name: string; label?: string; caption?: string }> = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const visibleLine = stripLatexLineComment(line);
    const lineNumber = startLine + index;
    const beginPattern = /\\begin\s*\{([^}]*)\}/g;
    let beginMatch: RegExpExecArray | null;
    while ((beginMatch = beginPattern.exec(visibleLine))) {
      const name = beginMatch[1].trim();
      if (!name || name === "document") continue;
      const environment = { name, line: lineNumber };
      environments.push(environment);
      stack.push(environment);
    }

    const activeEnvironment = stack[stack.length - 1];
    if (activeEnvironment) {
      const labelMatch = visibleLine.match(/\\label\s*\{([^}]*)\}/);
      if (labelMatch && !activeEnvironment.label) {
        activeEnvironment.label = labelMatch[1].trim();
      }
      const captionMatch = visibleLine.match(/\\caption(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/);
      if (captionMatch && !activeEnvironment.caption) {
        activeEnvironment.caption = truncateLatexSummaryText(captionMatch[1].trim(), 96);
      }
    }

    const endPattern = /\\end\s*\{([^}]*)\}/g;
    let endMatch: RegExpExecArray | null;
    while ((endMatch = endPattern.exec(visibleLine))) {
      const name = endMatch[1].trim();
      const stackIndex = stack.map((item) => item.name).lastIndexOf(name);
      if (stackIndex >= 0) {
        stack.splice(stackIndex);
      }
    }
  });
  return environments;
}

function truncateLatexSummaryText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function citationKeysInLatexSource(source: string, startLine: number) {
  const seen = new Set<string>();
  const keys: string[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const reference of latexReferencesInLine(line, startLine + index)) {
      if (reference.kind !== "citation" || reference.key === "*" || seen.has(reference.key)) continue;
      seen.add(reference.key);
      keys.push(reference.key);
    }
  });
  return keys;
}

function readEditorNearbyContext(model: MonacoEditor.ITextModel, cursorLine: number) {
  const lineCount = Math.max(1, model.getLineCount());
  const safeCursorLine = clamp(Math.trunc(cursorLine), 1, lineCount);
  const startLine = Math.max(1, safeCursorLine - CODEX_NEARBY_CONTEXT_RADIUS);
  const endLine = Math.min(lineCount, safeCursorLine + CODEX_NEARBY_CONTEXT_RADIUS);
  const rawText = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine),
  });
  const truncated = rawText.length > MAX_CODEX_NEARBY_CONTEXT;
  return {
    startLine,
    endLine,
    text: truncated ? rawText.slice(0, MAX_CODEX_NEARBY_CONTEXT) : rawText,
    truncated,
  };
}

function readEditorActiveSectionContext(
  model: MonacoEditor.ITextModel,
  items: OutlineItem[],
  activePath: string,
  section: OutlineItem,
) {
  const lineCount = Math.max(1, model.getLineCount());
  const startLine = clamp(section.line, 1, lineCount);
  const nextBoundary = items
    .filter(
      (item) =>
        item.file === activePath &&
        item.kind !== "label" &&
        item.line > section.line &&
        item.level <= section.level,
    )
    .sort((left, right) => left.line - right.line)[0];
  const endLine = nextBoundary ? clamp(nextBoundary.line - 1, startLine, lineCount) : lineCount;
  const rawText = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine),
  });
  const truncated = rawText.length > MAX_CODEX_ACTIVE_SECTION_CONTEXT;
  return {
    startLine,
    endLine,
    text: truncated ? rawText.slice(0, MAX_CODEX_ACTIVE_SECTION_CONTEXT) : rawText,
    truncated,
  };
}

function buildCodexProjectContext(
  project: ProjectSummary | null,
  settings: ProjectSettings | null,
  overview: ProjectOverview | null,
  preambleContext: string,
  localStyleContexts: CodexReferencedFileContext[],
  macroSummaries: CodexLatexMacroSummary[],
  documentFiles: string[],
  dependencies: ProjectDependency[],
  files: FileNode[],
  outline: OutlineItem[],
  symbols: ProjectSymbol[],
  todos: ProjectTodo[],
  referenceIssues: ProjectReferenceIssue[],
  compileResult: CompileResult | null,
  tabs: EditorTab[],
) {
  if (!project) return "";
  const allFiles = collectProjectFiles(files);
  const shownFiles = allFiles.slice(0, MAX_CODEX_PROJECT_FILES);
  const shownLocalStyleContexts = localStyleContexts.slice(0, MAX_CODEX_LOCAL_STYLE_CONTEXT_FILES);
  const shownMacroSummaries = macroSummaries.slice(0, MAX_CODEX_MACRO_SUMMARIES);
  const shownDocumentFiles = documentFiles.slice(0, MAX_CODEX_DOCUMENT_FILES);
  const shownDependencies = dependencies.slice(0, MAX_CODEX_DEPENDENCIES);
  const shownSymbols = symbols.slice(0, MAX_CODEX_SYMBOLS);
  const shownOutline = outline.slice(0, MAX_CODEX_OUTLINE_ITEMS);
  const pendingTodos = todos.filter((item) => !item.resolved);
  const resolvedTodoCount = todos.length - pendingTodos.length;
  const shownTodos = pendingTodos.slice(0, MAX_CODEX_TODOS);
  const shownReferenceIssues = referenceIssues.slice(0, MAX_CODEX_REFERENCE_ISSUES);
  const diagnostics =
    compileResult && !compileResult.success
      ? compileResult.diagnostics.slice(0, MAX_CODEX_DIAGNOSTICS)
      : [];
  const openTabs = tabs.map((tab) => `${tab.path}${tab.dirty ? " (unsaved)" : ""}`);

  const lines = [
    "Project context from LaTeX Studio:",
    "- This is a bounded summary; inspect files before making broad edits.",
    `- Project name: ${project.name}`,
    `- Main file: ${project.mainFile}`,
    `- Compile engine: ${settings?.engine ?? "xelatex"}`,
    `- Build directory: ${settings?.buildDir ?? ".latex-studio/build"}`,
    `- Extra latexmk args: ${settings?.compileArgs?.length ? settings.compileArgs.join(" ") : "(none)"}`,
  ];

  if (overview) {
    const overviewLines = [];
    if (overview.title) overviewLines.push(`- Title: ${overview.title}`);
    if (overview.author) overviewLines.push(`- Author: ${overview.author}`);
    if (overview.date) overviewLines.push(`- Date: ${overview.date}`);
    if (overview.keywords.length) overviewLines.push(`- Keywords: ${overview.keywords.join(", ")}`);
    if (overview.abstractText) overviewLines.push(`- Abstract: ${overview.abstractText}`);
    if (overviewLines.length) {
      lines.push("", "Paper overview:", ...overviewLines);
    }
  }

  if (preambleContext.trim()) {
    lines.push(
      "",
      "Main LaTeX preamble context:",
      "- Respect the existing document class, packages, theorem setup, and custom macros before adding new LaTeX commands.",
      "```latex",
      preambleContext,
      "```",
    );
  }

  if (shownLocalStyleContexts.length) {
    lines.push(
      "",
      `Local LaTeX style/class context (${shownLocalStyleContexts.length}/${localStyleContexts.length} files shown):`,
      "- These are project-local template/style files resolved from \\documentclass, \\usepackage, bibliography, or related LaTeX file dependencies.",
      "- Respect their macros, environments, submission rules, and formatting constraints before adding new packages or commands.",
    );
    for (const file of shownLocalStyleContexts) {
      lines.push(
        "",
        `File: ${file.path}`,
        file.truncated
          ? `- File content was truncated to ${MAX_CODEX_LOCAL_STYLE_CONTEXT}/${file.originalLength} characters; inspect the file before broad template edits.`
          : `- Full file content included (${file.originalLength} characters).`,
        "```latex",
        file.content,
        "```",
      );
    }
  }

  lines.push("", `Project-defined LaTeX macros (${shownMacroSummaries.length}/${macroSummaries.length} shown):`);
  if (shownMacroSummaries.length) {
    lines.push(
      "- Prefer reusing these existing local commands/environments/operators before introducing new macros or packages.",
      ...shownMacroSummaries.map(
        (macro) =>
          `- ${macro.path}:${macro.line} ${macro.signature} [${macro.command}]${macro.preview ? ` — ${macro.preview}` : ""}`,
      ),
    );
  } else {
    lines.push("- No local macro definitions indexed from document sources or project-local style/class files.");
  }

  if (openTabs.length) {
    lines.push(`- Open editor tabs: ${openTabs.slice(0, 12).join(", ")}${openTabs.length > 12 ? ", ..." : ""}`);
  }

  lines.push("", `Document source order (${shownDocumentFiles.length}/${documentFiles.length} shown):`);
  if (shownDocumentFiles.length) {
    lines.push(...shownDocumentFiles.map((file, index) => `${index + 1}. ${file}`));
  } else {
    lines.push("- No document source order indexed.");
  }
  if (documentFiles.length > shownDocumentFiles.length) {
    lines.push(`- ... ${documentFiles.length - shownDocumentFiles.length} more document files omitted`);
  }

  lines.push("", `Project dependencies (${shownDependencies.length}/${dependencies.length} shown):`);
  if (shownDependencies.length) {
    lines.push(
      ...shownDependencies.map((dependency) => {
        const resolved = dependency.resolvedPath ? ` -> ${dependency.resolvedPath}` : " -> unresolved";
        return `- ${dependency.sourceFile}:${dependency.line} \\${dependency.command}{${dependency.target}} [${dependency.kind}]${resolved}`;
      }),
    );
  } else {
    lines.push("- No LaTeX file dependencies indexed.");
  }
  if (dependencies.length > shownDependencies.length) {
    lines.push(`- ... ${dependencies.length - shownDependencies.length} more dependencies omitted`);
  }

  lines.push("", `Project labels and citations (${shownSymbols.length}/${symbols.length} shown):`);
  if (shownSymbols.length) {
    lines.push(
      ...shownSymbols.map((symbol) => {
        const detail = symbol.detail ? ` - ${symbol.detail}` : "";
        return `- [${symbol.kind}] ${symbol.key} (${symbol.file}:${symbol.line})${detail}`;
      }),
    );
  } else {
    lines.push("- No labels or citations indexed.");
  }
  if (symbols.length > shownSymbols.length) {
    lines.push(`- ... ${symbols.length - shownSymbols.length} more labels/citations omitted`);
  }

  lines.push("", `Project files (${shownFiles.length}/${allFiles.length} shown):`);
  if (shownFiles.length) {
    lines.push(...shownFiles.map((file) => `- ${file}`));
  } else {
    lines.push("- No files loaded yet.");
  }
  if (allFiles.length > shownFiles.length) {
    lines.push(`- ... ${allFiles.length - shownFiles.length} more files omitted`);
  }

  lines.push("", `Document outline (${shownOutline.length}/${outline.length} shown):`);
  if (shownOutline.length) {
    lines.push(
      ...shownOutline.map(
        (item) =>
          `- ${item.kind} ${item.title || "(empty title)"} (${item.file}:${item.line})`,
      ),
    );
  } else {
    lines.push("- No outline items parsed yet.");
  }
  if (outline.length > shownOutline.length) {
    lines.push(`- ... ${outline.length - shownOutline.length} more outline items omitted`);
  }

  lines.push("", `Unresolved TODO/review comments (${shownTodos.length}/${pendingTodos.length} shown):`);
  if (shownTodos.length) {
    lines.push(
      ...shownTodos.map(
        (item) => `- [${item.kind}] ${item.file}:${item.line}: ${item.message}`,
      ),
    );
  } else {
    lines.push("- No unresolved TODO/FIXME/NOTE comments indexed.");
  }
  if (pendingTodos.length > shownTodos.length) {
    lines.push(`- ... ${pendingTodos.length - shownTodos.length} more unresolved TODO comments omitted`);
  }
  if (resolvedTodoCount) {
    lines.push(`- ${resolvedTodoCount} resolved TODO/review comments are hidden from this actionable list.`);
  }

  lines.push(
    "",
    `Unresolved references (${shownReferenceIssues.length}/${referenceIssues.length} shown):`,
  );
  if (shownReferenceIssues.length) {
    lines.push(
      ...shownReferenceIssues.map(
        (item) => `- [${item.kind}] ${item.file}:${item.line}: ${item.key}`,
      ),
    );
  } else {
    lines.push("- No unresolved citation or label keys indexed.");
  }
  if (referenceIssues.length > shownReferenceIssues.length) {
    lines.push(`- ... ${referenceIssues.length - shownReferenceIssues.length} more unresolved references omitted`);
  }

  if (compileResult) {
    lines.push(
      "",
      `Latest compile status: ${compileResult.success ? "success" : "failed"}`,
    );
    if (diagnostics.length) {
      lines.push(`Latest diagnostics (${diagnostics.length}/${compileResult.diagnostics.length} shown):`);
      lines.push(
        ...diagnostics.map((diagnostic, index) => {
          const location = formatDiagnosticLocation(diagnostic) || "global";
          return `${index + 1}. [${diagnostic.severity}] ${location}: ${formatDiagnosticText(diagnostic)}`;
        }),
      );
    }
  }

  return lines.join("\n");
}

function extractLatexPreambleContext(path: string, content: string) {
  const beginDocumentMatch = content.match(/\\begin\s*\{document\}/);
  if (!beginDocumentMatch && !content.includes("\\documentclass")) return "";
  const rawPreamble =
    beginDocumentMatch?.index !== undefined ? content.slice(0, beginDocumentMatch.index) : content;
  const lines = rawPreamble
    .split(/\r?\n/)
    .filter((line) => stripLatexLineComment(line).trim().length > 0)
    .map((line) => line.trim());
  if (!lines.length) return "";
  const body = lines.join("\n");
  const truncated = body.length > MAX_CODEX_PREAMBLE_CONTEXT;
  return [
    `File: ${path}`,
    truncated
      ? `Preamble excerpt truncated to ${MAX_CODEX_PREAMBLE_CONTEXT} characters; inspect the main file before broad macro/package edits.`
      : "Preamble excerpt before \\begin{document}:",
    truncated ? body.slice(0, MAX_CODEX_PREAMBLE_CONTEXT) : body,
  ].join("\n");
}

function parseLatexMacroSummaries(path: string, content: string): CodexLatexMacroSummary[] {
  const summaries: CodexLatexMacroSummary[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const visible = stripLatexLineComment(line).trim();
    if (!visible.includes("\\") || !visible.trim()) continue;
    const summary = parseLatexMacroSummaryLine(path, index + 1, visible);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function parseLatexMacroSummaryLine(
  path: string,
  line: number,
  visible: string,
): CodexLatexMacroSummary | null {
  const commandMacro = visible.match(
    /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*(?:\{\\([A-Za-z@]+)\}|\\([A-Za-z@]+))\s*((?:\[[^\]]*\]\s*){0,2})/,
  );
  if (commandMacro) {
    const command = commandMacro[1];
    const name = commandMacro[2] ?? commandMacro[3] ?? "";
    const options = compactLatexMacroOptions(commandMacro[4] ?? "");
    return codexLatexMacroSummary(path, line, command, `\\${name}`, `\\${name}${options}`, visible);
  }

  const xparseCommand = visible.match(
    /\\(NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|DeclareDocumentCommand)\s*\{\\([A-Za-z@]+)\}\s*\{([^}]*)\}/,
  );
  if (xparseCommand) {
    const [, command, name, args] = xparseCommand;
    return codexLatexMacroSummary(path, line, command, `\\${name}`, `\\${name}{${args.trim()}}`, visible);
  }

  const mathOperator = visible.match(/\\(DeclareMathOperator)\*?\s*\{\\([A-Za-z@]+)\}/);
  if (mathOperator) {
    const [, command, name] = mathOperator;
    return codexLatexMacroSummary(path, line, command, `\\${name}`, `\\${name}`, visible);
  }

  const pairedDelimiter = visible.match(/\\(DeclarePairedDelimiter(?:X|XPP)?)\s*\{\\([A-Za-z@]+)\}/);
  if (pairedDelimiter) {
    const [, command, name] = pairedDelimiter;
    return codexLatexMacroSummary(path, line, command, `\\${name}`, `\\${name}`, visible);
  }

  const defMacro = visible.match(/\\def\s*\\([A-Za-z@]+)((?:#\d)*)/);
  if (defMacro) {
    const [, name, args] = defMacro;
    return codexLatexMacroSummary(path, line, "def", `\\${name}`, `\\def\\${name}${args}`, visible);
  }

  const environment = visible.match(
    /\\(newenvironment|renewenvironment)\*?\s*\{([A-Za-z*@:_-]+)\}\s*((?:\[[^\]]*\]\s*){0,2})/,
  );
  if (environment) {
    const [, command, name, options] = environment;
    return codexLatexMacroSummary(
      path,
      line,
      command,
      name,
      `environment ${name}${compactLatexMacroOptions(options ?? "")}`,
      visible,
    );
  }

  const xparseEnvironment = visible.match(
    /\\(NewDocumentEnvironment|RenewDocumentEnvironment|DeclareDocumentEnvironment)\s*\{([A-Za-z*@:_-]+)\}\s*\{([^}]*)\}/,
  );
  if (xparseEnvironment) {
    const [, command, name, args] = xparseEnvironment;
    return codexLatexMacroSummary(path, line, command, name, `environment ${name}{${args.trim()}}`, visible);
  }

  return null;
}

function codexLatexMacroSummary(
  path: string,
  line: number,
  command: string,
  name: string,
  signature: string,
  visible: string,
): CodexLatexMacroSummary {
  return {
    path,
    line,
    command,
    name,
    signature,
    preview: truncateLatexSummaryText(visible, 150),
  };
}

function compactLatexMacroOptions(value: string) {
  return value.replace(/\s+/g, "");
}

function buildCodexDiffContext(summary: DiffSummary) {
  const diffText = summary.unifiedDiff || summary.changedFiles.join("\n");
  const truncated = diffText.length > MAX_CODEX_DIFF_CONTEXT;
  const shownDiff = truncated ? diffText.slice(0, MAX_CODEX_DIFF_CONTEXT) : diffText;
  return [
    "Current diff context from LaTeX Studio:",
    "- The user explicitly enabled including the current Codex/history diff as context for this turn.",
    `- Changed files: ${summary.changedFiles.join(", ") || "(none)"}`,
    truncated
      ? `- Diff was truncated to ${MAX_CODEX_DIFF_CONTEXT} characters; inspect project files before relying on omitted hunks.`
      : "- Full diff is included below.",
    "",
    "```diff",
    shownDiff,
    "```",
  ].join("\n");
}

function buildCodexEditScopeContext(files: string[]) {
  return [
    "Codex edit scope lock from LaTeX Studio:",
    "- The user enabled context-only editing for this run.",
    "- Modify only the files listed below. Do not create, delete, or edit any other project file unless the user explicitly changes the scope.",
    "- If the requested change cannot be completed within these files, explain that limitation instead of editing outside the scope.",
    "",
    "Allowed edit files:",
    ...files.map((file) => `- ${file}`),
  ].join("\n");
}

function buildCodexReferencedFilesContext(files: CodexReferencedFileContext[]) {
  const lines = [
    "Referenced project files from @mentions in the user request:",
    "- The user explicitly mentioned these project files with @file syntax; use them as important context for this turn.",
  ];
  for (const file of files) {
    lines.push(
      "",
      `File: ${file.path}`,
      file.truncated
        ? `- File content was truncated to ${MAX_CODEX_REFERENCED_FILE_CONTEXT}/${file.originalLength} characters; inspect the project file before broad edits.`
        : `- Full file content included (${file.originalLength} characters).`,
      "```latex",
      file.content,
      "```",
    );
  }
  return lines.join("\n");
}

function buildCodexReferencedSymbolsContext(contexts: CodexReferencedSymbolContext[]) {
  const lines = [
    "Referenced LaTeX labels/citations from #mentions in the user request:",
    "- The user explicitly mentioned these labels or citations with #key syntax; use them as important context for this turn.",
  ];
  for (const { symbol, source, sourceStartLine, sourceEndLine, truncated } of contexts) {
    const detail = symbol.detail ? ` - ${symbol.detail}` : "";
    lines.push(
      "",
      `Symbol: [${symbol.kind}] ${symbol.key} (${symbol.file}:${symbol.line})${detail}`,
      `- Source excerpt lines ${sourceStartLine}-${sourceEndLine}${truncated ? `, truncated to ${MAX_CODEX_REFERENCED_SYMBOL_CONTEXT} characters` : ""}.`,
      "```latex",
      source,
      "```",
    );
  }
  return lines.join("\n");
}

function buildCodexContextCitationSourcesContext(contexts: CodexReferencedSymbolContext[]) {
  const lines = [
    "BibTeX source excerpts for citations in the current editor context:",
    "- These entries are automatically included because the current selected/nearby/section source cites them.",
    "- Use them as evidence for citation-aware rewriting, but do not invent bibliographic facts beyond the available entries.",
  ];
  for (const { symbol, source, sourceStartLine, sourceEndLine, truncated } of contexts) {
    const detail = symbol.detail ? ` - ${symbol.detail}` : "";
    lines.push(
      "",
      `Citation: ${symbol.key} (${symbol.file}:${symbol.line})${detail}`,
      `- BibTeX excerpt lines ${sourceStartLine}-${sourceEndLine}${truncated ? `, truncated to ${MAX_CODEX_REFERENCED_SYMBOL_CONTEXT} characters` : ""}.`,
      "```bibtex",
      source,
      "```",
    );
  }
  return lines.join("\n");
}

function resolveCodexSymbolMentionKeys(prompt: string, symbols: ProjectSymbol[], maxSymbols = MAX_CODEX_REFERENCED_SYMBOLS) {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const symbolsByLowerKey = new Map<string, ProjectSymbol[]>();
  for (const symbol of symbols) {
    const key = symbol.key.trim();
    if (!key) continue;
    const lowerKey = key.toLowerCase();
    symbolsByLowerKey.set(lowerKey, [...(symbolsByLowerKey.get(lowerKey) ?? []), symbol]);
  }

  for (const token of codexSymbolMentionTokens(prompt)) {
    if (!token || token.length > 160 || token.includes("\\") || token.includes("..")) continue;
    const lowerToken = token.toLowerCase();
    const matches = symbolsByLowerKey.get(lowerToken) ?? [];
    if (matches.length !== 1 || seen.has(lowerToken)) continue;
    seen.add(lowerToken);
    resolved.push(matches[0].key);
    if (resolved.length >= maxSymbols) break;
  }
  return resolved;
}

function readCodexSymbolSourceContext(symbol: ProjectSymbol, content: string): CodexReferencedSymbolContext {
  const lines = content.split(/\r?\n/);
  const safeLine = clamp(symbol.line || 1, 1, Math.max(1, lines.length));
  const sourceStartLine = Math.max(1, safeLine - CODEX_SYMBOL_CONTEXT_RADIUS);
  const sourceEndLine = Math.min(lines.length, safeLine + CODEX_SYMBOL_CONTEXT_RADIUS);
  const sourceWithLineNumbers = lines
    .slice(sourceStartLine - 1, sourceEndLine)
    .map((line, index) => `${sourceStartLine + index}: ${line}`)
    .join("\n");
  const truncated = sourceWithLineNumbers.length > MAX_CODEX_REFERENCED_SYMBOL_CONTEXT;
  return {
    symbol,
    source: truncated
      ? sourceWithLineNumbers.slice(0, MAX_CODEX_REFERENCED_SYMBOL_CONTEXT)
      : sourceWithLineNumbers,
    sourceStartLine,
    sourceEndLine,
    truncated,
  };
}

function formatCodexHistoryTime(createdAt: number) {
  if (!createdAt) return "未知时间";
  return new Date(createdAt * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompileTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHistoryTime(createdAt: number) {
  return formatCodexHistoryTime(createdAt);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function rewriteLatexTodoCommentState(line: string, resolved: boolean) {
  const commentStart = latexCommentStartIndex(line);
  if (commentStart < 0) return line;
  const comment = line.slice(commentStart + 1).trim();
  const parsed = parseLatexTodoCommentText(comment);
  if (!parsed || parsed.resolved === resolved) return line;
  const beforeRaw = line.slice(0, commentStart);
  const before = beforeRaw.trim() ? `${beforeRaw.replace(/[ \t]+$/, "")} ` : beforeRaw;
  const marker = resolved ? `RESOLVED ${parsed.kind}` : parsed.kind;
  return `${before}% ${marker}: ${parsed.message}`;
}

function removeLatexTodoCommentFromLine(line: string) {
  const commentStart = latexCommentStartIndex(line);
  if (commentStart < 0) return line;
  const comment = line.slice(commentStart + 1).trim();
  if (!parseLatexTodoCommentText(comment)) return line;
  const beforeComment = line.slice(0, commentStart).replace(/[ \t]+$/, "");
  return beforeComment.trim() ? beforeComment : null;
}

function reviewBlockEndLine(model: MonacoEditor.ITextModel, startLine: number) {
  for (let lineNumber = startLine + 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    if (isReviewEndCommentLine(model.getLineContent(lineNumber))) return lineNumber;
  }
  return startLine;
}

function parseLatexmkArgs(value: string) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCompileFixPrompt(project: ProjectSummary, result: CompileResult, sourceContext = "") {
  const diagnostics = result.diagnostics
    .slice(0, 12)
    .map((diagnostic, index) => {
      const location = formatDiagnosticLocation(diagnostic) || "global";
      return `${index + 1}. [${diagnostic.severity}] ${location}: ${formatDiagnosticText(diagnostic)}`;
    })
    .join("\n");
  const command = result.command.length ? result.command.join(" ") : "latexmk";
  return [
    "Fix the LaTeX compile errors in this project.",
    "Keep edits minimal and focused on making the project compile.",
    "Do not rewrite unrelated paper content.",
    "",
    `Main file: ${project.mainFile}`,
    `Project: ${project.name}`,
    "",
    "Diagnostics:",
    diagnostics || "No structured diagnostics were parsed. Use the raw log below.",
    "",
    "Source context near diagnostics:",
    sourceContext || "No source snippets were available. Inspect the referenced project files before editing.",
    "",
    "Compile command:",
    command,
    "",
    "Raw log tail:",
    "```text",
    tailLog(result.log),
    "```",
  ].join("\n");
}

function buildCompileExplainPrompt(project: ProjectSummary, result: CompileResult, sourceContext = "") {
  const diagnostics = result.diagnostics
    .slice(0, 12)
    .map((diagnostic, index) => {
      const location = formatDiagnosticLocation(diagnostic) || "global";
      return `${index + 1}. [${diagnostic.severity}] ${location}: ${formatDiagnosticText(diagnostic)}`;
    })
    .join("\n");
  const command = result.command.length ? result.command.join(" ") : "latexmk";
  return [
    "Explain this LaTeX compile failure in Chinese. Do not modify any files.",
    "Identify the most likely root cause first, then give the smallest manual fix the user can make.",
    "If multiple diagnostics are cascading from one error, say which one should be handled first.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    "",
    "Diagnostics:",
    diagnostics || "No structured diagnostics were parsed. Use the raw log below.",
    "",
    "Source context near diagnostics:",
    sourceContext || "No source snippets were available. Inspect the referenced project files before explaining.",
    "",
    "Compile command:",
    command,
    "",
    "Raw log tail:",
    "```text",
    tailLog(result.log),
    "```",
  ].join("\n");
}

function buildDiagnosticFixPrompt(
  project: ProjectSummary,
  result: CompileResult,
  diagnostic: Diagnostic,
  sourceContext = "",
) {
  const target = formatDiagnosticLocation(diagnostic) || "global";
  const relatedDiagnostics = result.diagnostics
    .filter((candidate) => candidate !== diagnostic)
    .slice(0, 6)
    .map((candidate, index) => {
      const location = formatDiagnosticLocation(candidate) || "global";
      return `${index + 1}. [${candidate.severity}] ${location}: ${formatDiagnosticText(candidate)}`;
    })
    .join("\n");
  const command = result.command.length ? result.command.join(" ") : "latexmk";
  return [
    "Fix this single LaTeX compile diagnostic in the current project.",
    "Make the smallest edit needed for this target error.",
    "Do not rewrite unrelated paper content or chase unrelated warnings unless they directly block this fix.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Target diagnostic: [${diagnostic.severity}] ${target}: ${formatDiagnosticText(diagnostic)}`,
    "",
    "Other diagnostics for context:",
    relatedDiagnostics || "No other structured diagnostics.",
    "",
    "Source context near diagnostics:",
    sourceContext || "No source snippets were available. Inspect the referenced project files before editing.",
    "",
    "Compile command:",
    command,
    "",
    "Raw log tail:",
    "```text",
    tailLog(result.log),
    "```",
  ].join("\n");
}

function buildDiagnosticExplainPrompt(
  project: ProjectSummary,
  result: CompileResult,
  diagnostic: Diagnostic,
  sourceContext = "",
) {
  const target = formatDiagnosticLocation(diagnostic) || "global";
  const relatedDiagnostics = result.diagnostics
    .filter((candidate) => candidate !== diagnostic)
    .slice(0, 6)
    .map((candidate, index) => {
      const location = formatDiagnosticLocation(candidate) || "global";
      return `${index + 1}. [${candidate.severity}] ${location}: ${formatDiagnosticText(candidate)}`;
    })
    .join("\n");
  const command = result.command.length ? result.command.join(" ") : "latexmk";
  return [
    "Explain this single LaTeX compile diagnostic in Chinese. Do not modify any files.",
    "Describe what it means, why it likely happened, and the smallest manual fix.",
    "If the diagnostic is probably caused by an earlier error, point that out.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Target diagnostic: [${diagnostic.severity}] ${target}: ${formatDiagnosticText(diagnostic)}`,
    "",
    "Other diagnostics for context:",
    relatedDiagnostics || "No other structured diagnostics.",
    "",
    "Source context near diagnostics:",
    sourceContext || "No source snippets were available. Inspect the referenced project files before explaining.",
    "",
    "Compile command:",
    command,
    "",
    "Raw log tail:",
    "```text",
    tailLog(result.log),
    "```",
  ].join("\n");
}

async function buildDiagnosticSourceContext(project: ProjectSummary, diagnostics: Diagnostic[]) {
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (snippets.length >= MAX_CODEX_DIAGNOSTIC_SOURCE_SNIPPETS) break;
    if (!diagnostic.file) continue;
    const relative = normalizeDiagnosticPath(diagnostic.file, project.root);
    if (!relative || !isTextPath(relative)) continue;
    const key = `${relative}:${diagnostic.line ?? "file"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const content = await readFile(project.root, relative);
      const snippet = diagnosticSourceSnippet(relative, content, diagnostic.line);
      if (snippet) snippets.push(snippet);
    } catch {
      // Diagnostics can point to generated or package files outside the project.
    }
  }
  return snippets.join("\n\n");
}

function diagnosticSourceSnippet(path: string, content: string, line?: number) {
  const lines = content.split(/\r?\n/);
  if (!lines.length) return "";
  const safeLine = line && Number.isFinite(line) ? clamp(Math.floor(line), 1, lines.length) : 1;
  const startLine = Math.max(1, safeLine - DIAGNOSTIC_SOURCE_CONTEXT_RADIUS);
  const endLine = Math.min(lines.length, safeLine + DIAGNOSTIC_SOURCE_CONTEXT_RADIUS);
  const body = lines
    .slice(startLine - 1, endLine)
    .map((value, index) => {
      const lineNumber = startLine + index;
      const marker = lineNumber === safeLine ? ">" : " ";
      return `${marker} ${String(lineNumber).padStart(4, " ")} | ${value}`;
    })
    .join("\n");
  return [`${path}:${safeLine}`, "```tex", body, "```"].join("\n");
}

function todoSourceSnippet(path: string, content: string, line: number) {
  const lines = content.split(/\r?\n/);
  if (!lines.length) return "";
  const safeLine = line && Number.isFinite(line) ? clamp(Math.floor(line), 1, lines.length) : 1;
  const startLine = Math.max(1, safeLine - TODO_SOURCE_CONTEXT_RADIUS);
  const endLine = Math.min(lines.length, safeLine + TODO_SOURCE_CONTEXT_RADIUS);
  const body = lines
    .slice(startLine - 1, endLine)
    .map((value, index) => {
      const lineNumber = startLine + index;
      const marker = lineNumber === safeLine ? ">" : " ";
      return `${marker} ${String(lineNumber).padStart(4, " ")} | ${value}`;
    })
    .join("\n");
  return [`${path}:${safeLine}`, "```tex", body, "```"].join("\n");
}

function referenceIssueSourceSnippet(path: string, content: string, line: number) {
  const lines = content.split(/\r?\n/);
  if (!lines.length) return "";
  const safeLine = line && Number.isFinite(line) ? clamp(Math.floor(line), 1, lines.length) : 1;
  const startLine = Math.max(1, safeLine - REFERENCE_SOURCE_CONTEXT_RADIUS);
  const endLine = Math.min(lines.length, safeLine + REFERENCE_SOURCE_CONTEXT_RADIUS);
  const body = lines
    .slice(startLine - 1, endLine)
    .map((value, index) => {
      const lineNumber = startLine + index;
      const marker = lineNumber === safeLine ? ">" : " ";
      return `${marker} ${String(lineNumber).padStart(4, " ")} | ${value}`;
    })
    .join("\n");
  return [`${path}:${safeLine}`, "```tex", body, "```"].join("\n");
}

function buildTodoFixPrompt(project: ProjectSummary, item: ProjectTodo, sourceContext = "") {
  return [
    "Address this LaTeX project TODO/comment.",
    "Make the smallest useful edit near the referenced location.",
    "Use the source context below as the primary editing target.",
    "Do not rewrite unrelated paper content.",
    "If the TODO/FIXME is fully resolved, remove or update that specific comment.",
    "If it cannot be resolved without inventing facts, replace it with a clearer TODO and keep the document compiling.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Target: ${item.file}:${item.line}`,
    `Comment kind: ${item.kind}`,
    `Comment text: ${item.message}`,
    ...(sourceContext ? ["", "Source context around the comment:", sourceContext] : []),
  ].join("\n");
}

function buildTodosFixPrompt(project: ProjectSummary, todos: ProjectTodo[], sourceContexts: string[]) {
  const shownTodos = todos.slice(0, MAX_CODEX_TODOS);
  return [
    "Address the unresolved TODO/review comments in this LaTeX project.",
    "Work through the comments as a paper reviewer/editor would: make focused edits near each referenced location.",
    "Do not rewrite unrelated paper content.",
    "If a comment is fully resolved, remove or update that specific TODO/REVIEW/FIXME/NOTE comment.",
    "If a comment cannot be resolved without inventing facts, keep it as a clearer TODO and keep the document compiling.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Total unresolved comments: ${todos.length}`,
    "",
    `Unresolved comments (${shownTodos.length}/${todos.length} shown):`,
    ...shownTodos.map((item) => `- [${item.kind}] ${item.file}:${item.line}: ${item.message}`),
    ...(todos.length > shownTodos.length
      ? [`- ... ${todos.length - shownTodos.length} more unresolved comments omitted from this list.`]
      : []),
    ...(sourceContexts.length
      ? [
          "",
          `Source contexts around the first comments (${sourceContexts.length}/${Math.min(
            todos.length,
            MAX_CODEX_TODO_SOURCE_SNIPPETS,
          )} shown):`,
          ...sourceContexts,
        ]
      : []),
  ].join("\n");
}

function buildReferenceIssueFixPrompt(project: ProjectSummary, issue: ProjectReferenceIssue, sourceContext = "") {
  const kindLabel = issue.kind === "citation" ? "citation" : "label";
  return [
    "Fix this unresolved LaTeX reference in the current project.",
    "Make the smallest useful edit and keep unrelated paper content unchanged.",
    "Use the source context below as the primary location for the fix.",
    "If this is a missing citation, first look for an existing BibTeX key typo or nearby bibliography evidence.",
    "Do not invent bibliographic facts. If there is not enough evidence to add a real BibTeX entry, leave a clear TODO comment instead.",
    "If this is a missing label, correct the key or add a label only when the intended target is clear.",
    "Keep the project compiling.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Missing ${kindLabel}: ${issue.key}`,
    `Location: ${issue.file}:${issue.line}`,
    ...(sourceContext ? ["", "Source context around the unresolved reference:", sourceContext] : []),
  ].join("\n");
}

function buildReferenceIssuesFixPrompt(project: ProjectSummary, issues: ProjectReferenceIssue[], sourceContexts: string[] = []) {
  const shownIssues = issues.slice(0, MAX_CODEX_REFERENCE_ISSUES);
  return [
    "Fix unresolved LaTeX citations and labels in this project.",
    "Work through the listed issues in order and make the smallest useful edits.",
    "Use the source contexts below as the primary locations for the first fixes.",
    "For missing citations, first look for existing BibTeX key typos or nearby bibliography evidence.",
    "Do not invent bibliographic facts. If there is not enough evidence to add a real BibTeX entry, leave a clear TODO comment instead.",
    "For missing labels, correct the key or add a label only when the intended target is clear.",
    "Keep unrelated paper content unchanged and keep the project compiling.",
    "",
    `Project: ${project.name}`,
    `Main file: ${project.mainFile}`,
    `Unresolved references shown: ${shownIssues.length}/${issues.length}`,
    ...shownIssues.map((issue, index) => `${index + 1}. [${issue.kind}] ${issue.file}:${issue.line}: ${issue.key}`),
    issues.length > shownIssues.length ? `... ${issues.length - shownIssues.length} more unresolved references omitted` : "",
    ...(sourceContexts.length
      ? [
          "",
          `Source contexts around the first unresolved references (${sourceContexts.length}/${Math.min(
            issues.length,
            MAX_CODEX_REFERENCE_SOURCE_SNIPPETS,
          )} shown):`,
          ...sourceContexts,
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function autoSaveStatusLabel(state: AutoSaveState, enabled: boolean) {
  if (!enabled) return "手动保存";
  if (state === "saving") return "保存中";
  if (state === "saved") return "已保存";
  if (state === "error") return "保存失败";
  return "自动保存";
}

function countEditorText(value: string) {
  const visibleText = value
    .split("\n")
    .map((line) => editorCountableLatexLine(stripLatexLineComment(line)))
    .join(" ");
  return countPlainEditorText(visibleText);
}

function editorCountableLatexLine(line: string) {
  return line
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z@]+\*?(?:\s*\[[^\]]*\])?/g, " ")
    .replace(/[{}$^_&#~]/g, " ");
}

function countPlainEditorText(text: string) {
  let words = 0;
  let characters = 0;
  const segments = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu) ?? [];
  for (const segment of segments) {
    characters += [...segment].length;
    words += 1;
  }
  return { words, characters };
}

function formatEditorWordSummary(count: { words: number; characters: number }) {
  return `当前文件 ${count.words.toLocaleString("zh-CN")} 词 / ${count.characters.toLocaleString("zh-CN")} 字`;
}

function outlineKindLabel(kind: OutlineItem["kind"]) {
  if (kind === "part") return "PART";
  if (kind === "chapter") return "CH";
  if (kind === "section") return "SEC";
  if (kind === "subsection") return "SUB";
  if (kind === "subsubsection") return "S3";
  if (kind === "paragraph") return "PAR";
  if (kind === "subparagraph") return "S-PAR";
  return "LABEL";
}

function todoKindLabel(kind: ProjectTodo["kind"]) {
  if (kind === "FIXME") return "FIX";
  if (kind === "REVIEW") return "REV";
  if (kind === "NOTE") return "NOTE";
  return "TODO";
}

const latexCitationCommands = new Set([
  "cite",
  "citet",
  "citep",
  "citealp",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "supercite",
  "nocite",
]);

const latexLabelCommands = new Set([
  "ref",
  "eqref",
  "autoref",
  "cref",
  "labelcref",
  "vref",
  "pageref",
]);

function latexReferenceKindForCommand(command: string): ProjectSymbol["kind"] | null {
  const normalizedCommand = command.toLowerCase();
  if (latexCitationCommands.has(normalizedCommand)) return "citation";
  if (latexLabelCommands.has(normalizedCommand)) return "label";
  return null;
}

function latexReferenceCompletionContext(linePrefix: string): {
  kind: ProjectSymbol["kind"];
  startColumn: number;
  token: string;
} | null {
  const openBraceIndex = linePrefix.lastIndexOf("{");
  if (openBraceIndex < 0) return null;
  const afterBrace = linePrefix.slice(openBraceIndex + 1);
  if (afterBrace.includes("}")) return null;

  const beforeBrace = linePrefix.slice(0, openBraceIndex);
  const commandMatch = beforeBrace.match(/\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*$/);
  if (!commandMatch) return null;

  const kind = latexReferenceKindForCommand(commandMatch[1]);
  if (!kind) return null;

  const lastCommaIndex = linePrefix.lastIndexOf(",");
  const delimiterIndex = lastCommaIndex > openBraceIndex ? lastCommaIndex : openBraceIndex;
  let tokenStartIndex = delimiterIndex + 1;
  while (linePrefix[tokenStartIndex] === " " || linePrefix[tokenStartIndex] === "\t") {
    tokenStartIndex += 1;
  }
  return {
    kind,
    startColumn: tokenStartIndex + 1,
    token: linePrefix.slice(tokenStartIndex),
  };
}

function latexReferenceAtPosition(
  model: Pick<MonacoEditor.ITextModel, "getLineContent">,
  position: { lineNumber: number; column: number },
): {
  kind: ProjectSymbol["kind"];
  key: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
} | null {
  const line = model.getLineContent(position.lineNumber);
  const rawCursorIndex = Math.max(0, Math.min(position.column - 1, line.length));
  const openBraceIndex = line.lastIndexOf("{", rawCursorIndex);
  if (openBraceIndex < 0) return null;

  const closeBraceIndex = line.indexOf("}", openBraceIndex + 1);
  const contentStartIndex = openBraceIndex + 1;
  const contentEndIndex = closeBraceIndex >= 0 ? closeBraceIndex : line.length;
  if (contentStartIndex >= contentEndIndex) return null;
  if (rawCursorIndex < contentStartIndex || rawCursorIndex > contentEndIndex) return null;
  const cursorIndex = rawCursorIndex === contentEndIndex ? rawCursorIndex - 1 : rawCursorIndex;

  const beforeBrace = line.slice(0, openBraceIndex);
  const commandMatch = beforeBrace.match(/\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*$/);
  if (!commandMatch) return null;

  const kind = latexReferenceKindForCommand(commandMatch[1]);
  if (!kind) return null;

  const content = line.slice(contentStartIndex, contentEndIndex);
  const relativeCursor = Math.max(0, Math.min(cursorIndex - contentStartIndex, content.length));
  let tokenLeft = relativeCursor;
  while (tokenLeft > 0 && content[tokenLeft - 1] !== ",") {
    tokenLeft -= 1;
  }
  let tokenRight = relativeCursor;
  while (tokenRight < content.length && content[tokenRight] !== ",") {
    tokenRight += 1;
  }

  const rawToken = content.slice(tokenLeft, tokenRight);
  const leadingWhitespace = rawToken.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespace = rawToken.match(/\s*$/)?.[0].length ?? 0;
  const keyStartOffset = tokenLeft + leadingWhitespace;
  const keyEndOffset = tokenRight - trailingWhitespace;
  if (keyStartOffset >= keyEndOffset) return null;

  const tokenStartIndex = contentStartIndex + keyStartOffset;
  const tokenEndIndex = contentStartIndex + keyEndOffset;
  if (cursorIndex < tokenStartIndex || cursorIndex >= tokenEndIndex) return null;

  return {
    kind,
    key: line.slice(tokenStartIndex, tokenEndIndex),
    range: {
      startLineNumber: position.lineNumber,
      startColumn: tokenStartIndex + 1,
      endLineNumber: position.lineNumber,
      endColumn: tokenEndIndex + 1,
    },
  };
}

type LatexFileCompletionContext = {
  kind: "tex" | "graphics" | "bibliography";
  command: string;
  startColumn: number;
  token: string;
};

type LatexFileReference = {
  kind: LatexFileCompletionContext["kind"];
  command: string;
  path: string;
  resolvedPath?: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
};

const latexTexFileCommands = new Set(["input", "include", "subfile"]);
const latexGraphicsFileCommands = new Set(["includegraphics"]);
const latexBibliographyFileCommands = new Set(["bibliography", "addbibresource", "addglobalbib"]);

function latexFileKindForCommand(command: string): LatexFileCompletionContext["kind"] | null {
  const normalizedCommand = command.toLowerCase();
  if (latexTexFileCommands.has(normalizedCommand)) return "tex";
  if (latexGraphicsFileCommands.has(normalizedCommand)) return "graphics";
  if (latexBibliographyFileCommands.has(normalizedCommand)) return "bibliography";
  return null;
}

function latexFileCompletionContext(linePrefix: string): LatexFileCompletionContext | null {
  const openBraceIndex = linePrefix.lastIndexOf("{");
  if (openBraceIndex < 0) return null;
  const afterBrace = linePrefix.slice(openBraceIndex + 1);
  if (afterBrace.includes("}")) return null;

  const beforeBrace = linePrefix.slice(0, openBraceIndex);
  const commandMatch = beforeBrace.match(/\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*$/);
  if (!commandMatch) return null;

  const command = commandMatch[1].toLowerCase();
  const kind = latexFileKindForCommand(command);
  if (!kind) return null;

  const lastCommaIndex = linePrefix.lastIndexOf(",");
  const delimiterIndex = lastCommaIndex > openBraceIndex ? lastCommaIndex : openBraceIndex;
  let tokenStartIndex = delimiterIndex + 1;
  while (linePrefix[tokenStartIndex] === " " || linePrefix[tokenStartIndex] === "\t") {
    tokenStartIndex += 1;
  }

  return {
    kind,
    command,
    startColumn: tokenStartIndex + 1,
    token: linePrefix.slice(tokenStartIndex),
  };
}

function latexFileReferenceAtPosition(
  model: Pick<MonacoEditor.ITextModel, "getLineContent">,
  position: { lineNumber: number; column: number },
  projectFiles: string[],
): LatexFileReference | null {
  const line = model.getLineContent(position.lineNumber);
  const rawCursorIndex = Math.max(0, Math.min(position.column - 1, line.length));
  const openBraceIndex = line.lastIndexOf("{", rawCursorIndex);
  if (openBraceIndex < 0) return null;

  const closeBraceIndex = line.indexOf("}", openBraceIndex + 1);
  const contentStartIndex = openBraceIndex + 1;
  const contentEndIndex = closeBraceIndex >= 0 ? closeBraceIndex : line.length;
  if (contentStartIndex >= contentEndIndex) return null;
  if (rawCursorIndex < contentStartIndex || rawCursorIndex > contentEndIndex) return null;
  const cursorIndex = rawCursorIndex === contentEndIndex ? rawCursorIndex - 1 : rawCursorIndex;

  const beforeBrace = line.slice(0, openBraceIndex);
  const commandMatch = beforeBrace.match(/\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*$/);
  if (!commandMatch) return null;

  const command = commandMatch[1].toLowerCase();
  const kind = latexFileKindForCommand(command);
  if (!kind) return null;

  const content = line.slice(contentStartIndex, contentEndIndex);
  const relativeCursor = Math.max(0, Math.min(cursorIndex - contentStartIndex, content.length));
  let tokenLeft = relativeCursor;
  while (tokenLeft > 0 && content[tokenLeft - 1] !== ",") {
    tokenLeft -= 1;
  }
  let tokenRight = relativeCursor;
  while (tokenRight < content.length && content[tokenRight] !== ",") {
    tokenRight += 1;
  }

  const rawToken = content.slice(tokenLeft, tokenRight);
  const leadingWhitespace = rawToken.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespace = rawToken.match(/\s*$/)?.[0].length ?? 0;
  const pathStartOffset = tokenLeft + leadingWhitespace;
  const pathEndOffset = tokenRight - trailingWhitespace;
  if (pathStartOffset >= pathEndOffset) return null;

  const tokenStartIndex = contentStartIndex + pathStartOffset;
  const tokenEndIndex = contentStartIndex + pathEndOffset;
  if (cursorIndex < tokenStartIndex || cursorIndex >= tokenEndIndex) return null;

  const path = line.slice(tokenStartIndex, tokenEndIndex);
  return {
    kind,
    command,
    path,
    resolvedPath: resolveLatexProjectFileReference(path, kind, projectFiles),
    range: {
      startLineNumber: position.lineNumber,
      startColumn: tokenStartIndex + 1,
      endLineNumber: position.lineNumber,
      endColumn: tokenEndIndex + 1,
    },
  };
}

function resolveLatexProjectFileReference(
  rawPath: string,
  kind: LatexFileCompletionContext["kind"],
  projectFiles: string[],
) {
  const path = rawPath.trim().replace(/^\.\//, "");
  if (!path) return undefined;
  const candidates = [path];
  const extension = path.split("/").pop()?.includes(".") ? path.split(".").pop()?.toLowerCase() : "";
  if (kind === "tex" && extension !== "tex") {
    candidates.push(`${path}.tex`);
  } else if (kind === "bibliography" && extension !== "bib") {
    candidates.push(`${path}.bib`);
  } else if (kind === "graphics" && !extension) {
    candidates.push(
      ...["pdf", "png", "jpg", "jpeg", "gif", "webp", "eps", "svg"].map((candidateExtension) => `${path}.${candidateExtension}`),
    );
  }
  return candidates.find((candidate) => projectFiles.includes(candidate));
}

function latexFileMatchesContext(file: string, context: LatexFileCompletionContext) {
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  if (context.kind === "tex") return extension === "tex";
  if (context.kind === "bibliography") return extension === "bib";
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp", "eps", "svg"].includes(extension);
}

function latexFileCompletionInsertText(file: string, command: string) {
  if (command === "bibliography" || command === "addglobalbib") {
    return file.replace(/\.bib$/i, "");
  }
  if (["input", "include", "subfile"].includes(command)) {
    return file.replace(/\.tex$/i, "");
  }
  return file;
}

function latexFileCompletionDetail(kind: LatexFileCompletionContext["kind"]) {
  if (kind === "tex") return "Project LaTeX file";
  if (kind === "bibliography") return "Project bibliography file";
  return "Project graphics file";
}

function latexSnippetSuggestions(monacoApi: MonacoApi) {
  return [
    {
      label: "\\section",
      insertText: "\\section{${1:Title}}\n$0",
      detail: "LaTeX section",
      documentation: "Insert a section heading.",
      sortText: "0-section",
    },
    {
      label: "\\subsection",
      insertText: "\\subsection{${1:Title}}\n$0",
      detail: "LaTeX subsection",
      documentation: "Insert a subsection heading.",
      sortText: "0-subsection",
    },
    {
      label: "\\label",
      insertText: "\\label{${1:sec:key}}",
      detail: "LaTeX label",
      documentation: "Insert a label for cross references.",
      sortText: "0-label",
    },
    {
      label: "\\ref",
      insertText: "\\ref{${1:key}}",
      detail: "LaTeX reference",
      documentation: "Insert a reference command.",
      sortText: "0-ref",
    },
    {
      label: "\\cite",
      insertText: "\\cite{${1:key}}",
      detail: "LaTeX citation",
      documentation: "Insert a citation command.",
      sortText: "0-cite",
    },
    {
      label: "\\begin{equation}",
      insertText: "\\begin{equation}\n  ${1}\n\\end{equation}\n$0",
      detail: "Equation environment",
      documentation: "Insert an equation environment.",
      sortText: "1-equation",
    },
    {
      label: "\\begin{align}",
      insertText: "\\begin{align}\n  ${1}\n\\end{align}\n$0",
      detail: "Align environment",
      documentation: "Insert an align environment.",
      sortText: "1-align",
    },
    {
      label: "\\begin{itemize}",
      insertText: "\\begin{itemize}\n  \\item ${1:item}\n\\end{itemize}\n$0",
      detail: "Itemize list",
      documentation: "Insert an itemized list.",
      sortText: "1-itemize",
    },
    {
      label: "\\begin{enumerate}",
      insertText: "\\begin{enumerate}\n  \\item ${1:item}\n\\end{enumerate}\n$0",
      detail: "Enumerate list",
      documentation: "Insert a numbered list.",
      sortText: "1-enumerate",
    },
    {
      label: "\\begin{figure}",
      insertText:
        "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=${1:0.9\\linewidth}]{${2:figures/example.pdf}}\n  \\caption{${3:Caption}}\n  \\label{fig:${4:key}}\n\\end{figure}\n$0",
      detail: "Figure environment",
      documentation: "Insert a figure with includegraphics, caption, and label.",
      sortText: "1-figure",
    },
    {
      label: "\\begin{table}",
      insertText:
        "\\begin{table}[t]\n  \\centering\n  \\caption{${1:Caption}}\n  \\label{tab:${2:key}}\n  \\begin{tabular}{${3:ll}}\n    ${4:Column A} & ${5:Column B} \\\\\n  \\end{tabular}\n\\end{table}\n$0",
      detail: "Table environment",
      documentation: "Insert a table with caption, label, and tabular.",
      sortText: "1-table",
    },
    {
      label: "\\includegraphics",
      insertText: "\\includegraphics[width=${1:0.9\\linewidth}]{${2:path/to/file}}",
      detail: "Include graphics",
      documentation: "Insert an includegraphics command.",
      sortText: "2-includegraphics",
    },
    {
      label: "\\input",
      insertText: "\\input{${1:sections/file}}",
      detail: "Input another tex file",
      documentation: "Insert an input command.",
      sortText: "2-input",
    },
    {
      label: "\\bibliography",
      insertText: "\\bibliography{${1:refs}}",
      detail: "BibTeX bibliography",
      documentation: "Insert a bibliography command.",
      sortText: "2-bibliography",
    },
  ].map((snippet) => ({
    ...snippet,
    command: {
      id: "editor.action.triggerSuggest",
      title: "Suggest",
    },
    keepWhitespace: true,
    rules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }));
}

function loadBooleanPreference(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

function saveBooleanPreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

function loadNumberPreference(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
    if (Number.isFinite(value)) {
      return clamp(value, min, max);
    }
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

function saveNumberPreference(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

function loadViewModePreference(key: string, fallback: ViewMode) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "editor" || value === "split" || value === "preview") {
      return value;
    }
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

function saveViewModePreference(key: string, value: ViewMode) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

function loadShortcutPreferences(): ShortcutMap {
  try {
    const value = window.localStorage.getItem(SHORTCUT_PREF_KEY);
    if (value) {
      const parsed = JSON.parse(value) as Partial<ShortcutMap>;
      return normalizeShortcutMap({ ...DEFAULT_SHORTCUTS, ...parsed });
    }
  } catch {
    // Shortcut customization is optional; defaults keep the editor usable.
  }
  return DEFAULT_SHORTCUTS;
}

function saveShortcutPreferences(value: ShortcutMap) {
  try {
    window.localStorage.setItem(SHORTCUT_PREF_KEY, JSON.stringify(normalizeShortcutMap(value)));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

function normalizeShortcutMap(value: Partial<ShortcutMap>): ShortcutMap {
  return SHORTCUT_DEFINITIONS.reduce((accumulator, definition) => {
    accumulator[definition.id] =
      normalizeShortcutInput(value[definition.id] ?? DEFAULT_SHORTCUTS[definition.id]) ||
      DEFAULT_SHORTCUTS[definition.id];
    return accumulator;
  }, {} as ShortcutMap);
}

async function restoreEditorSessionTabs(projectRoot: string, mainFile: string) {
  const session = loadProjectEditorSession(projectRoot);
  const candidatePaths = uniqueTextPaths([
    ...(session.openPaths ?? []),
    session.activePath ?? "",
    mainFile,
  ]).slice(0, MAX_RESTORED_EDITOR_TABS);
  const tabs: EditorTab[] = [];

  for (const path of candidatePaths) {
    try {
      tabs.push({
        path,
        content: await readFile(projectRoot, path),
        dirty: false,
      });
    } catch {
      // Stale session entries are ignored; mainFile remains the fallback.
    }
  }

  if (!tabs.length) {
    tabs.push({
      path: mainFile,
      content: await readFile(projectRoot, mainFile),
      dirty: false,
    });
  }

  const activeTab = tabs.find((tab) => tab.path === session.activePath) ?? tabs[0];
  return { tabs, activeTab, recentPaths: uniqueTextPaths(session.recentPaths ?? []) };
}

function uniqueTextPaths(paths: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path || seen.has(path) || !isTextPath(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function existingProjectTextPaths(paths: string[], projectFiles: string[]) {
  const projectFileSet = new Set(projectFiles);
  return uniqueTextPaths(paths).filter((path) => projectFileSet.has(path));
}

function codexAllowedFilesForDiagnostics(
  project: ProjectSummary,
  diagnostics: Diagnostic[],
  projectFiles: string[],
) {
  return existingProjectTextPaths(
    diagnostics
      .map((diagnostic) => (diagnostic.file ? normalizeDiagnosticPath(diagnostic.file, project.root) : ""))
      .filter(Boolean),
    projectFiles,
  );
}

function codexAllowedFilesForTodos(todos: ProjectTodo[], projectFiles: string[]) {
  return existingProjectTextPaths(todos.map((todo) => todo.file), projectFiles);
}

function codexAllowedFilesForReferenceIssues(
  issues: ProjectReferenceIssue[],
  projectFiles: string[],
  bibFiles: string[],
) {
  const issueFiles = issues.map((issue) => issue.file);
  const needsBib = issues.some((issue) => issue.kind === "citation");
  return existingProjectTextPaths([...issueFiles, ...(needsBib ? bibFiles : [])], projectFiles);
}

function loadProjectEditorSession(projectRoot: string): ProjectEditorSession {
  try {
    const raw = window.localStorage.getItem(projectEditorSessionKey(projectRoot));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProjectEditorSession;
    return {
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : undefined,
      openPaths: Array.isArray(parsed.openPaths)
        ? parsed.openPaths.filter((path): path is string => typeof path === "string")
        : [],
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.filter((path): path is string => typeof path === "string")
        : [],
    };
  } catch {
    return {};
  }
}

function saveProjectEditorSession(projectRoot: string, session: ProjectEditorSession) {
  try {
    const openPaths = uniqueTextPaths(session.openPaths ?? []).slice(0, MAX_RESTORED_EDITOR_TABS);
    const recentPaths = uniqueTextPaths([
      session.activePath ?? "",
      ...(session.recentPaths ?? []),
      ...openPaths,
    ]).slice(0, MAX_RECENT_EDITOR_FILES);
    const activePath =
      session.activePath && openPaths.includes(session.activePath)
        ? session.activePath
        : openPaths[0] ?? "";
    window.localStorage.setItem(
      projectEditorSessionKey(projectRoot),
      JSON.stringify({ activePath, openPaths, recentPaths }),
    );
  } catch {
    // Session persistence is helpful but not required for editing.
  }
}

function projectEditorSessionKey(projectRoot: string) {
  return `${PROJECT_EDITOR_SESSION_PREF_PREFIX}:${projectRoot}`;
}

function projectSaveHistorySignatureKey(projectRoot: string) {
  return `${PROJECT_SAVE_HISTORY_SIGNATURE_PREF_PREFIX}:${projectRoot}`;
}

function loadProjectSaveHistorySignature(projectRoot: string) {
  try {
    return window.localStorage.getItem(projectSaveHistorySignatureKey(projectRoot));
  } catch {
    return null;
  }
}

function saveProjectSaveHistorySignature(projectRoot: string, signature: string) {
  try {
    window.localStorage.setItem(projectSaveHistorySignatureKey(projectRoot), signature);
  } catch {
    // History de-duplication is best-effort; failing to persist should not block writing.
  }
}

function isVersionedSaveHistoryLabel(label: string) {
  return label === "手动保存" || label === "自动保存";
}

async function computeProjectTextSaveSignature(projectRoot: string, paths: string[]) {
  const textPaths = uniqueTextPaths(paths).sort();
  let hash = 2166136261;
  let fileCount = 0;
  let totalLength = 0;
  for (const path of textPaths) {
    try {
      const content = await readFile(projectRoot, path);
      fileCount += 1;
      totalLength += content.length;
      hash = updateStableHash(hash, path);
      hash = updateStableHash(hash, "\0");
      hash = updateStableHash(hash, String(content.length));
      hash = updateStableHash(hash, "\0");
      hash = updateStableHash(hash, content);
      hash = updateStableHash(hash, "\0");
    } catch {
      hash = updateStableHash(hash, `missing:${path}\0`);
    }
  }
  return `${fileCount}:${totalLength}:${(hash >>> 0).toString(16)}`;
}

function updateStableHash(seed: number, value: string) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function formatDiagnosticLocation(diagnostic: Diagnostic) {
  if (!diagnostic.file) return "";
  return `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`;
}

function formatDiagnosticText(diagnostic: Diagnostic) {
  return diagnostic.hint ? `${diagnostic.message} Hint: ${diagnostic.hint}` : diagnostic.message;
}

function diagnosticInstallCommand(diagnostic: Diagnostic) {
  if (!diagnostic.hint) return "";
  const match = diagnostic.hint.match(/`(sudo\s+tlmgr\s+install\s+[^`]+)`/);
  return match?.[1]?.trim() ?? "";
}

function diagnosticSeverityLabel(severity: Diagnostic["severity"]) {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "信息";
}

function diagnosticsForPath(result: CompileResult | null, path: string, projectRoot?: string) {
  if (!result || result.success || !path) return [];
  return result.diagnostics.filter((diagnostic) => {
    if (!diagnostic.file || !diagnostic.line) return false;
    return normalizeDiagnosticPath(diagnostic.file, projectRoot ?? "") === path;
  });
}

function hasDiagnosticsForPath(result: CompileResult | null, path: string, projectRoot?: string) {
  return diagnosticsForPath(result, path, projectRoot).some((diagnostic) => diagnostic.severity === "error");
}

function firstNavigableDiagnostic(result: CompileResult, projectRoot: string) {
  return orderedDiagnostics(result.diagnostics).find((diagnostic) => {
    if (!diagnostic.file || !diagnostic.line) return false;
    const relative = normalizeDiagnosticPath(diagnostic.file, projectRoot);
    return Boolean(relative && isTextPath(relative));
  });
}

function firstDiagnosticLocation(result: CompileResult, projectRoot: string) {
  const diagnostic = firstNavigableDiagnostic(result, projectRoot) ?? result.diagnostics[0];
  if (!diagnostic) return "编译日志";
  if (!diagnostic.file) return formatDiagnosticLocation(diagnostic) || "编译日志";
  const relative = normalizeDiagnosticPath(diagnostic.file, projectRoot);
  return `${relative || diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`;
}

function orderedDiagnostics(diagnostics: Diagnostic[]) {
  const severityRank: Record<Diagnostic["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...diagnostics].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]);
}

function diagnosticToMonacoMarker(
  monacoApi: MonacoApi,
  model: MonacoEditor.ITextModel,
  diagnostic: Diagnostic,
) {
  const line = clamp(diagnostic.line ?? 1, 1, Math.max(1, model.getLineCount()));
  const maxColumn = Math.max(1, model.getLineMaxColumn(line));
  const column = clamp(diagnostic.column ?? 1, 1, maxColumn);
  return {
    severity: monacoSeverity(monacoApi, diagnostic.severity),
    message: diagnostic.hint ? `${diagnostic.message}\n\n${diagnostic.hint}` : diagnostic.message,
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column < maxColumn ? maxColumn : column + 1,
    source: "latexmk",
  };
}

function unresolvedLatexReferenceMarkers(
  monacoApi: MonacoApi,
  model: MonacoEditor.ITextModel,
  symbols: ProjectSymbol[],
) {
  const knownKeys = latexReferenceKeySets(symbols);
  const markers = [];
  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    for (const reference of latexReferencesInLine(line, lineNumber)) {
      if (reference.kind === "citation" && reference.key === "*") continue;
      if (knownKeys[reference.kind].has(reference.key)) continue;
      markers.push({
        severity: monacoApi.MarkerSeverity.Warning,
        message:
          reference.kind === "citation"
            ? `未找到 citation \`${reference.key}\`。请检查 .bib 文件或引用键拼写。`
            : `未找到 label \`${reference.key}\`。请检查 \\label 定义或引用键拼写。`,
        startLineNumber: reference.range.startLineNumber,
        startColumn: reference.range.startColumn,
        endLineNumber: reference.range.endLineNumber,
        endColumn: reference.range.endColumn,
        source: "引用与标签",
      });
    }
  }
  return markers;
}

function unresolvedLatexFileReferenceMarkers(
  monacoApi: MonacoApi,
  model: MonacoEditor.ITextModel,
  projectFiles: string[],
) {
  const markers = [];
  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    for (const reference of latexFileReferencesInLine(line, lineNumber, projectFiles)) {
      if (reference.resolvedPath || isDynamicLatexFilePath(reference.path)) continue;
      markers.push({
        severity: monacoApi.MarkerSeverity.Warning,
        message: unresolvedLatexFileMessage(reference),
        startLineNumber: reference.range.startLineNumber,
        startColumn: reference.range.startColumn,
        endLineNumber: reference.range.endLineNumber,
        endColumn: reference.range.endColumn,
        source: "项目文件",
      });
    }
  }
  return markers;
}

function latexReferenceKeySets(symbols: ProjectSymbol[]) {
  const keys = {
    citation: new Set<string>(),
    label: new Set<string>(),
  };
  for (const symbol of symbols) {
    keys[symbol.kind].add(symbol.key);
  }
  return keys;
}

function latexReferencesInLine(line: string, lineNumber: number) {
  const visibleLine = stripLatexLineComment(line);
  const references: Array<{
    kind: ProjectSymbol["kind"];
    key: string;
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
  }> = [];
  const commandPattern = /\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(visibleLine))) {
    const kind = latexReferenceKindForCommand(match[1]);
    if (!kind) continue;
    const commandText = match[0];
    const content = match[2];
    const contentStartIndex = match.index + commandText.lastIndexOf("{") + 1;
    let tokenSearchIndex = 0;
    for (const rawToken of content.split(",")) {
      const tokenOffset = content.indexOf(rawToken, tokenSearchIndex);
      if (tokenOffset < 0) continue;
      tokenSearchIndex = tokenOffset + rawToken.length + 1;
      const key = rawToken.trim();
      if (!key) continue;
      const leadingWhitespace = rawToken.match(/^\s*/)?.[0].length ?? 0;
      const tokenStartIndex = contentStartIndex + tokenOffset + leadingWhitespace;
      references.push({
        kind,
        key,
        range: {
          startLineNumber: lineNumber,
          startColumn: tokenStartIndex + 1,
          endLineNumber: lineNumber,
          endColumn: tokenStartIndex + key.length + 1,
        },
      });
    }
  }
  return references;
}

function latexFileReferencesInLine(line: string, lineNumber: number, projectFiles: string[]) {
  const visibleLine = stripLatexLineComment(line);
  const references: LatexFileReference[] = [];
  const commandPattern = /\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(visibleLine))) {
    const command = match[1].toLowerCase();
    const kind = latexFileKindForCommand(command);
    if (!kind) continue;

    const commandText = match[0];
    const content = match[2];
    const contentStartIndex = match.index + commandText.lastIndexOf("{") + 1;
    let tokenSearchIndex = 0;
    for (const rawToken of content.split(",")) {
      const tokenOffset = content.indexOf(rawToken, tokenSearchIndex);
      if (tokenOffset < 0) continue;
      tokenSearchIndex = tokenOffset + rawToken.length + 1;
      const path = rawToken.trim();
      if (!path) continue;
      const leadingWhitespace = rawToken.match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = rawToken.match(/\s*$/)?.[0].length ?? 0;
      const pathStartIndex = contentStartIndex + tokenOffset + leadingWhitespace;
      const pathEndIndex = contentStartIndex + tokenOffset + rawToken.length - trailingWhitespace;
      references.push({
        kind,
        command,
        path,
        resolvedPath: resolveLatexProjectFileReference(path, kind, projectFiles),
        range: {
          startLineNumber: lineNumber,
          startColumn: pathStartIndex + 1,
          endLineNumber: lineNumber,
          endColumn: pathEndIndex + 1,
        },
      });
    }
  }
  return references;
}

function isDynamicLatexFilePath(path: string) {
  return /[\\{}$#]/.test(path);
}

function unresolvedLatexFileMessage(reference: LatexFileReference) {
  if (reference.kind === "graphics") {
    return `未找到项目资源 \`${reference.path}\`。请检查 \\includegraphics 路径，或先导入图片/PDF 文件。`;
  }
  if (reference.kind === "bibliography") {
    return `未找到 BibTeX 文件 \`${reference.path}\`。请检查 .bib 文件路径或文件名。`;
  }
  return `未找到 LaTeX 文件 \`${reference.path}\`。请检查 \\${reference.command} 路径，或创建对应 .tex 文件。`;
}

function projectPathFromMonacoModel(model: MonacoEditor.ITextModel, projectRoot?: string) {
  const uriPath = safeDecodeUriPath(model.uri.path);
  const normalizedProjectRoot = projectRoot?.replace(/\/+$/, "");
  if (normalizedProjectRoot && uriPath.startsWith(`${normalizedProjectRoot}/`)) {
    return uriPath.slice(normalizedProjectRoot.length + 1);
  }

  const relativePath = uriPath.replace(/^\/+/, "");
  return isTextPath(relativePath) ? relativePath : "";
}

function collectCurrentProjectModelContents(
  projectRoot: string,
  activeEditor: MonacoEditor.IStandaloneCodeEditor | null,
  monacoApi: MonacoApi | null,
) {
  const contents = new Map<string, string>();
  if (!monacoApi) return contents;
  const activeModel = activeEditor?.getModel();
  const normalizedProjectRoot = projectRoot.replace(/\/+$/, "");
  for (const model of monacoApi.editor.getModels()) {
    const uriPath = safeDecodeUriPath(model.uri.path);
    const isCurrentProjectModel = uriPath.startsWith(`${normalizedProjectRoot}/`) || model === activeModel;
    if (!isCurrentProjectModel) continue;
    const modelPath = projectPathFromMonacoModel(model, projectRoot);
    if (!modelPath || !isTextPath(modelPath)) continue;
    contents.set(modelPath, model.getValue());
  }
  return contents;
}

function safeDecodeUriPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function isFormFieldOutsideEditor(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".monaco-editor")) return false;
  return Boolean(target.closest("input, textarea, select") || target.isContentEditable);
}

function monacoSeverity(monacoApi: MonacoApi, severity: Diagnostic["severity"]) {
  if (severity === "error") return monacoApi.MarkerSeverity.Error;
  if (severity === "warning") return monacoApi.MarkerSeverity.Warning;
  return monacoApi.MarkerSeverity.Info;
}

function normalizeDiagnosticPath(file: string, projectRoot: string) {
  if (file.startsWith(projectRoot)) {
    return file.slice(projectRoot.length).replace(/^\/+/, "");
  }
  return file.replace(/^\.\/+/, "");
}

function parentDirectory(path: string) {
  if (!path.includes("/")) return "";
  return path.split("/").slice(0, -1).join("/");
}

function joinProjectPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function suggestedProjectEntryPath(kind: "file" | "directory", parentPath: string) {
  return joinProjectPath(parentPath, kind === "file" ? "new-file.tex" : "new-folder");
}

function collectProjectFiles(nodes: FileNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      result.push(node.path);
    } else {
      result.push(...collectProjectFiles(node.children ?? []));
    }
  }
  return result.sort();
}

function filterProjectFilesForQuickOpen(files: string[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return files;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return files
    .filter((file) => {
      const haystack = file.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((left, right) => {
      const leftName = shortFileName(left).toLowerCase();
      const rightName = shortFileName(right).toLowerCase();
      const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;
      return leftStarts - rightStarts || left.length - right.length || left.localeCompare(right);
    });
}

function codexMentionQueryAtCursor(value: string, cursor: number): CodexMentionQuery | null {
  const safeCursor = clamp(cursor, 0, value.length);
  const beforeCursor = value.slice(0, safeCursor);
  const match = beforeCursor.match(/(^|[\s([{:，、])([@#])([^\s,;，。；：!?！？)）\]}]*)$/);
  if (!match) return null;
  const trigger = match[2] as CodexMentionQuery["trigger"];
  const query = match[3] ?? "";
  const start = beforeCursor.length - trigger.length - query.length;
  return { trigger, query, start, end: safeCursor };
}

function codexMentionSuggestionsForQuery(
  mention: CodexMentionQuery,
  files: string[],
  symbols: ProjectSymbol[],
) {
  const normalizedQuery = mention.query.trim().toLowerCase();
  if (mention.trigger === "@") {
    return uniqueTextPaths(files)
      .filter((file) => codexMentionMatches(file, normalizedQuery))
      .sort((left, right) => codexMentionSort(left, right, normalizedQuery))
      .slice(0, MAX_CODEX_MENTION_SUGGESTIONS)
      .map<CodexMentionSuggestion>((file) => ({
        kind: "file",
        value: file,
        title: file,
        detail: "项目文件",
      }));
  }

  const keyCounts = new Map<string, number>();
  for (const symbol of symbols) {
    const lowerKey = symbol.key.toLowerCase();
    keyCounts.set(lowerKey, (keyCounts.get(lowerKey) ?? 0) + 1);
  }
  const seen = new Set<string>();
  return symbols
    .filter((symbol) => {
      const dedupeKey = `${symbol.kind}:${symbol.key.toLowerCase()}`;
      if (
        seen.has(dedupeKey) ||
        (keyCounts.get(symbol.key.toLowerCase()) ?? 0) !== 1 ||
        !codexMentionMatches(symbol.key, normalizedQuery)
      ) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => codexMentionSort(left.key, right.key, normalizedQuery))
    .slice(0, MAX_CODEX_MENTION_SUGGESTIONS)
    .map<CodexMentionSuggestion>((symbol) => ({
      kind: symbol.kind,
      value: symbol.key,
      title: symbol.key,
      detail: `${symbol.detail ?? symbol.kind} · ${symbol.file}:${symbol.line}`,
    }));
}

function codexMentionMatches(value: string, query: string) {
  if (!query) return true;
  return value.toLowerCase().includes(query);
}

function codexMentionSort(left: string, right: string, query: string) {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftShort = shortFileName(left).toLowerCase();
  const rightShort = shortFileName(right).toLowerCase();
  const leftStarts = query && (leftShort.startsWith(query) || leftLower.startsWith(query)) ? 0 : 1;
  const rightStarts = query && (rightShort.startsWith(query) || rightLower.startsWith(query)) ? 0 : 1;
  return leftStarts - rightStarts || left.length - right.length || left.localeCompare(right);
}

function codexMentionKindLabel(kind: CodexMentionSuggestion["kind"]) {
  if (kind === "file") return "@";
  return kind === "citation" ? "cite" : "label";
}

function uniqueProjectSymbolByKey(symbols: ProjectSymbol[], key: string) {
  const matches = symbols.filter((symbol) => symbol.key.toLowerCase() === key.toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}

function removeCodexPromptMention(prompt: string, trigger: "@" | "#", value: string) {
  const candidates =
    trigger === "@"
      ? uniqueStrings([
          value,
          shortFileName(value),
          value.replace(/\.[^/.]+$/, ""),
          shortFileName(value).replace(/\.[^/.]+$/, ""),
        ])
      : [value];
  let nextPrompt = prompt;
  for (const candidate of candidates.filter(Boolean)) {
    const pattern = new RegExp(
      `(^|[\\s([{:，、])${escapeRegExp(trigger)}${escapeRegExp(candidate)}(?=$|[\\s,;，。；：!?！？)）\\]}])`,
      "g",
    );
    nextPrompt = nextPrompt.replace(pattern, (_match, prefix: string) => prefix);
  }
  return nextPrompt
    .replace(/\s+([,;，。；：!?！？)）\]}])/g, "$1")
    .replace(/([：:])\s*([,，])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quickOpenMatchRanges(value: string, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const lowerValue = value.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const start = lowerValue.indexOf(token);
    if (start >= 0) {
      ranges.push([start, start + token.length]);
    }
  }
  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  return ranges.reduce<Array<[number, number]>>((merged, range) => {
    const previous = merged[merged.length - 1];
    if (!previous || range[0] > previous[1]) {
      merged.push(range);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
    return merged;
  }, []);
}

function renderQuickOpenMatch(value: string, query: string) {
  const ranges = quickOpenMatchRanges(value, query);
  if (!ranges.length) return value;
  const parts = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) {
      parts.push(value.slice(cursor, start));
    }
    parts.push(
      <mark className="quick-open-highlight" key={`${start}:${end}:${index}`}>
        {value.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }
  return parts;
}

function engineStatus(environment: EnvironmentStatus, engine: ProjectSettings["engine"]) {
  if (engine === "pdflatex") return environment.pdflatex;
  if (engine === "lualatex") return environment.lualatex;
  return environment.xelatex;
}

function codexEditorDecorationsForPath(
  monacoApi: MonacoApi,
  summary: DiffSummary,
  path: string,
  lineCount: number,
  acceptedHunkKeys: string[] = [],
): MonacoEditor.IModelDeltaDecoration[] {
  const maxLine = Math.max(1, lineCount);
  const fileDiff = parseUnifiedDiff(summary.unifiedDiff).find((file) => file.file === path);
  if (!fileDiff) return [];
  return codexChangedLineEntries(fileDiff, new Set(acceptedHunkKeys))
    .map(({ kind, lineNumber }): MonacoEditor.IModelDeltaDecoration => {
      const safeLineNumber = clamp(lineNumber, 1, maxLine);
      const isAddition = kind === "add";
      return {
        range: new monacoApi.Range(safeLineNumber, 1, safeLineNumber, 1),
        options: {
          isWholeLine: true,
          className: isAddition ? "codex-editor-line-added" : "codex-editor-line-removed",
          linesDecorationsClassName: isAddition
            ? "codex-editor-line-added-gutter"
            : "codex-editor-line-removed-gutter",
          hoverMessage: {
            value: isAddition ? "Codex 新增的内容" : "Codex 删除内容对应的位置",
          },
          overviewRuler: {
            color: isAddition ? "#1f8f48" : "#c43b3b",
            position: monacoApi.editor.OverviewRulerLane.Right,
          },
        },
      };
    })
    .filter((decoration): decoration is MonacoEditor.IModelDeltaDecoration => Boolean(decoration));
}

function reviewEditorDecorationsForModel(
  monacoApi: MonacoApi,
  model: MonacoEditor.ITextModel,
): MonacoEditor.IModelDeltaDecoration[] {
  const decorations: MonacoEditor.IModelDeltaDecoration[] = [];
  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    const commentStart = latexCommentStartIndex(line);
    if (commentStart < 0) continue;
    const parsed = parseLatexTodoCommentText(line.slice(commentStart + 1));
    if (!parsed || parsed.kind !== "REVIEW") continue;
    const endLine = reviewBlockEndLine(model, lineNumber);
    decorations.push({
      range: new monacoApi.Range(lineNumber, 1, endLine, model.getLineMaxColumn(endLine)),
      options: {
        isWholeLine: true,
        className: parsed.resolved ? "review-editor-block-resolved" : "review-editor-block",
        linesDecorationsClassName: parsed.resolved
          ? "review-editor-line-resolved-gutter"
          : "review-editor-line-gutter",
        hoverMessage: {
          value: parsed.resolved ? `已解决 REVIEW：${parsed.message}` : `REVIEW：${parsed.message}`,
        },
        overviewRuler: {
          color: parsed.resolved ? "#9aa6b2" : "#d99a1b",
          position: monacoApi.editor.OverviewRulerLane.Right,
        },
      },
    });
    lineNumber = endLine;
  }
  return decorations;
}

function codexChangedLineNumbersForPath(summary: DiffSummary, path: string, acceptedHunkKeys: string[] = []) {
  const fileDiff = parseUnifiedDiff(summary.unifiedDiff).find((file) => file.file === path);
  if (!fileDiff) return [];
  return Array.from(new Set(codexChangedLineEntries(fileDiff, new Set(acceptedHunkKeys)).map((entry) => entry.lineNumber))).sort(
    (left, right) => left - right,
  );
}

function codexChangedLineEntries(fileDiff: ParsedDiffFile, acceptedHunkKeys: Set<string> = new Set()) {
  return parsedDiffHunks(fileDiff).flatMap((hunk) => {
    if (acceptedHunkKeys.has(codexDiffHunkKey(fileDiff.file, hunk))) return [];
    return hunk.lines
      .map((line, index) => {
        if (line.kind !== "add" && line.kind !== "remove") return null;
        return {
          kind: line.kind,
          lineNumber: line.newLine ?? nearestDiffLine(hunk.lines, index) ?? line.oldLine ?? 1,
        };
      })
      .filter((entry): entry is { kind: "add" | "remove"; lineNumber: number } => Boolean(entry));
  });
}

function codexEditorContextFromHunk(file: string, hunk: ParsedDiffHunk): CodexEditorContext {
  const currentLines = hunk.lines.filter((line) => line.kind !== "remove").map((line) => line.content);
  const fallbackLines = hunk.lines.filter((line) => line.kind !== "add").map((line) => line.content);
  const contextLines = currentLines.length ? currentLines : fallbackLines;
  const selectedText = contextLines.join("\n");
  const nearbyText = contextLines.join("\n");
  const cursorLine = Math.max(1, hunk.newStart ?? hunk.oldStart ?? 1);
  const selectionEndLine = selectedText
    ? cursorLine + Math.max(0, contextLines.length - 1)
    : undefined;
  return {
    source: "diff-hunk",
    file,
    cursorLine,
    cursorColumn: 1,
    selectedText,
    selectedCharCount: selectedText.length,
    selectionStartLine: selectedText ? cursorLine : undefined,
    selectionEndLine,
    truncated: false,
    nearbyStartLine: cursorLine,
    nearbyEndLine: cursorLine + Math.max(0, contextLines.length - 1),
    nearbyText,
    nearbyTruncated: false,
  };
}

function nearestDiffLine(lines: ParsedDiffLine[], index: number) {
  for (let offset = 1; offset < lines.length; offset += 1) {
    const nextLine = lines[index + offset]?.newLine;
    if (nextLine) return nextLine;
    const previousLine = lines[index - offset]?.newLine;
    if (previousLine) return previousLine;
  }
  return undefined;
}

function diffTargetLine(line: ParsedDiffLine) {
  return line.newLine ?? line.oldLine;
}

function formatDiffLineNumber(line?: number) {
  return line ? line.toLocaleString("zh-CN") : "";
}

function diffPrefix(kind: ParsedDiffLine["kind"]) {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return "";
}

function shortFileName(path: string) {
  return path.split("/").pop() || path;
}

function remapActivePathAfterRename(activePath: string, fromPath: string, toPath: string) {
  if (activePath === fromPath) return toPath;
  if (activePath.startsWith(`${fromPath}/`)) {
    return `${toPath}${activePath.slice(fromPath.length)}`;
  }
  return activePath;
}

function isProjectMainPathAffected(mainFile: string, targetPath: string) {
  return mainFile === targetPath || mainFile.startsWith(`${targetPath}/`);
}

function tailLog(log: string) {
  return log.split("\n").slice(-80).join("\n").trim() || "没有日志输出。";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
