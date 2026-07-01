import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const editorLogic = readFileSync(new URL("../src/lib/editorLogic.ts", import.meta.url), "utf8");
const codexContext = readFileSync(new URL("../src/lib/codexContext.ts", import.meta.url), "utf8");
const monacoLatex = readFileSync(new URL("../src/lib/monacoLatex.ts", import.meta.url), "utf8");
const preferences = readFileSync(new URL("../src/lib/preferences.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const editorLogicTests = readFileSync(new URL("./test-editor-logic.mjs", import.meta.url), "utf8");
const tauriConfig = readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const macInfoPlist = readFileSync(new URL("../src-tauri/Info.plist", import.meta.url), "utf8");
const tauri = readFileSync(new URL("../src/tauri.ts", import.meta.url), "utf8");
const pdfPreview = readFileSync(new URL("../src/components/PdfPreview.tsx", import.meta.url), "utf8");
const fileTreeNode = readFileSync(new URL("../src/components/FileTreeNode.tsx", import.meta.url), "utf8");
const toolPill = readFileSync(new URL("../src/components/ToolPill.tsx", import.meta.url), "utf8");
const codexAnswerView = readFileSync(new URL("../src/components/CodexAnswerView.tsx", import.meta.url), "utf8");
const codexContextStrip = readFileSync(new URL("../src/components/CodexContextStrip.tsx", import.meta.url), "utf8");
const codexDiffView = readFileSync(new URL("../src/components/CodexDiffView.tsx", import.meta.url), "utf8");
const codexHistoryList = readFileSync(new URL("../src/components/CodexHistoryList.tsx", import.meta.url), "utf8");
const codexMentionMenu = readFileSync(new URL("../src/components/CodexMentionMenu.tsx", import.meta.url), "utf8");
const codexProgressView = readFileSync(new URL("../src/components/CodexProgressView.tsx", import.meta.url), "utf8");
const compileErrorPanel = readFileSync(new URL("../src/components/CompileErrorPanel.tsx", import.meta.url), "utf8");
const diagnostics = readFileSync(new URL("../src/lib/diagnostics.ts", import.meta.url), "utf8");
const safetyConfirmDialog = readFileSync(new URL("../src/components/SafetyConfirmDialog.tsx", import.meta.url), "utf8");
const appAndPreferences = `${app}\n${preferences}`;
const appAndToolPill = `${app}\n${toolPill}`;
const appAndCodexAnswer = `${app}\n${codexAnswerView}`;
const appAndCodexContextStrip = `${app}\n${codexContextStrip}\n${codexContext}`;
const appAndCodexDiff = `${app}\n${codexDiffView}`;
const appAndCodexHistory = `${app}\n${codexHistoryList}\n${codexDiffView}`;
const appAndCodexMentionMenu = `${app}\n${codexMentionMenu}`;
const appAndCodexProgress = `${app}\n${codexProgressView}`;
const appAndCodexContext = `${app}\n${codexContext}`;
const appAndCompileErrorPanel = `${app}\n${compileErrorPanel}\n${diagnostics}`;
const appAndSafetyConfirmDialog = `${app}\n${safetyConfirmDialog}`;
const appCodexDiffAndContext = `${appAndCodexDiff}\n${codexContext}`;

const checks = [];

function addCheck(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
}

function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function cssBlocks(selector) {
  const blocks = [];
  let offset = 0;
  while (offset < styles.length) {
    const start = styles.indexOf(`${selector} {`, offset);
    if (start < 0) break;
    const end = styles.indexOf("\n}", start);
    if (end < 0) break;
    blocks.push(styles.slice(start, end + 2));
    offset = end + 2;
  }
  return blocks;
}

function hasCssBlock(selector, values) {
  return cssBlocks(selector).some((block) => includesAll(block, values));
}

addCheck(
  "workspace exposes sidebar and preview CSS width variables",
  includesAll(app, ['"--sidebar-width"', '"--preview-width"', "workspaceStyle", "workspaceClassName"]),
);

addCheck(
  "workspace layout widths, view mode, and panel collapse states persist across app launches",
  includesAll(appAndPreferences, [
    'const SIDEBAR_WIDTH_PREF_KEY = "latex-studio:sidebar-width"',
    'const PREVIEW_WIDTH_PREF_KEY = "latex-studio:preview-width"',
    'const VIEW_MODE_PREF_KEY = "latex-studio:view-mode"',
    'const SIDEBAR_COLLAPSED_PREF_KEY = "latex-studio:sidebar-collapsed"',
    'const PREVIEW_COLLAPSED_PREF_KEY = "latex-studio:preview-collapsed"',
    'const CODEX_COLLAPSED_PREF_KEY = "latex-studio:codex-collapsed"',
    'const OUTLINE_COLLAPSED_PREF_KEY = "latex-studio:outline-collapsed"',
    'const SYMBOLS_COLLAPSED_PREF_KEY = "latex-studio:symbols-collapsed"',
    'const TODOS_COLLAPSED_PREF_KEY = "latex-studio:todos-collapsed"',
    "loadNumberPreference(SIDEBAR_WIDTH_PREF_KEY",
    "loadNumberPreference(PREVIEW_WIDTH_PREF_KEY",
    "loadViewModePreference(VIEW_MODE_PREF_KEY",
    "loadBooleanPreference(SIDEBAR_COLLAPSED_PREF_KEY",
    "loadBooleanPreference(PREVIEW_COLLAPSED_PREF_KEY",
    "loadBooleanPreference(CODEX_COLLAPSED_PREF_KEY",
    "loadBooleanPreference(OUTLINE_COLLAPSED_PREF_KEY",
    "loadBooleanPreference(SYMBOLS_COLLAPSED_PREF_KEY",
    "loadBooleanPreference(TODOS_COLLAPSED_PREF_KEY",
    "saveNumberPreference(SIDEBAR_WIDTH_PREF_KEY, sidebarWidth)",
    "saveNumberPreference(PREVIEW_WIDTH_PREF_KEY, previewWidth)",
    "saveViewModePreference(VIEW_MODE_PREF_KEY, viewMode)",
    "saveBooleanPreference(SIDEBAR_COLLAPSED_PREF_KEY, isSidebarCollapsed)",
    "saveBooleanPreference(PREVIEW_COLLAPSED_PREF_KEY, isPreviewCollapsed)",
    "saveBooleanPreference(CODEX_COLLAPSED_PREF_KEY, isCodexCollapsed)",
    "saveBooleanPreference(OUTLINE_COLLAPSED_PREF_KEY, isOutlineCollapsed)",
    "saveBooleanPreference(SYMBOLS_COLLAPSED_PREF_KEY, isSymbolsCollapsed)",
    "saveBooleanPreference(TODOS_COLLAPSED_PREF_KEY, isTodosCollapsed)",
    "MIN_SIDEBAR_WIDTH",
    "MAX_SIDEBAR_WIDTH",
    "MAX_PERSISTED_PREVIEW_WIDTH",
  ]),
);

addCheck(
  "preview resize updates the workspace preview variable and relayouts Monaco",
  includesAll(app, [
    'startResize(panel: "sidebar" | "preview"',
    'workspaceRef.current?.style.setProperty("--preview-width"',
    "function layoutEditorToPanel()",
    'querySelector<HTMLElement>(".monaco-editor-host")',
    "editor.layout({",
    'startResize("preview", event)',
  ]) &&
    includesAll(styles, [
      ".monaco-editor-host",
      "overflow: hidden;",
      "max-width: 100%;",
    ]),
);

addCheck(
  "workspace uses grid areas so preview resizing reflows the editor toolbar",
  hasCssBlock(".workspace", [
    "display: grid;",
    "grid-template-columns: var(--sidebar-width) 12px minmax(0, 1fr) 12px var(--preview-width);",
    'grid-template-areas: "sidebar sidebar-resize editor preview-resize preview";',
  ]) &&
  hasCssBlock(".editor-panel", [
    "position: relative;",
    "grid-area: editor;",
    "grid-template-rows: 48px minmax(0, 1fr) 28px;",
  ]) &&
    hasCssBlock(".toolbar-actions", ["flex: 0 1 auto;", "overflow: visible;"]) &&
    hasCssBlock(
      ".latex-insert-toolbar,\n.editor-toolbar .toolbar-actions > :not(.go-to-line-form)",
      ["display: none;"],
    ) &&
    app.includes('<div className="editor-toolbar">'),
);

addCheck(
  "compact chrome leaves more vertical space for editor and PDF preview",
  includesAll(styles, [
    "/* Compact polish: leave more room for writing and preview. */",
    "grid-template-rows: 42px minmax(0, 1fr);",
    "grid-template-rows: 38px minmax(0, 1fr) 24px;",
    "grid-template-rows: 34px minmax(0, 1fr);",
    ".codex-command-key-hint,",
    ".project-actions-minimal button:not(.topbar-compile-button) span",
    ".codex-command-center-sidebar .codex-command-bar textarea",
  ]) && app.includes(': "让 Codex 修改..."'),
);

addCheck(
  "shared editor logic is covered by a zero-dependency frontend test script",
  includesAll(app, [
    'from "./lib/editorLogic"',
    "eventMatchesShortcut",
    "parseUnifiedDiff",
    "parseLatexTodoCommentText",
    "stripLatexLineComment",
  ]) &&
    includesAll(editorLogic, [
      "export function normalizeShortcutInput",
      "export function eventMatchesShortcut",
      "export function parseLatexTodoCommentText",
      "export function parseUnifiedDiff",
      "export type ParsedDiffFile",
    ]) &&
    includesAll(editorLogicTests, [
      "typescript",
      "parseUnifiedDiff(diff)",
      "parseLatexTodoCommentText(\"RESOLVED REVIEW: clarify baseline\")",
      "eventMatchesShortcut(",
      "editor logic tests passed",
    ]) &&
    packageJson.includes('"test:logic": "node scripts/test-editor-logic.mjs"'),
);

addCheck(
  "Codex editor context display rules live outside the main App component",
  includesAll(app, [
    'from "./lib/codexContext"',
    "codexContextKindLabel",
    "codexContextLineRange",
    "codexCitationSource",
    "formatCodexContextHint",
    "CodexEditorContext,",
  ]) &&
    includesAll(types, [
      "export type CodexEditorContext",
      'source?: "editor" | "diff-hunk"',
      "activeSectionSource?:",
      "nearbyText: string",
    ]) &&
    includesAll(codexContext, [
      "export function formatCodexContextHint",
      "export function codexContextKindLabel",
      "export function codexContextLineRange",
      "export function codexContextSource",
      "Codex 片段",
      "锁定片段",
    ]) &&
    includesAll(editorLogicTests, [
      "codexContext.formatCodexContextHint",
      "codexContext.codexContextKindLabel",
      "codexContext.codexContextLineRange",
      "codexContext.codexContextSource",
    ]) &&
    !app.includes("function formatCodexContextHint") &&
    !app.includes("function codexContextKindLabel"),
);

addCheck(
  "Monaco LaTeX language and theme live outside the main App component",
  includesAll(app, [
    'from "./lib/monacoLatex"',
    "configureMonacoLatexTheme",
    "languageForPath",
    "MONACO_LATEX_THEME",
    "type MonacoApi",
  ]) &&
    includesAll(monacoLatex, [
      "export type MonacoApi",
      "export const MONACO_LATEX_THEME",
      "export function languageForPath",
      "export function configureMonacoLatexTheme",
      'monacoApi.languages.setMonarchTokensProvider("latex"',
      "keyword.latex",
      "comment.latex",
    ]) &&
    !app.includes("setMonarchTokensProvider(\"latex\""),
);

addCheck(
  "Vite splits heavy editor and PDF libraries away from the main app chunk",
  includesAll(viteConfig, [
    "manualChunks(id)",
    'id.includes("pdfjs-dist")',
    'return "pdf-viewer"',
    'id.includes("monaco-editor")',
    'id.includes("@monaco-editor")',
    'return "editor-core"',
    'return "react-vendor"',
  ]),
);

addCheck(
  "PDF preview engine loads only when a compiled PDF is available",
  includesAll(app, [
    "const PdfPreview = lazy(() =>",
    'import("./components/PdfPreview")',
    "<Suspense fallback={<PdfPreviewLoadingState />}>",
    ") : pdfPath ? (",
    "<PdfPreviewEmptyState />",
  ]) &&
    !app.includes('import { PdfPreview } from "./components/PdfPreview"'),
);

addCheck(
  "asset preview loads only when a project asset is opened",
  includesAll(app, [
    "const AssetPreview = lazy(() =>",
    'import("./components/AssetPreview")',
    "<Suspense fallback={<AssetPreviewLoadingState />}>",
    "activeAsset ? (",
    "正在加载资源预览",
  ]) &&
    !app.includes('import { AssetPreview } from "./components/AssetPreview"'),
);

addCheck(
  "preview panel and resize handle occupy their own grid columns",
  hasCssBlock(".preview-panel", ["position: relative;", "grid-area: preview;", "width: auto;"]) &&
    hasCssBlock(".preview-resize-handle", ["grid-area: preview-resize;"]) &&
    hasCssBlock(".workspace-preview .preview-panel", ["grid-area: preview;"]) &&
    includesAll(app, [
      "MAX_PERSISTED_PREVIEW_WIDTH",
      "available - MIN_EDITOR_WIDTH",
      "const observer = new ResizeObserver(clampPreviewTrack)",
    ]),
);

addCheck(
  "PDF preview supports direct page-number jump in the toolbar",
  includesAll(pdfPreview, [
    "pageInput",
    "handlePageSubmit",
    'className="pdf-page-control"',
    'className="pdf-toolbar-group pdf-page-group"',
    'aria-label="PDF 页码"',
    "inputMode=\"numeric\"",
  ]) && hasCssBlock(".pdf-page-control", ["display: inline-flex;", "min-width: 82px;"]),
);

addCheck(
  "PDF preview keeps page navigation in the toolbar without a lower page strip",
  includesAll(pdfPreview, [
    "pageInput",
    "handlePageSubmit",
    'className="pdf-page-control"',
  ]) &&
    hasCssBlock(".pdf-viewer", ["grid-template-rows: auto minmax(0, 1fr);"]) &&
    !pdfPreview.includes("pdf-page-strip") &&
    !styles.includes(".pdf-page-strip"),
);

addCheck(
  "PDF preview defaults to hidden fit-width behavior while keeping compact zoom controls",
  includesAll(pdfPreview, [
    "const DEFAULT_PDF_SCALE = 1.1",
    'type ZoomMode = "fit-width" | "fit-page" | "actual-size" | "custom"',
    'const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width")',
    'setZoomMode("fit-width")',
    'if (zoomMode === "fit-width")',
    'else if (zoomMode === "fit-page")',
    'zoomMode === "actual-size"',
    "nextScale = 1",
    'zoomMode === "custom" ? value : renderedScale',
    "setZoomMode(\"actual-size\")",
    'aria-label="实际大小 100%"',
    "<span>100%</span>",
    "pdf-toolbar-active",
    'className="pdf-toolbar-group pdf-zoom-group"',
  ]) &&
    !pdfPreview.includes("<PanelTop") &&
    !pdfPreview.includes("<Maximize2") &&
    !pdfPreview.includes("<span>适宽</span>") &&
    !pdfPreview.includes("<span>整页</span>"),
);

addCheck(
  "PDF preview preserves page, zoom, and search state across same-file recompiles",
  includesAll(pdfPreview, [
    "setPageInput(\"1\")",
    "setSearchQuery(\"\")",
    "}, [projectRoot, pdfPath]);",
    "}, [projectRoot, pdfPath, revision]);",
    "setPdf(null)",
    "setPageCount(0)",
  ]) &&
    pdfPreview.indexOf("}, [projectRoot, pdfPath]);") < pdfPreview.indexOf("}, [projectRoot, pdfPath, revision]);"),
);

addCheck(
  "PDF preview supports text search with result navigation",
  includesAll(pdfPreview, [
    "searchQuery",
    "searchMatches",
    "PdfSearchRect",
    "handlePdfSearch",
    "getTextContent()",
    "pdfTextItemSearchRect",
    "Util.transform",
    "formatPdfSearchExcerpt",
    'className="pdf-search-control"',
    'className="pdf-search-results"',
    "searchMatches.length > 0 &&",
    'className="pdf-toolbar-group pdf-file-group"',
    'className="pdf-search-highlight"',
    'aria-label="PDF 搜索关键词"',
    'aria-label="PDF 搜索结果导航"',
    "goToSearchMatch",
    "MAX_PDF_SEARCH_MATCHES",
  ]) &&
    !pdfPreview.includes(': "0"') &&
    hasCssBlock(".pdf-search-control", ["display: inline-flex;", "flex: 0 1 260px;", "min-width: 180px;"]) &&
    hasCssBlock(".pdf-search-control input", ["height: 26px;", "width: 100%;"]) &&
    hasCssBlock(".pdf-search-results", ["display: inline-flex;", "gap: 2px;", "min-width: 0;"]) &&
    hasCssBlock(".pdf-search-results span", ["flex: 0 0 44px;", "text-overflow: ellipsis;"]) &&
    hasCssBlock(".pdf-search-highlight", [
      "background: rgba(64, 178, 164, 0.24);",
      "position: absolute;",
    ]),
);

addCheck(
  "PDF reverse SyncTeX requires Cmd/Ctrl-click without hover tooltip noise",
  includesAll(pdfPreview, [
    "function handlePageClick",
    "if (!event.metaKey && !event.ctrlKey) return;",
    "onSourceSync(page, x / renderedScale, y / renderedScale)",
  ]) &&
    !pdfPreview.includes("按住 ⌘（Mac）或 Ctrl 后点击 PDF，可跳到源码") &&
    !pdfPreview.includes("title={onSourceSync") &&
    hasCssBlock(".pdf-toolbar-group", ["display: inline-flex;", "border-radius: 9px;"]) &&
    hasCssBlock(".pdf-page-shell-clickable", ["cursor: default;"]),
);

addCheck(
  "PDF reverse SyncTeX briefly highlights the located source line",
  includesAll(app, [
    "sourceSyncHighlight",
    "sourceSyncDecorationCollectionRef",
    "setSourceSyncHighlight({ file: location.file, line: location.line, nonce: Date.now() })",
    "source-sync-editor-line",
    "source-sync-editor-gutter",
    "PDF 反向定位到",
    "monacoApi.editor.OverviewRulerLane.Right",
  ]) &&
    hasCssBlock(".source-sync-editor-line", ["linear-gradient", "rgba(44, 120, 183, 0.2)"]) &&
    hasCssBlock(".source-sync-editor-gutter", ["border-left: 4px solid #2c78b7;"]),
);

addCheck(
  "editor-only, split, and preview-only modes are exposed through the minimal view toggle",
  includesAll(appAndPreferences, [
    'type ViewMode = "editor" | "split" | "preview"',
    "handleCycleViewMode",
    "handleTogglePreviewShortcut",
    "viewModeLabel",
    "ViewModeIcon",
    'aria-label="切换视图"',
    'workspace-${viewMode}',
  ]),
);

addCheck(
  "compile errors render in the preview area with clickable diagnostics and Codex fix",
  includesAll(appAndCompileErrorPanel, [
    "compileResult && !compileResult.success",
    "<CompileErrorPanel",
    "onDiagnosticClick",
    "handleDiagnosticClick",
    "handleFixCompileWithCodex",
    "handleExplainCompileWithCodex",
    "handleFixDiagnosticWithCodex",
    "handleExplainDiagnosticWithCodex",
    "buildCompileExplainPrompt",
    "buildDiagnosticFixPrompt",
    "buildDiagnosticExplainPrompt",
    "codexAllowedFilesForDiagnostics(project, result.diagnostics, allProjectFiles)",
    "codexAllowedFilesForDiagnostics(project, [diagnostic], allProjectFiles)",
    "编译诊断相关文件",
    "当前诊断文件",
    "runCodexAskPrompt(await prepareCodexPrompt(prompt), prompt)",
    "onFixDiagnosticWithCodex",
    "onExplainDiagnosticWithCodex",
    "onExplainWithCodex",
    "activeDiagnosticIndex",
    "jumpToDiagnostic",
    'aria-label="编译诊断导航"',
    "handleViewModeChange(\"split\")",
    "setIsPreviewCollapsed(false)",
    "compile-diagnostic-fix-button",
    "compile-diagnostic-explain-button",
    "compile-codex-explain-button",
    "Codex 解释",
    "让 Codex 解释这次编译失败，不修改文件",
    "让 Codex 解释当前这条诊断，不修改文件",
    "修当前",
    "diagnostic-active",
    "上一条",
    "下一条",
    "定位",
  ]) &&
    hasCssBlock(".compile-heading-actions", ["display: flex !important;", "margin-left: auto;"]) &&
    hasCssBlock(".compile-codex-explain-button", ["background: #eef6f8;", "color: #285c68;"]) &&
    hasCssBlock(".compile-diagnostic-nav .compile-diagnostic-fix-button", [
      "background: #eef6f8;",
      "margin-left: auto;",
    ]) &&
    hasCssBlock(".compile-diagnostic-nav .compile-diagnostic-explain-button", [
      "background: #f7fbfc;",
      "color: #315e68;",
    ]) &&
    hasCssBlock(".compile-active-explain-button", ["background: #f7fbfc;", "color: #315e68;"]),
);

addCheck(
  "compile error panel lives outside the main App component",
  includesAll(app, [
    'import { CompileErrorPanel } from "./components/CompileErrorPanel"',
    "<CompileErrorPanel",
  ]) &&
    includesAll(compileErrorPanel, [
      "export function CompileErrorPanel",
      "CompileErrorPanelProps",
      "activeDiagnosticIndex",
      "jumpToDiagnostic",
      "compile-error-panel",
      "自动 AI 纠错",
    ]) &&
    includesAll(diagnostics, [
      "export function formatDiagnosticLocation",
      "export function formatDiagnosticText",
      "export function diagnosticInstallCommand",
      "export function diagnosticSeverityLabel",
      "export function tailLog",
    ]) &&
    !app.includes("function CompileErrorPanel"),
);

addCheck(
  "compile diagnostics are synchronized into Monaco editor markers",
  includesAll(app, [
    "monacoApi.editor.getModels()",
    "projectPathFromMonacoModel(model, project?.root)",
    "diagnosticToMonacoMarker(monacoApi, model, diagnostic)",
    'monacoApi.editor.setModelMarkers(model, "latex-studio", markers)',
    'monacoApi.editor.setModelMarkers(model, "latex-studio", [])',
    'source: "latexmk"',
    "monacoApi.MarkerSeverity.Error",
    "monacoApi.MarkerSeverity.Warning",
  ]),
);

addCheck(
  "Codex compile fixes include source snippets around diagnostics",
  includesAll(app, [
    "MAX_CODEX_DIAGNOSTIC_SOURCE_SNIPPETS",
    "DIAGNOSTIC_SOURCE_CONTEXT_RADIUS",
    "buildDiagnosticSourceContext(project, result.diagnostics)",
    "buildDiagnosticSourceContext(project, [diagnostic, ...result.diagnostics])",
    "Source context near diagnostics:",
    "diagnosticSourceSnippet(relative, content, diagnostic.line)",
    "readFile(project.root, relative)",
    "No source snippets were available. Inspect the referenced project files before editing.",
    "No source snippets were available. Inspect the referenced project files before explaining.",
  ]),
);

addCheck(
  "unresolved LaTeX refs and citations are shown as editor warning markers",
  includesAll(app, [
    "unresolvedLatexReferenceMarkers(monacoApi, model, projectSymbols)",
    "latexReferencesInLine(line, lineNumber)",
    "latexReferenceKeySets(symbols)",
    "stripLatexLineComment(line)",
    "isLatexReferenceSourcePath(modelPath)",
    "未找到 citation",
    "未找到 label",
    'source: "引用与标签"',
    "monacoApi.MarkerSeverity.Warning",
  ]),
);

addCheck(
  "manual compile failure opens the first navigable diagnostic in the editor",
  includesAll(app, [
    "revealFirstCompileDiagnostic(result)",
    "firstNavigableDiagnostic(result, project.root)",
    "revealDiagnosticLocation(diagnostic, { forceSplit: true })",
    "orderedDiagnostics(result.diagnostics)",
    "编译失败，已定位到 ${firstDiagnosticLocation(result, project.root)}。",
    "handleViewModeChange(\"split\")",
    "openTextFile(relative, { line: diagnostic.line ?? undefined, column: diagnostic.column ?? undefined })",
  ]),
);

addCheck(
  "compile error panel highlights the active diagnostic with copyable remediation hints",
  includesAll(appAndCompileErrorPanel, [
    "handleCopyDiagnostic",
    "handleCopyCompileLog",
    "onCopyDiagnostic",
    "onCopyCompileLog",
    "compile-active-diagnostic",
    "compile-active-diagnostic-top",
    "compile-active-actions",
    "compile-active-hint",
    "建议处理方式",
    "复制当前诊断和修复建议",
    "自动 AI 纠错",
    "Codex 修当前",
    "navigator.clipboard.writeText",
    "已复制当前编译诊断",
    "已复制原始编译日志",
    "复制原始编译日志",
    "复制日志",
    "tailLog(result.log)",
  ]) &&
    hasCssBlock(".compile-active-diagnostic", [
      "background: #ffffff;",
      "border: 1px solid #e5b8b8;",
      "margin-bottom: 12px;",
    ]) &&
    hasCssBlock(".compile-active-actions", [
      "flex-wrap: wrap;",
      "justify-content: flex-end;",
    ]) &&
    hasCssBlock(".compile-active-hint", [
      "background: #fff8e8;",
      "border: 1px solid #ecd49f;",
    ]) &&
    hasCssBlock(".compile-active-hint span", [
      "overflow-wrap: anywhere;",
    ]) &&
    hasCssBlock(".compile-ai-fix-primary", [
      "background: #1f7a4d;",
      "border-color: #1f7a4d;",
    ]) &&
    hasCssBlock(".compile-log-details summary", [
      "display: flex;",
      "justify-content: space-between;",
    ]) &&
    hasCssBlock(".compile-log-details summary button", [
      "height: 26px;",
      "padding: 0 8px;",
    ]),
);

addCheck(
  "existing compiled PDFs are reused and refreshed when project settings change",
  includesAll(app, [
    "existingPdfCompileResult",
    "applyExistingPdfPreview",
    "refreshExistingPdfPreview",
    "getExistingPdfOutput(nextProject.root)",
    "applyExistingPdfPreview(existingPdfPath, true)",
    "settings.buildDir !== previousBuildDir",
    "已刷新已有 PDF 预览",
    "当前主文件还没有可预览的已有 PDF",
  ]) &&
    includesAll(backend, ["get_existing_pdf_output", "expected_pdf_path", "detects_existing_project_pdf_output"]),
);

addCheck(
  "manual successful compile opens a refreshed PDF preview without auto-compile stealing focus",
  includesAll(app, [
    "if (result.success) {",
    'if (source === "manual") {',
    'if (viewMode === "editor") {',
    'handleViewModeChange("split");',
    "setIsPreviewCollapsed(false);",
    'source === "auto" ? "自动编译完成。" : "编译完成，PDF 已刷新。"',
  ]) &&
    !app.includes('source === "auto" && viewMode === "editor"'),
);

addCheck(
  "PDF output can be opened, revealed in Finder, and exported from the preview header",
  includesAll(app, [
    "openPdfFile",
    "revealPdfFile",
    "exportPdfFile",
    "handleOpenPdfOutput",
    "handleRevealPdfOutput",
    "handleExportPdfOutput",
    "handleExportPdf",
    "openPdfFile(project.root, pdfPath)",
    "revealPdfFile(project.root, pdfPath)",
    "exportPdfFile(project.root, pdfPath)",
    'role="toolbar"',
    'aria-label="PDF 预览操作"',
    'aria-label="打开 PDF"',
    'aria-label="在 Finder 中显示 PDF"',
    'aria-label="导出 PDF"',
    '<span>PDF</span>',
    "已用系统 PDF 阅读器打开当前输出。",
    "已在 Finder 中定位当前 PDF。",
    "已导出 PDF：",
  ]) &&
    includesAll(backend, [
      "open_pdf_file",
      "reveal_pdf_file",
      "export_pdf_file",
      "resolve_project_pdf_existing",
      "copies_pdf_export_to_target",
      "reads_only_project_pdf_files",
    ]),
);

addCheck(
  "project source can be exported as a clean ZIP from the project popover",
  includesAll(app, [
    "handleExportProjectZip",
    "exportProjectZip(project.root)",
    "setShowProjectPanel(false)",
    'aria-label="导出整个项目为 ZIP"',
    "导出 ZIP",
    "正在导出项目源码",
    "项目源码已导出：",
  ]) &&
    includesAll(tauri, [
      'import { open, save } from "@tauri-apps/plugin-dialog"',
      "exportProjectZip",
      "save({",
      'invoke<string>("export_project_zip"',
      "targetPath",
    ]) &&
    includesAll(backend, [
      "export_project_zip",
      "export_project_zip_to_path",
      "write_project_zip_archive",
      "exports_and_imports_project_zip_without_external_commands",
    ]) &&
    hasCssBlock(".project-utility-row", ["border-top: 1px solid #e8eef4;", "grid-template-columns: auto;"]),
);

addCheck(
  "project and settings popovers close from outside clicks and Escape",
  includesAll(app, [
    "projectSummaryButtonRef",
    "settingsButtonRef",
    "projectPopoverRef",
    "settingsPopoverRef",
    "handlePopoverPointerDown",
    "window.addEventListener(\"pointerdown\", handlePopoverPointerDown, true)",
    "window.addEventListener(\"keydown\", handlePopoverKeyDown, true)",
    "setShowProjectPanel(false)",
    "setShowSettingsPanel(false)",
    "event.key !== \"Escape\"",
    "ref={projectSummaryButtonRef}",
    "ref={settingsButtonRef}",
    "ref={projectPopoverRef}",
    "ref={settingsPopoverRef}",
  ]),
);

addCheck(
  "unsaved project switches and app close use an app-native confirmation dialog",
  includesAll(appAndSafetyConfirmDialog, [
    'import { SafetyConfirmDialog',
    "type PendingSafetyConfirm",
    "<SafetyConfirmDialog",
    "requestDiscardUnsavedTabs",
    "setPendingSafetyConfirm",
    "handleConfirmSafetyDialog",
    "handleCancelSafetyDialog",
    "onDiscardAndConfirm",
    "onSaveAndConfirm",
    'saveOpenTabsWithHistory("手动保存")',
    'kind: "discard-unsaved"',
    'kind: "close-app"',
    "onCloseRequested",
    "getCurrentWindow().destroy()",
    "handleCreateProject",
    "handleOpenProject",
    "handleChooseProjectFolder",
    "handleImportProjectZip",
    "handleOpenRecentProject",
    "export function SafetyConfirmDialog",
    "SafetyConfirmDialogRequest",
    "safety-confirm-overlay",
    "丢弃并${request.action}",
    "保存并${request.action}",
    "保存并关闭",
  ]) &&
    !app.includes("window.confirm(") &&
    hasCssBlock(".safety-confirm-overlay", ["position: fixed;", "z-index: 42;"]) &&
    hasCssBlock(".safety-confirm-dialog", ["background: #ffffff;", "border: 1px solid #d7b26a;"]) &&
    hasCssBlock(".safety-confirm-discard", ["background: #fff5f3;", "color: #8f3428;"]) &&
    hasCssBlock(".safety-confirm-primary", ["background: #fef0d4;", "color: #68460b;"]),
);

addCheck(
  "project settings can rename the displayed project name without moving the folder",
  includesAll(app, [
    "displayName",
    "项目名",
    "projectNameDraft",
    "handleSaveProjectDisplayName",
    "project-name-row",
    "保存名称",
    "value={draftSettings.displayName ?? project?.name ?? \"\"}",
    "setDraftSettings((current) =>",
    "displayName: event.target.value",
  ]) &&
    includesAll(backend, [
      "display_name: Option<String>",
      "settings.display_name",
      "unwrap_or(fallback_name)",
      "项目名不能超过 120 个字符。",
      "Paper Project",
      "assert_eq!(summary.name, \"Paper Project\")",
    ]),
);

addCheck(
  "Codex command workspace lives in the sidebar without a duplicate focused input",
  includesAll(app, [
    "codex-command-center-sidebar",
    "codex-sidebar-title",
    "codexContextTitleHint &&",
    '"codex-context-line"',
    "让 Codex 修改...",
  ]) &&
    !app.includes("data-legacy-codex-input") &&
    !app.includes("codex-input-row") &&
    !app.includes("codex-action-row") &&
    countOccurrences(app, "ref={codexPromptInputRef}") === 1 &&
    hasCssBlock(".file-tree", ["flex: 0 1 50%;", "min-height: 120px;"]) &&
    hasCssBlock(".codex-command-center-sidebar", [
      "border-top: 1px solid #d8dee6;",
      "flex: 1 1 50%;",
      'grid-template-areas:',
      '"title"',
      '"bar"',
      '"output";',
      "grid-template-rows: auto auto minmax(0, 1fr);",
      "min-height: 260px;",
    ]) &&
    hasCssBlock(".codex-command-center-sidebar .codex-command-bar", [
      "grid-area: bar;",
      "grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto;",
      "max-width: none;",
    ]) &&
    hasCssBlock(".codex-sidebar-title .codex-context-line", [
      "flex: 1 1 auto;",
      "border: 1px solid #d7e8ee;",
      "color: #285d6d;",
    ]) &&
    hasCssBlock(".codex-command-center-sidebar .codex-command-bar textarea", [
      "height: 64px;",
      "min-height: 48px;",
    ]) &&
    styles.includes("display: none !important;"),
);

addCheck(
  "project settings support safe extra latexmk arguments",
  includesAll(app, [
    "draftSettings.compileArgs.join(\" \")",
    "parseLatexmkArgs(event.target.value)",
    "附加 latexmk 参数",
    "主文件、构建目录和 shell escape 由 LaTeX Studio 管理",
    "Extra latexmk args:",
  ]) &&
    includesAll(backend, [
      "compile_args: Vec<String>",
      "#[serde(default)]",
      "validate_latexmk_extra_args(&settings.compile_args)",
      "args.extend(settings.compile_args.iter().cloned())",
      "-shell-escape",
      "-enable-write18",
      "附加编译参数",
    ]),
);

addCheck(
  "settings expose local LaTeX and Codex environment health",
  includesAll(appAndToolPill, [
    'import { ToolPill } from "./components/ToolPill"',
    "isEnvironmentChecking",
    "environmentTools",
    "missingEnvironmentTools",
    "handleRefreshEnvironment",
    "checkEnvironment()",
    "setEnvironment(nextEnvironment)",
    "本地环境",
    "重新检测",
    "安装提示",
    "<ToolPill tool={tool} key={tool.name} />",
    "LaTeX 编译和 Codex 均可用。",
    "缺少工具时，编辑仍可继续",
    "本地 LaTeX 编译和 Codex 环境均可用。",
    "export function ToolPill",
    "tool.found ? \"tool-found\" : \"tool-missing\"",
  ]) &&
    hasCssBlock(".settings-environment", ["border-top: 1px solid #e4e9ef;", "display: grid;"]) &&
    hasCssBlock(".settings-tool-grid", ["grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));"]) &&
    hasCssBlock(".tool-pill", ["grid-template-columns: auto minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".tool-found", ["background: #eef8f2;", "color: #217044;"]) &&
    hasCssBlock(".tool-missing", ["background: #fff5f3;", "color: #8f3428;"]) &&
    hasCssBlock(".settings-environment-hints", ["background: #fff8eb;", "border: 1px solid #ead2a0;"]),
);

addCheck(
  "missing LaTeX or Codex tools guide users to settings instead of dead disabled controls",
  includesAll(app, [
    "openEnvironmentSettings(message: string)",
    "缺少 LaTeX 编译环境。请在设置中查看本地环境并重新检测。",
    "缺少 Codex CLI。请在设置中查看本地环境并重新检测。",
    "topbar-compile-button-setup",
    "配置 LaTeX 编译环境",
    "Codex CLI 不可用，可先写下请求并在设置中重新检测",
    "codex-command-config",
    "配置 Codex CLI",
    "disabled={!project || isCompiling}",
    "disabled={!project}",
    "openEnvironmentSettings(\"缺少 Codex CLI",
  ]) &&
    !app.includes("disabled={!project || isCompiling || !environment?.canCompile}") &&
    hasCssBlock(".topbar-compile-button-setup", ["background: #fff8eb;", "color: #68460b;"]) &&
    hasCssBlock(".codex-command-config", ["background: #fff8eb;", "color: #765415;"]),
);

addCheck(
  "app startup restores the most recent LaTeX project when available",
  includesAll(app, [
    "autoRestoreAttemptedRef",
    "restoreRecentProject",
    "const latest = projects[0]",
    "openProject(latest.root)",
    "已恢复上次打开的项目",
    "无法自动恢复最近项目",
  ]) &&
    includesAll(backend, ["list_recent_projects", "last_opened", "remember_recent_project"]),
);

addCheck(
  "app restores per-project editor tabs and the active file across launches",
  includesAll(app, [
    "ProjectEditorSession",
    "PROJECT_EDITOR_SESSION_PREF_PREFIX",
    "MAX_RESTORED_EDITOR_TABS",
    "MAX_RECENT_EDITOR_FILES",
    "recentFilePaths",
    "recentPaths",
    "rememberRecentFile(path)",
    "restoreEditorSessionTabs(nextProject.root, nextProject.mainFile)",
    "restoreEditorSessionTabs(projectRoot: string, mainFile: string)",
    "loadProjectEditorSession(projectRoot)",
    "saveProjectEditorSession(project.root",
    "uniqueTextPaths",
    "projectEditorSessionKey(projectRoot)",
    "setTabs(editorSession.tabs)",
    "setActivePath(editorSession.activeTab.path)",
    "setRecentFilePaths(",
    "setContent(editorSession.activeTab.content)",
    "JSON.stringify({ activePath, openPaths, recentPaths })",
  ]),
);

addCheck(
  "Codex editing remains cancellable, revertible, and diff-based",
  includesAll(appAndCodexProgress, [
    "handleCancelCodex",
    "handleRevertCodex",
    "CodexRunMode",
    "codexRunMode",
    "setCodexRunMode(\"edit\")",
    "setCodexRunMode(\"ask\")",
    "mode === \"ask\"",
    "正在分析",
    "正在修改",
    "codex-sidebar-actions",
    "codex-stop-button",
    "codex-progress-stop",
    "codex-running-sr-status",
    "!isCodexRunning && diffSummary?.canRevert",
    "Codex 正在运行；请先终止或等待完成后再撤回。",
    "终止本次 Codex 分析",
    "终止本次 Codex 修改",
    "终止中",
    "<CodexDiffView",
    "runCodexEdit({",
    "cancelCodexRun(project.root)",
  ]) &&
    !app.includes('aria-label="取消 Codex"') &&
    !backend.includes("点击取消") &&
    !app.includes("codex-command-running") &&
    !app.includes("codex-command-stop") &&
    backend.includes("使用运行卡片里的终止按钮") &&
    includesAll(backend, ["CODEX_RUN_TIMEOUT_SECS", "cancel_codex_run", "snapshot", "unified_diff"]) &&
    hasCssBlock(".codex-stop-button", ["background: #fff5f5;", "color: #b42318;", "height: 28px;"]) &&
    hasCssBlock(".codex-running-sr-status", ["clip-path: inset(50%);", "position: absolute;"]),
);

addCheck(
  "Codex failed runs can retry the previous natural-language request with fresh context",
  includesAll(appAndCodexProgress, [
    "handleRetryCodexRun",
    "const prompt = codexConversationPrompt.trim();",
    "setCodexPrompt(prompt);",
    "codexRunMode === \"ask\"",
    "runCodexAskPrompt(await prepareCodexPrompt(prompt), prompt)",
    "runCodexPrompt(await prepareCodexPrompt(prompt), prompt)",
    "onRetry={() => void runSafely(handleRetryCodexRun)}",
    "const canRetry = Boolean(!isRunning && errors.length > 0 && prompt?.trim() && onRetry);",
    "className=\"codex-retry-button\"",
    "重新运行这次 Codex 修改",
    "重新运行这次 Codex 分析",
    "重试 Codex",
  ]) &&
    hasCssBlock(".codex-retry-button", ["background: #eef9f1;", "color: #1f6f44;", "height: 28px;"]),
);

addCheck(
  "Codex no-change runs do not show empty diffs or trigger auto-compile",
  includesAll(appAndCodexDiff, [
    "const hasScopeRevertedFiles = Boolean(summary.scopeRevertedFiles?.length);",
    "setDiffSummary(summary.changedFiles.length || hasScopeRevertedFiles ? summary : null)",
    "if (!scopeRevertedFiles.length)",
    "Codex 已完成，没有文件变化。",
  ]) &&
    !app.includes('createAutomaticHistorySnapshot("Codex 修改前")') &&
    includesAll(backend, [
      "Codex 已完成，没有修改文件。",
      "if summary.changed_files.is_empty()",
      "return Ok(summary);",
      "codex_no_change_flow_does_not_create_diff_or_autocompile",
      "assert!(!diff_summary_path(&root, &summary.run_id).exists())",
      "assert!(!root.join(\"latexmk-was-run.txt\").exists())",
      "assert!(list_codex_history_items(&root).unwrap().is_empty())",
    ]),
);

const codexEditStart = app.indexOf("const rawSummary = await runCodexEdit({");
const codexEditReload = app.indexOf("await reloadOpenTabsFromDisk();", codexEditStart);
const codexEditCompile = app.indexOf('await compileActiveProject("auto");', codexEditStart);

addCheck(
  "Codex changed runs invalidate stale errors, reload files, then recompile from the frontend",
  includesAll(app, [
    "function clearStaleCompileFailure()",
    "setCompileResult((current) => (current && !current.success ? null : current));",
    "autoCompile: false",
    "const summary = rawSummary;",
    "markSourceEdited();",
    "Codex 修改已应用并重新编译完成。",
    "Codex 修改已应用，但重新编译仍有错误。",
  ]) &&
    codexEditStart >= 0 &&
    codexEditReload > codexEditStart &&
    codexEditCompile > codexEditReload,
);

addCheck(
  "compile flushes current project Monaco models to disk and verifies them before latexmk",
  includesAll(app, [
    "async function saveAllOpenTabs(options: { forceActive?: boolean; verifyActive?: boolean } = {})",
    "const shouldFlushActiveEditor = Boolean(!activeAsset && activePath && isTextPath(activePath));",
    "collectCurrentProjectModelContents(project.root, editorRef.current, monacoRef.current)",
    "for (const [modelPath, modelContent] of modelContents)",
    "const verifyPaths = new Set<string>(activePath ? [activePath] : []);",
    "options.forceActive",
    "options.verifyActive",
    "保存后读回内容不一致，已停止编译以避免使用旧源码。",
    "saveOpenTabsWithHistory(source === \"auto\" ? \"自动编译前保存\" : \"编译前保存\",",
    "forceActive: true",
    "verifyActive: true",
  ]),
);

addCheck(
  "compile recovery retry status is surfaced without opening normal logs",
  includesAll(app, [
    'payload.kind === "log" && payload.message',
    "setStatus(payload.message)",
  ]) &&
    includesAll(backend, [
      "should_retry_latexmk_after_clean",
      "检测到上次失败留下的构建缓存，正在清理并重试编译。",
      "compile_flow_cleans_stale_latexmk_failure_and_retries",
    ]),
);

addCheck(
  "compile after a failed run cleans stale latexmk aux state before retrying",
  includesAll(app, [
    "const lastCompileFailedRef = useRef(false);",
    "lastCompileFailedRef.current || (compileResult && !compileResult.success)",
    "if (shouldCleanStaleFailure) {",
    "上次编译失败，正在清理构建缓存后重试...",
    "await cleanProjectBuild(project.root);",
    "lastCompileFailedRef.current = !result.success;",
    "lastCompileFailedRef.current = true;",
  ]) &&
    includesAll(backend, [
      "should_retry_latexmk_after_clean",
      "gave an error in previous invocation of latexmk",
      "clean_resolved_build_dir(&build_dir)?;",
    ]),
);

addCheck(
  "active Monaco model is synchronized after disk or Codex reloads before compile",
  includesAll(app, [
    "const activeEditorModelPath = useMemo(() => {",
    "return `${project.root.replace(/\\/+$/, \"\")}/${activePath}`;",
    "path={activeEditorModelPath}",
    "function collectCurrentProjectModelContents(",
    'uriPath.startsWith(`${normalizedProjectRoot}/`) || model === activeModel',
    "const model = editor?.getModel();",
    "if (!model || model.getValue() === content) return;",
    "model.setValue(content);",
    "[activeAsset, activePath, content, isEditorReady]",
    "saveOpenTabsWithHistory(source === \"auto\" ? \"自动编译前保存\" : \"编译前保存\",",
    "forceActive: true",
    "verifyActive: true",
  ]),
);

addCheck(
  "macOS bundle explicitly disables legacy Carbon launch metadata",
  includesAll(tauriConfig, ['"macOS"', '"infoPlist": "Info.plist"']) &&
    includesAll(macInfoPlist, ["<key>LSRequiresCarbon</key>", "<false/>", "<key>NSPrincipalClass</key>"]),
);

addCheck(
  "successful compiles clear stale diagnostics before reaching Codex context or editor markers",
  includesAll(app, [
    "const nextResult = result.success ? { ...result, diagnostics: [] } : result;",
    "setCompileResult(nextResult)",
    "compileResult && !compileResult.success",
    "compileResult.diagnostics.slice(0, MAX_CODEX_DIAGNOSTICS)",
    "if (!result || result.success || !path) return [];",
  ]) &&
    includesAll(backend, ["if success {", "diagnostics.clear();"]),
);

const compileEventStart = app.indexOf('listen<CompileEvent>("compile:event"');
const compileEventEnd = app.indexOf('listen<CodexRunEvent>("codex:event"', compileEventStart);
const compileEventBlock =
  compileEventStart >= 0 && compileEventEnd > compileEventStart
    ? app.slice(compileEventStart, compileEventEnd)
    : "";

addCheck(
  "compile results are accepted only from the current frontend compile request",
  includesAll(app, [
    "const compileRequestSerialRef = useRef(0);",
    "compileRequestSerialRef.current += 1;",
    "const compileSerial = compileRequestSerialRef.current + 1;",
    "compileRequestSerialRef.current = compileSerial;",
    "if (compileSerial !== compileRequestSerialRef.current) {",
    "if (compileSerial === compileRequestSerialRef.current) {",
  ]) && !compileEventBlock.includes("applyCompileResult(payload.result)"),
);

addCheck(
  "missing-package diagnostics expose a copyable tlmgr install command",
  includesAll(appAndCompileErrorPanel, [
    "handleCopyDiagnosticCommand",
    "diagnosticInstallCommand",
    "sudo\\s+tlmgr\\s+install",
    "compile-active-command-button",
    "复制安装命令",
    "已复制缺包安装命令。",
  ]) &&
    includesAll(backend, [
      "missing_latex_file_hint",
      "sudo tlmgr install xecjk ctex fontspec fandol",
      "sudo tlmgr install {stem}",
    ]) &&
    hasCssBlock(".compile-active-command-button", [
      "background: #fff8e8;",
      "color: #735317;",
    ]),
);

addCheck(
  "Codex changed lines are highlighted and navigable inside the LaTeX editor",
  includesAll(appAndCodexDiff, [
    "codexDecorationCollectionRef",
    "createDecorationsCollection()",
    "codexEditorDecorationsForPath",
    "codexChangedLineNumbersForPath",
    "codexChangedLineEntries",
    "acceptedCodexHunkKeys",
    "codexChangedLineNumbersForPath(diffSummary, activePath, acceptedCodexHunkKeys)",
    "codexEditorDecorationsForPath(monacoApi, diffSummary, activePath, model.getLineCount(), acceptedCodexHunkKeys)",
    "parsedDiffHunks(fileDiff).flatMap",
    "acceptedHunkKeys.has(codexDiffHunkKey(fileDiff.file, hunk))",
    "activeCodexChangeLines",
    "handleJumpToCodexChange",
    "diffTargetLine(line)",
    "formatDiffLineNumber(line.oldLine)",
    "formatDiffLineNumber(line.newLine)",
    "codex-diff-old-line",
    "codex-diff-new-line",
    "handleHideCodexHighlights",
    "hiddenCodexHighlightRunId",
    "editor-status-codex-changes",
    "上一处 Codex 修改",
    "下一处 Codex 修改",
    "隐藏 Codex 修改高亮",
    "codex-editor-line-added",
    "codex-editor-line-removed",
    "codex-editor-line-added-gutter",
    "codex-editor-line-removed-gutter",
    "nearestDiffLine",
    "Codex 新增的内容",
    "Codex 删除内容对应的位置",
  ]) &&
    includesAll(editorLogic, ["parseHunkStart(rawLine, \"-\")", "parseNewHunkStart(rawLine)"]) &&
    hasCssBlock(".codex-editor-line-added", ["background: rgba(46, 160, 67, 0.18);"]) &&
    hasCssBlock(".codex-editor-line-removed", ["background: rgba(205, 56, 56, 0.2);"]) &&
    hasCssBlock(".codex-editor-line-added-gutter", ["border-left: 4px solid #22863a;"]) &&
    hasCssBlock(".codex-editor-line-removed-gutter", ["border-left: 4px solid #c43b3b;"]) &&
    hasCssBlock(".codex-diff-line", ["grid-template-columns: 42px 42px 18px minmax(0, 1fr);"]) &&
    hasCssBlock(".codex-diff-number", ["text-align: right;", "user-select: none;"]) &&
    hasCssBlock(".editor-status-codex-changes", [
      "display: inline-flex;",
      "background: #27312a;",
      "border: 1px solid #3d5b43;",
    ]) &&
    hasCssBlock(".editor-status-codex-changes button", ["height: 18px;", "width: 18px;"]),
);

addCheck(
  "Codex history keeps prompt previews and final messages for traceable natural-language edits",
  includesAll(appAndCodexHistory, [
    "item.promptPreview",
    "item.finalMessage",
    "handleReuseCodexHistoryPrompt",
    "setCodexPrompt(prompt)",
    "codexPromptInputRef.current?.setSelectionRange(prompt.length, prompt.length)",
    'className="codex-history-main"',
    'className="codex-history-prompt"',
    'className="codex-history-message"',
    'className="codex-history-files"',
    'className="codex-history-reuse"',
    "复用这条 Codex 指令",
    "已载入历史 Codex 指令，可调整后再次执行。",
    "未记录指令",
    "指令：{summary.promptPreview}",
    "Codex 说明：{summary.finalMessage}",
    "codex-diff-prompt",
    "codex-diff-message",
  ]) &&
    includesAll(backend, [
      "prompt_preview: Option<String>",
      "final_message: Option<String>",
      "summary.prompt_preview = codex_prompt_preview(&request.prompt)",
      "summary.final_message = final_message.clone()",
      "codex_prompt_preview(prompt: &str)",
      "Project context from LaTeX Studio",
      "codex_prompt_preview_omits_studio_context_and_truncates",
    ]) &&
    hasCssBlock(".codex-history-item", ["grid-template-columns: minmax(0, 1fr) auto;", "border: 1px solid #d8dee6;"]) &&
    hasCssBlock(".codex-history-main", ["grid-template-columns: auto minmax(0, 1fr);", "background: transparent;"]) &&
    hasCssBlock(".codex-history-prompt", ["color: #26313d;", "font-weight: 640;"]) &&
    hasCssBlock(".codex-history-message,\n.codex-diff-message", ["-webkit-line-clamp: 3;", "overflow: hidden;"]) &&
    hasCssBlock(".codex-history-reuse", ["height: 28px;", "padding: 0 7px;"]) &&
    hasCssBlock(".codex-diff-prompt", ["color: #2d3a45 !important;", "font-weight: 640;"]) &&
    hasCssBlock(".codex-diff-message", ["background: #f5faf7;", "border-left: 3px solid #9bc7b1;"]),
);

addCheck(
  "Codex history list lives outside the main App component",
  includesAll(app, [
    'import { CodexHistoryList } from "./components/CodexHistoryList"',
    "<CodexHistoryList",
  ]) &&
    includesAll(codexHistoryList, [
      "export function CodexHistoryList",
      "CodexHistoryItem",
      "formatCodexHistoryTime",
      "复用这条 Codex 指令",
      "未记录指令",
    ]) &&
    !app.includes('className="codex-history-main"'),
);

addCheck(
  "Codex diff review supports copying full and per-file diffs",
  includesAll(appAndCodexDiff, [
    'import { CodexDiffView } from "./components/CodexDiffView"',
    "handleCopyDiffText",
    "navigator.clipboard.writeText(content)",
    "onCopyDiff={(text, label) => void runSafely(() => handleCopyDiffText(text, label))}",
    "onCopyDiff(fullDiffText, \"本次 diff\")",
    "onCopyDiff(formatParsedDiffFile(file), `${file.file} diff`)",
    "复制本次 diff",
    "复制 diff",
    "codex-diff-copy",
    "codex-diff-file-copy",
    "codex-diff-file-actions",
  ]) &&
    editorLogic.includes("function formatParsedDiffLineForCopy") &&
    hasCssBlock(".codex-diff-summary-main", ["grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".codex-diff-copy", ["background: #eef6f8;", "color: #285c68;"]) &&
    hasCssBlock(".codex-diff-file-actions", ["display: flex;"]) &&
    hasCssBlock(".codex-diff-file-copy", ["border-radius: 0;", "height: auto;"]),
);

addCheck(
  "Codex diff review groups changes into copyable hunks",
  includesAll(codexDiffView, [
    "parsedDiffHunks(file).map",
    "CodexDiffHunkView",
    "ParsedDiffHunk",
    "formatParsedDiffHunk(file, hunk)",
    "firstNavigableHunkLine",
    "片段 {hunkIndex + 1}",
    "复制这个修改片段",
    "复制片段",
    "定位这个修改片段",
    "codex-diff-hunk-header",
    "codex-diff-hunk-stats",
    "codex-diff-hunk-add",
    "codex-diff-hunk-remove",
    "codexDiffHunkKey(file.file, hunk)",
    "onAcceptHunk(file.file, hunk, hunkIndex)",
    "onReviseHunk(file.file, hunk, hunkIndex)",
    "保留这个修改片段",
    "保留片段",
    "继续修改这个片段",
    "继续修改",
  ]) &&
    includesAll(editorLogic, [
      "export type ParsedDiffHunk",
      "export function parsedDiffHunks",
      "export function formatParsedDiffHunk",
      "export function codexDiffHunkKey",
      "export function codexDiffHunkReviewStats",
    ]) &&
    editorLogicTests.includes("logic.parsedDiffHunks(files[0])") &&
    editorLogicTests.includes("logic.codexDiffHunkKey(files[0].file, hunks[0])") &&
    editorLogicTests.includes("logic.codexDiffHunkReviewStats(diff)") &&
    hasCssBlock(".codex-diff-hunk-header", ["grid-template-columns: minmax(0, 1fr) auto auto;"]) &&
    hasCssBlock(".codex-diff-hunk-title", ["display: grid;", "text-align: left;"]) &&
    hasCssBlock(".codex-diff-hunk-stats", ["display: inline-flex;", "gap: 4px;"]) &&
    hasCssBlock(".codex-diff-hunk-action", ["font-size: 11px;", "height: auto;"]) &&
    hasCssBlock(".codex-diff-hunk-revise", ["background: #eef6ff;", "color: #255f9f;"]) &&
    hasCssBlock(".codex-diff-hunk-accept", ["background: #eef9f1;", "color: #1f6f44;"]),
);

addCheck(
  "Codex diff review can jump directly to the first changed source line",
  includesAll(codexDiffView, [
    "function firstNavigableDiffHunkTarget",
    "const firstTarget = firstNavigableDiffHunkTarget(diffFiles)",
    "firstNavigableHunkLine(hunk)",
    "onOpenTarget(firstTarget.file, firstTarget.line)",
    "className=\"codex-diff-copy codex-diff-open-first\"",
    "在编辑器中打开第一处 Codex 修改",
    "定位首处",
  ]) && hasCssBlock(".codex-diff-summary-main .codex-diff-summary-actions", ["display: flex;", "justify-content: flex-end;"]),
);

addCheck(
  "Codex changes can be accepted and the diff workspace returns to its initial state",
  includesAll(appCodexDiffAndContext, [
    "handleAcceptCodexChanges",
    "setDiffSummary(null)",
    "setCodexEvents([])",
    "setCodexAnswer(\"\")",
    "setCodexPrompt(\"\")",
    "setAcceptedCodexHunkKeys([])",
    "codexDecorationCollectionRef.current?.clear()",
    "acceptedHunkKeys={acceptedCodexHunkKeys}",
    "handleAcceptCodexHunk",
    "handleReviseCodexHunk",
    "codexEditorContextFromHunk(file, hunk)",
    "function codexEditorContextFromHunk",
    "setPinnedCodexContext(context)",
    "formatParsedDiffHunk({ file, lines: hunk.lines }, hunk)",
    "请基于已锁定的 Codex 修改片段继续修改 @${file}。",
    "你想让 Codex 怎么处理：",
    "source: \"diff-hunk\"",
    "Codex 片段",
    "setIsCodexContextOnlyEnabled(true)",
    "已锁定 ${file} 的片段 ${hunkIndex + 1}，在输入框末尾写清要求后执行。",
    "onReviseHunk={handleReviseCodexHunk}",
    "handleShowAcceptedCodexHunks",
    "onClearAcceptedHunks={handleShowAcceptedCodexHunks}",
    "codexDiffHunkReviewStats(diffSummary.unifiedDiff, acceptedCodexHunkKeys)",
    "const codexReviewBadgeCount",
    "<small title={codexReviewBadgeTitle}>{codexReviewBadgeCount}</small>",
    "codexReviewStats.pendingHunks > 0",
    "`${codexReviewStats.pendingHunks} 个片段待审`",
    "所有片段已保留",
    "已保留 {acceptedHunkCount} 个片段",
    "显示全部",
    "所有片段都已保留",
    "codex-diff-reviewed-note",
    "codex-diff-all-reviewed",
    "确认修改",
    "确认后隐藏 diff 和编辑器高亮",
    "codex-accept-row",
  ]) &&
    hasCssBlock(".codex-accept-row", ["background: #eef9f1;", "grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".codex-accept-row button", ["background: #237247;", "color: #ffffff;"]) &&
    hasCssBlock(".codex-accept-row button span", ["color: #ffffff;", "font-weight: 720;"]) &&
    hasCssBlock(".codex-diff-reviewed-note", ["color: #2e6a45 !important;", "font-weight: 680;"]) &&
    hasCssBlock(".codex-diff-all-reviewed", ["background: #f4fbf6;", "text-align: center;"]),
);

addCheck(
  "Codex prompt can explicitly include the current diff as context",
  includesAll(app, [
    "isCodexDiffContextEnabled",
    "canUseCodexDiffContext",
    "MAX_CODEX_DIFF_CONTEXT",
    "buildCodexDiffContext(diffSummary)",
    "Current diff context from LaTeX Studio",
    "The user explicitly enabled including the current Codex/history diff as context",
    "带上当前 diff",
    "codexDiffContextHint",
    "codex-context-toggle",
    "setIsCodexDiffContextEnabled(event.target.checked)",
    "Diff was truncated to ${MAX_CODEX_DIFF_CONTEXT} characters",
  ]) &&
    hasCssBlock(".codex-context-toggle", ["justify-self: start;", "height: 28px;"]) &&
    hasCssBlock(".codex-context-toggle-on", ["background: #e8f3ec;", "color: #21613a;"]),
);

addCheck(
  "Codex revert supports whole-run and single-file recovery snapshots",
  includesAll(appAndCodexDiff, [
    "isCodexRevertConfirmVisible",
    "setIsCodexRevertConfirmVisible(true)",
    "handleConfirmRevertCodex",
    "handleRevertCodexFile",
    "handleRevertCodexHunk",
    "revertParsedDiffHunkInContent(currentContent, hunk)",
    "getCodexDiff(project.root, runId)",
    'createProjectHistorySnapshot(project.root, "撤回 Codex 修改前")',
    "createProjectHistorySnapshot(project.root, `撤回 Codex 对 ${file} 的修改前`)",
    "createProjectHistorySnapshot(project.root, `撤回 Codex 对 ${file} 的片段 ${hunkIndex + 1} 前`)",
    "revertCodexRun(project.root, runId)",
    "revertCodexFile(project.root, runId, file)",
    "setDiffSummary(nextSummary.changedFiles.length ? nextSummary : null)",
    "codex-revert-confirm",
    "codex-revert-warning",
    "codex-revert-danger",
    "codex-diff-file-revert",
    "codex-diff-hunk-revert",
    "撤回此文件",
    "撤回片段",
    "仅撤回这个修改片段",
    "确认撤回",
    "dirtyTabCount",
  ]) &&
    includesAll(editorLogic, [
      "export function revertParsedDiffHunkInContent",
      "locateDiffHunkInLines",
      "无法在当前文件中定位这个 Codex 修改片段",
    ]) &&
    editorLogicTests.includes("logic.revertParsedDiffHunkInContent") &&
    includesAll(tauri, ['revert_codex_file", { projectRoot, runId, path }']) &&
    includesAll(backend, [
      "fn revert_codex_file(",
      "project_root: String",
      "run_id: String",
      "path: String",
      "fn revert_snapshot_file(root: &Path, run_id: &str, path: &str) -> Result<DiffSummary, String>",
      "failed to remove Codex diff summary",
      "revert_snapshot_file(&root, \"run-1\", \"main.tex\")",
      "assert!(!diff_summary_path(&root, \"run-1\").exists())",
    ]) &&
    !app.includes('confirmDiscardUnsavedTabs("撤回本次 Codex 修改")') &&
    hasCssBlock(".codex-revert-confirm", ["border: 1px solid #efc6bf", "box-shadow: inset 3px 0 0 #c9493d"]) &&
    hasCssBlock(".codex-revert-actions", ["justify-content: flex-end", "gap: 7px"]) &&
    hasCssBlock(".codex-revert-danger", ["background: #a83b32", "color: #ffffff"]) &&
    hasCssBlock(".codex-diff-file-header", ["grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".codex-diff-file-revert", ["background: #fff8eb;", "color: #765415;"]) &&
    hasCssBlock(".codex-diff-hunk-revert", ["background: #fff8eb;", "color: #765415;"]),
);

addCheck(
  "project file operations create automatic history snapshots before structural changes",
  includesAll(app, [
    "handleCreateEntry",
    "handleImportFiles",
    "handleRenameEntry",
    "handleDeleteEntry",
    "createAutomaticHistorySnapshot(`新建${label} ${nextPath} 前`)",
    "createAutomaticHistorySnapshot(`导入 ${sourcePaths.length} 个文件前`)",
    "createAutomaticHistorySnapshot(`重命名 ${targetPath} 前`)",
    "createAutomaticHistorySnapshot(`删除 ${targetPath} 前`)",
    "await saveAllOpenTabs()",
    "已保存操作前历史版本",
    "可从历史版本恢复",
  ]) &&
    includesAll(backend, [
      "restore_project_history_snapshot_in_root",
      "current_files.difference(&before_files)",
      "failed to remove new file",
    ]),
);

addCheck(
  "project history supports diff preview before restoring snapshots",
  includesAll(app, [
    "handleOpenHistoryPanel",
    "historyDiffSummary",
    "historyDiffItem",
    "handlePreviewHistoryDiff",
    "getProjectHistoryDiff(project.root, item.snapshotId)",
    'title="历史版本"',
    'aria-label="历史版本"',
    "history-item-actions",
    "history-diff-panel",
    "当前项目相对此历史版本的差异",
    "恢复历史版本会回到左侧旧内容",
    "查看该历史版本和当前项目的差异",
  ]) &&
    includesAll(backend, [
      "get_project_history_diff",
      "diff_project_history_snapshot",
      "diff_file_sets",
      "create_project_history_snapshot",
      "restore_project_history_snapshot",
    ]) &&
    hasCssBlock(".history-popover", ["max-height: min(760px, calc(100vh - 86px));", "overflow: auto;"]) &&
    hasCssBlock(".history-diff-panel .codex-diff-view", ["max-height: 340px;", "overflow: auto;"]),
);

addCheck(
  "project history is driven by saved versions instead of a separate snapshot form",
  includesAll(app, [
    "手动保存或自动保存有变化时会出现在这里。",
    "saveOpenTabsWithHistory(",
    "const { savedCount, recordedHistory } = await saveOpenTabsWithHistory(\"手动保存\")",
    "const recordedHistory = await recordSavedProjectHistory(label, extraPaths)",
    "isVersionedSaveHistoryLabel(label)",
    "label === \"手动保存\" || label === \"自动保存\"",
    "if (!isVersionedSaveHistoryLabel(label))",
    "if (!savedCount && !recordedHistory)",
    "saveOpenTabsWithHistory(isAutoSaveEnabled ? \"自动保存\" : \"自动编译前保存\")",
    "手动保存/自动保存后记录",
    "handlePreviewHistoryDiff(item)",
    "handleRestoreHistorySnapshot(item)",
  ]) &&
    !app.includes("historySnapshotLabel") &&
    !app.includes("historySnapshotInputRef") &&
    !app.includes("history-save-form") &&
    !app.includes("handleCreateHistorySnapshot") &&
    !styles.includes(".history-save-form"),
);

addCheck(
  "project history restore uses an inline confirmation panel with rollback snapshot",
  includesAll(app, [
    "historyRestoreItem",
    "setHistoryRestoreItem(item)",
    "handleConfirmRestoreHistorySnapshot(event?: ReactFormEvent<HTMLFormElement>)",
    "createAutomaticHistorySnapshot(`恢复“${item.label}”前`)",
    "history-restore-panel",
    "history-restore-warning",
    "history-restore-confirm",
    "history-item-restore-pending",
    "确认恢复到“{historyRestoreItem.label}”",
    "查看差异",
    "确认恢复",
  ]) &&
    !app.includes("window.confirm(`恢复到") &&
    !app.includes("confirmDiscardUnsavedTabs(\"恢复历史版本\")") &&
    hasCssBlock(".history-restore-panel", ["background: #fff8eb;", "border: 1px solid #dfbd70;"]) &&
    hasCssBlock(".history-restore-actions", ["display: flex;", "justify-content: flex-end;"]) &&
    hasCssBlock(".history-restore-confirm", ["background: #fef0d4;", "color: #6b4a0e;"]),
);

addCheck(
  "word count panel saves dirty tabs, opens counted files, and refreshes in place",
  includesAll(app, [
    "handleCountWords",
    "await saveAllOpenTabs()",
    "countProjectWords(project.root)",
    "setShowWordCountPanel(true)",
    'className="word-count-popover"',
    'className="word-count-heading-actions"',
    "重新统计项目字数",
    "openTextFile(file.file)",
    "wordCount.files.slice(0, 10).map",
    "项目字数：${result.words.toLocaleString(\"zh-CN\")} 词。",
  ]) &&
    includesAll(backend, ["count_project_words", "count_latex_words", "strips_comments_and_latex_commands_for_word_count"]) &&
    hasCssBlock(".word-count-heading-actions", ["display: flex !important;", "gap: 4px !important;"]) &&
    hasCssBlock(".word-count-heading-actions button", ["height: 30px;", "width: 30px;"]) &&
    hasCssBlock(".word-count-files button", ["grid-template-columns: minmax(0, 1fr) auto;", "height: 30px;"]),
);

addCheck(
  "Codex panel stays prompt-first without preset instruction buttons",
  includesAll(app, [
    "handleRunCodex",
    "handleAskCodex",
    "codexPromptInputRef",
    "runCodexAskPrompt",
    "让 Codex 修改...",
    "Codex 输出",
    "navigator.clipboard.writeText(codexAnswer)",
    "setCodexPrompt(\"\")",
  ]) &&
    !app.includes("CODEX_QUICK_ACTIONS") &&
    !app.includes("handleCodexQuickAction") &&
    !app.includes("codex-quick-actions") &&
    !styles.includes(".codex-quick-actions"),
);

addCheck(
  "Codex command box behaves like a compact chat input without visible context clutter",
  includesAll(app, [
    "canSubmitCodexPrompt",
    "codex-command-input-stack",
    "codex-command-key-hint",
    "codex-command-ask",
    "event.nativeEvent.isComposing",
    "!event.shiftKey",
    "event.altKey && event.key === \"Enter\"",
    "void runSafely(handleAskCodex)",
    "Enter 修改 · ⌥Enter 提问 · Shift+Enter 换行",
    "Enter 修改，⌥Enter 提问，Shift+Enter 换行",
    "只问 Codex，不修改文件",
  ]) &&
    !app.includes('className="codex-command-context"') &&
    !app.includes("topbar-ai-button") &&
    hasCssBlock(".codex-command-input-stack", ["display: grid;", "gap: 4px;"]) &&
    hasCssBlock(".codex-command-bar", [
      "grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto;",
    ]) &&
    hasCssBlock(".codex-command-ask", ["background: #f7fafc;", "color: #285d6d;"]) &&
    hasCssBlock(".codex-command-center-sidebar .codex-command-bar", [
      "grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto;",
    ]) &&
    hasCssBlock(".codex-command-context,\n.codex-command-key-hint", [
      "overflow: hidden;",
      "text-overflow: ellipsis;",
      "white-space: nowrap;",
    ]),
);

addCheck(
  "Codex run events render as a chat transcript with collapsible run details",
  includesAll(appAndCodexProgress, [
    "CodexProgressView",
    "aria-label=\"Codex 运行进度\"",
    "aria-label=\"Codex 对话记录\"",
    "codex-progress-view",
    "codex-progress-heading",
    "codex-progress-state-running",
    "codex-chat-transcript",
    "codex-chat-row-user",
    "codex-chat-row-assistant",
    "assistantMessages",
    "const assistantMessages = uniqueStrings(",
    "你的要求",
    "运行细节",
    "codex-progress-files",
    "codex-progress-error",
    "codex-progress-details",
    "codex-progress-timeline",
    "已检测到文件变化",
    "timelineEvents",
    "fileChanges",
    "uniqueStrings(",
    "concreteSummary",
    "Codex 已返回具体输出。",
    "已完成修改，涉及",
    "下方可以确认修改或查看 diff",
  ]) &&
    !appAndCodexProgress.includes("codexEvents.map((event, index)") &&
    hasCssBlock(".codex-progress-view", [
      "background: #ffffff;",
      "border: 1px solid #d8dee6;",
      "display: grid;",
    ]) &&
    hasCssBlock(".codex-progress-files", [
      "flex-wrap: wrap;",
      "background: #f7fafc;",
    ]) &&
    hasCssBlock(".codex-chat-transcript", ["display: grid;", "gap: 8px;"]) &&
    hasCssBlock(".codex-chat-bubble p", ["white-space: pre-wrap;"]) &&
    hasCssBlock(".codex-progress-details", ["border-top: 1px solid #e2e8ef;"]) &&
    hasCssBlock(".codex-progress-timeline", ["display: grid;", "gap: 6px;"]) &&
    hasCssBlock(".codex-progress-error", [
      "background: #fff4f2;",
      "border: 1px solid #efc6bf;",
    ]),
);

addCheck(
  "Codex progress transcript lives outside the main App component",
  includesAll(app, [
    'import { CodexProgressView } from "./components/CodexProgressView"',
    "<CodexProgressView",
  ]) &&
    includesAll(codexProgressView, [
      "export function CodexProgressView",
      "CodexRunEvent",
      "codex-chat-transcript",
      "codex-progress-details",
      "Codex 已返回具体输出。",
    ]) &&
    !app.includes("function CodexProgressView"),
);

addCheck(
  "Codex CLI final messages are captured through output-last-message for edit and ask runs",
  includesAll(backend, [
    "--output-last-message",
    "codex_last_message_temp_path",
    "read_codex_last_message",
    "cleanup_codex_last_message",
    "emit_codex_event(app.as_ref(), \"assistant\", Some(&run_id), &response)",
    "emit_codex_event(app.as_ref(), \"assistant\", Some(&run_id), message)",
    "missing --output-last-message",
    "via last-message",
  ]),
);

addCheck(
  "editor selection can be handed to Codex without injecting preset instructions",
  includesAll(app, [
    "codexPromptInputRef",
    "pinnedCodexContext",
    "setPinnedCodexContext(context)",
    "codexContextTitleHint",
    "codex-context-line-pinned",
    "取消锁定 Codex 上下文",
    "handleSendEditorContextToCodex",
    "readCodexEditorContext()",
    "setIsCodexCollapsed(false)",
    "codexPromptInputRef.current?.focus()",
    "把当前编辑器上下文发送到 Codex",
    "已锁定当前选区作为 Codex 上下文，请输入修改要求。",
    "已锁定当前光标位置作为 Codex 上下文，请输入修改要求。",
    "Pinned editor context from LaTeX Studio:",
    "treat it as the primary target even if the cursor later moved",
    "setPinnedCodexContext(null)",
  ]) &&
    !app.includes("setCodexPrompt(\n      hasSelection") &&
    !app.includes("请修改当前选区：") &&
    !app.includes("请根据当前光标附近内容修改：") &&
    hasCssBlock(".codex-sidebar-title .codex-context-line-pinned", [
      "background: #fff7df;",
      "color: #70510e;",
    ]) &&
    hasCssBlock(".codex-context-clear", ["height: 22px;", "width: 22px;"]),
);

addCheck(
  "Codex cursor context includes active section and nearby source when nothing is selected",
  includesAll(appAndCodexContext, [
    "MAX_CODEX_ACTIVE_SECTION_CONTEXT",
    "MAX_CODEX_NEARBY_CONTEXT",
    "CODEX_NEARBY_CONTEXT_RADIUS",
    "readEditorActiveSectionContext(model, outline, activePath, activeSection)",
    "readEditorNearbyContext(model, cursorLine)",
    "activeOutlineItemForCursor(outline, activePath, cursorLine)",
    "Active outline item:",
    "Active section source:",
    "Active section source was truncated to ${MAX_CODEX_ACTIVE_SECTION_CONTEXT} characters",
    "If the user asks to revise this section, polish here, expand this part, or similar wording",
    "Nearby source around cursor:",
    "Nearby source was truncated to ${MAX_CODEX_NEARBY_CONTEXT} characters",
    "当前光标${section}",
  ]),
);

addCheck(
  "Codex editor context includes BibTeX metadata for citations referenced nearby",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_CITATIONS",
    "MAX_CODEX_CONTEXT_CITATION_SOURCES",
    "codexContextCitations(context, effectiveSymbols)",
    "readCodexContextCitationSourceContexts(project.root, readCodexEditorContext(), latestSymbols)",
    "buildCodexContextCitationSourcesContext(contextCitationSources)",
    "BibTeX source excerpts for citations in the current editor context:",
    "do not invent bibliographic facts beyond the available entries",
    "codexCitationSource(context)",
    "citationKeysInLatexSource(source.text, source.startLine)",
    "latexReferencesInLine(line, startLine + index)",
    "Citations referenced in current editor context",
    "symbol.detail ? ` - ${symbol.detail}` : \"\"",
  ]) &&
    includesAll(backend, [
      "biblatex::Bibliography::parse",
      "format_bib_entry_detail",
      "entry.author()",
      "entry.date()",
      ".title()",
      "normalize_bib_field_value(&chunks.format_verbatim())",
    ]),
);

addCheck(
  "Codex editor context includes labels referenced nearby",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_LABEL_REFS",
    "codexContextLabelRefs(context, effectiveSymbols)",
    "labelKeysInLatexSource(source.text, source.startLine)",
    "latexReferencesInLine(line, startLine + index)",
    "Labels referenced in current editor context",
    'symbol.kind === "label"',
  ]) &&
    includesAll(backend, [
      "fn parse_tex_symbols",
      "\"label\".to_string()",
    ]),
);

addCheck(
  "Codex editor context preserves labels defined in the current source range",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_DEFINED_LABELS",
    "const contextDefinedLabels = codexContextDefinedLabels(context);",
    "definedLatexLabelsInSource(source.text, source.startLine)",
    "Labels defined in current editor context",
    "preserve these \\\\label keys unless the user explicitly asks to rename them",
    "labelPattern = /\\\\label\\s*\\{([^}]*)\\}/g",
    "stripLatexLineComment(line)",
    "line ${label.line}: ${label.key}",
  ]),
);

addCheck(
  "Codex editor context summarizes LaTeX environments before natural-language edits",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_ENVIRONMENTS",
    "const contextEnvironments = codexContextEnvironments(context);",
    "latexEnvironmentsInSource(source.text, source.startLine)",
    "LaTeX environments in current editor context",
    "Preserve matching \\\\begin/\\\\end structure, captions, and labels",
    "beginPattern = /\\\\begin\\s*\\{([^}]*)\\}/g",
    "captionMatch = visibleLine.match(/\\\\caption",
    "truncateLatexSummaryText(captionMatch[1].trim(), 96)",
  ]),
);

addCheck(
  "Codex editor context includes graphics referenced nearby",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_GRAPHICS",
    "codexContextGraphics(context, effectiveProjectFiles)",
    "latexFileReferencesInLine(line, source.startLine + index, projectFiles)",
    'reference.kind !== "graphics"',
    "Graphics referenced in current editor context",
    "reference.resolvedPath ? ` -> ${reference.resolvedPath}` : \" -> unresolved\"",
    "`- line ${reference.range.startLineNumber}: \\\\${reference.command}{${reference.path}}${resolved}`",
  ]) &&
    includesAll(backend, [
      "\"includegraphics\" => Some(LatexFileReferenceKind::Graphics)",
      "LatexFileReferenceKind::Graphics",
      "resolve_latex_file_reference",
    ]),
);

addCheck(
  "Codex editor context includes local unresolved TODO review comments",
  includesAll(app, [
    "MAX_CODEX_CONTEXT_TODOS",
    "const effectiveTodos = contextOverride?.todos ?? projectTodos;",
    "codexContextTodos(context, effectiveTodos)",
    "codexContextLineRange(context)",
    "Unresolved TODO/review comments in current editor context",
    "!item.resolved",
    "item.file === context.file",
  ]) &&
    includesAll(backend, [
      "fn parse_project_todos",
      "parse_todo_comment",
      '"REVIEW"',
    ]),
);

addCheck(
  "Codex prompt can reference project files with @mentions",
  includesAll(app, [
    "MAX_CODEX_REFERENCED_FILES",
    "MAX_CODEX_REFERENCED_FILE_CONTEXT",
    "resolveCodexFileMentionPaths(",
    "readCodexReferencedFileContexts(",
    "buildCodexReferencedFilesContext(referencedFiles)",
    "Referenced project files from @mentions in the user request:",
    "The user explicitly mentioned these project files with @file syntax",
    "可用 @文件名 引用项目文件",
  ]) &&
    includesAll(editorLogic, [
      "resolveCodexFileMentionPaths",
      "codexFileMentionTokens",
      "normalizeCodexFileMentionToken",
      "resolveCodexFileMentionPath",
    ]) &&
    includesAll(editorLogicTests, [
      "请润色 @intro 并和 @sections/method.tex 保持一致",
      "检查 @intro.tex 和 @refs.bib。",
      '"sections/method.tex"',
      '"sections/intro.tex"',
      '"refs.bib"',
    ]),
);

addCheck(
  "Codex prompt can reference labels and citations with #mentions",
  includesAll(app, [
    "MAX_CODEX_REFERENCED_SYMBOLS",
    "MAX_CODEX_REFERENCED_SYMBOL_CONTEXT",
    "CODEX_SYMBOL_CONTEXT_RADIUS",
    "CodexReferencedSymbolContext",
    "codexSymbolMentionTokens(prompt)",
    "readCodexReferencedSymbolContexts(project.root, userPrompt",
    "resolveCodexSymbolMentionKeys(userPrompt, symbols, MAX_CODEX_REFERENCED_SYMBOLS)",
    "readCodexSymbolSourceContexts(projectRoot, mentionedSymbols, MAX_CODEX_REFERENCED_SYMBOLS)",
    "readCodexSymbolSourceContext(symbol, content)",
    "buildCodexReferencedSymbolsContext(referencedSymbols)",
    "Referenced LaTeX labels/citations from #mentions in the user request:",
    "The user explicitly mentioned these labels or citations with #key syntax",
    "#label/#citation 引用符号",
  ]) &&
    includesAll(editorLogic, [
      "codexSymbolMentionTokens",
      "normalizeCodexSymbolMentionToken",
    ]) &&
    includesAll(editorLogicTests, [
      "#sec:intro",
      "#smith2026latex",
      "不要把 C# 当成引用",
      "normalizeCodexSymbolMentionToken",
	    ]),
);

addCheck(
  "Codex command input suggests @files and #symbols inline",
  includesAll(appAndCodexMentionMenu, [
    "CodexMentionQuery",
    "CodexMentionSuggestion",
    "MAX_CODEX_MENTION_SUGGESTIONS",
    "codexPromptCursor",
    "isCodexPromptFocused",
    "codexMentionIndex",
    "codexMentionQueryAtCursor(codexPrompt, codexPromptCursor)",
    "codexMentionSuggestionsForQuery(codexMentionQuery, allProjectFiles, projectSymbols)",
    "handleInsertCodexMention",
    "codex-mention-menu",
    "Codex 上下文引用建议",
    "项目文件",
    "标签 / 引用",
    "event.key === \"ArrowDown\"",
    "event.key === \"ArrowUp\"",
    "event.key === \"Tab\"",
    "codexMentionKindLabel(suggestion.kind)",
    "keyCounts.get(symbol.key.toLowerCase())",
  ]) &&
    hasCssBlock(".codex-command-input-stack", ["position: relative;"]) &&
    hasCssBlock(".codex-mention-menu", ["position: absolute;", "z-index: 30;"]) &&
    hasCssBlock(".codex-mention-item", ["grid-template-columns: auto minmax(0, 1fr);"]) &&
    hasCssBlock(".codex-mention-item:hover,\n.codex-mention-item-active", ["background: #eef7fb;"]) &&
    hasCssBlock(".codex-mention-kind-citation", ["background: #fff4df;"]),
);

addCheck(
  "Codex mention menu lives outside the main App component",
  includesAll(app, [
    'import { CodexMentionMenu',
    "<CodexMentionMenu",
  ]) &&
    includesAll(codexMentionMenu, [
      "export function CodexMentionMenu",
      "export type CodexMentionSuggestion",
      "codex-mention-menu",
      "Codex 上下文引用建议",
      "codexMentionKindLabel",
    ]) &&
    !app.includes('className="codex-mention-menu"'),
);

addCheck(
  "outline symbols and review comments can be added to the Codex prompt as structured context",
  includesAll(app, [
    "insertCodexPromptContext(",
    "handleAddOutlineItemToCodex",
    "handleAddTodoToCodex",
    "handleAddSymbolToCodex",
    "上下文：@${item.file}",
    "上下文：#${symbol.key}",
    "加入 Codex 上下文",
    "outline-codex-button",
    "todo-context-button",
    "symbol-codex-button",
    "已把 ${symbol.key} 加入 Codex 上下文。",
  ]) &&
    hasCssBlock(".outline-item-row", ["grid-template-columns: minmax(0, 1fr) 28px;"]) &&
    hasCssBlock(".outline-codex-button", ["opacity: 0.36;", "width: 26px;"]) &&
    hasCssBlock(".todo-context-button", ["height: 30px;", "width: 30px;"]) &&
    hasCssBlock(".symbol-codex-button", ["background: #eef6f8;", "color: #285d6d;"]),
);

addCheck(
  "Codex prompt context is visible as removable chips before running",
  includesAll(appAndCodexContextStrip, [
    "codexPromptReferencedFiles",
    "codexPromptReferencedSymbols",
    "codexEditableScopeFiles",
    "hasVisibleContext",
    "codex-context-strip",
    "Codex 已选上下文",
    "handleOpenCodexContextFile",
    "handleOpenCodexContextSymbol",
    "handleRemoveCodexPromptMention",
    "removeCodexPromptMention(codexPrompt, trigger, value)",
    "uniqueProjectSymbolByKey(projectSymbols, key)",
    "formatCodexContextHint(pinnedContext)",
    "当前 diff",
    "仅改上下文",
    "已移除 ${trigger}${value} 上下文引用。",
  ]) &&
    hasCssBlock(".codex-context-strip", ["display: flex;", "overflow: auto hidden;"]) &&
    hasCssBlock(".codex-context-chip", ["border-radius: 999px;", "max-width: 180px;"]) &&
    hasCssBlock(".codex-context-chip-file", ["background: #eaf6ef;", "color: #21613a;"]) &&
    hasCssBlock(".codex-context-chip-citation", ["background: #fff4df;", "color: #8a5d0d;"]) &&
    hasCssBlock(".codex-context-chip-scope", ["background: #f1f7ff;", "color: #255f9f;"]) &&
    hasCssBlock(".codex-context-chip-remove", ["border-left: 1px solid rgba(90, 105, 120, 0.16);"]),
);

addCheck(
  "Codex context chips live outside the main App component",
  includesAll(app, [
    'import { CodexContextStrip } from "./components/CodexContextStrip"',
    "<CodexContextStrip",
  ]) &&
    includesAll(codexContextStrip, [
      "export function CodexContextStrip",
      "CodexPreflightItem",
      "codex-context-chip-pinned",
      "codex-context-chip-file",
      "codex-context-chip-scope",
      "codex-preflight-strip",
    ]) &&
    !app.includes('className="codex-context-chip-main"') &&
    !app.includes('className="codex-preflight-strip"'),
);

addCheck(
  "Codex command box shows a compact preflight before running",
  includesAll(appAndCodexContextStrip, [
    "codexPreflightItems",
    "shouldShowCodexPreflight",
    "Codex 运行前预检",
    "预检",
    "执行会修改文件；问只读分析",
    "允许修改",
    "当前项目内",
    "锁定片段",
    "锁定选区",
    "锁定光标",
    "@文件 ${codexPromptReferencedFiles.length}",
    "#符号 ${codexPromptReferencedSymbols.length}",
    "带 diff",
    "codex-preflight-strip",
  ]) &&
    hasCssBlock(".codex-preflight-strip", [
      "background: #f8fbfd;",
      "display: flex;",
      "overflow: auto hidden;",
    ]) &&
    hasCssBlock(".codex-preflight-item", ["border-radius: 999px;", "max-width: 190px;"]) &&
    hasCssBlock(".codex-preflight-item-scope", ["background: #f1f7ff;", "color: #255f9f;"]) &&
    hasCssBlock(".codex-preflight-item-warn", ["background: #fff8ea;", "color: #7b5918;"]),
);

addCheck(
  "Codex context-only mode injects an edit scope and auto-reverts out-of-scope files",
  includesAll(appAndCodexDiff, [
    "isCodexContextOnlyEnabled",
    "setIsCodexContextOnlyEnabled",
    "canUseCodexContextScope",
    "buildCodexEditScopeContext(codexEditableScopeFiles)",
    "Codex edit scope lock from LaTeX Studio:",
    "Modify only the files listed below.",
    "Allowed edit files:",
    "allowedFiles: contextScopeFiles",
    "const scopeRevertedFiles = summary.scopeRevertedFiles ?? [];",
    "已自动撤回 ${scopeRevertedFiles.length} 个上下文外文件",
    "CodexScopeGuardNotice",
    "范围护栏已生效",
    "已从运行前快照恢复 {files.length} 个上下文外文件",
    "没有保留的文件变化。",
    'aria-label="仅改上下文文件"',
    "仅上下文",
    "codex-scope-toggle",
  ]) &&
    includesAll(types, ["scopeRevertedFiles?: string[]", "allowedFiles?: string[]"]) &&
    includesAll(backend, [
      "allowed_files: Option<Vec<String>>",
      "scope_reverted_files: Vec<String>",
      "normalize_codex_allowed_files",
      "enforce_codex_allowed_file_scope",
      "restore_snapshot_file_state(root, run_id, &relative)",
      "codex_allowed_file_scope_reverts_out_of_scope_changes_before_compile",
    ]) &&
    hasCssBlock(".codex-scope-toggle.codex-context-toggle-on", [
      "background: #eaf3ff;",
      "color: #255f9f;",
    ]) &&
    hasCssBlock(".codex-scope-guard-notice", [
      "background: #f4f8ff;",
      "border-left: 3px solid #4e8fd6;",
      "display: grid;",
    ]) &&
    hasCssBlock(".codex-scope-guard-files", ["display: flex;", "flex-wrap: wrap;"]) &&
    hasCssBlock(".codex-command-bar", [
      "grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto;",
    ]),
);

addCheck(
  "Codex project context includes paper overview without adding UI clutter",
  includesAll(app, [
    "ProjectOverview",
    "listProjectOverview(root)",
    "setProjectOverview(nextOverview)",
    "contextOverride?.overview ?? projectOverview",
    "Paper overview:",
    "overview.abstractText",
  ]) &&
    !app.includes("formatCodexProjectContextHint(") &&
    includesAll(backend, [
      "struct ProjectOverview",
      "fn list_project_overview",
      "fn parse_tex_overview",
      "find_latex_environment_content(&visible, \"abstract\")",
      "parses_project_overview_for_codex_context",
    ]),
);

addCheck(
  "Codex project context includes main LaTeX preamble and macro/package setup",
  includesAll(app, [
    "projectPreambleContext",
    "setProjectPreambleContext",
    "readProjectPreambleContext(root, mainFile)",
    "extractLatexPreambleContext(mainFile, mainContent)",
    "MAX_CODEX_PREAMBLE_CONTEXT",
    "contextOverride?.preambleContext ?? projectPreambleContext",
    "Main LaTeX preamble context:",
    "Respect the existing document class, packages, theorem setup, and custom macros",
    "Preamble excerpt before \\\\begin{document}:",
    "stripLatexLineComment(line)",
  ]),
);

addCheck(
  "Codex project context includes local style and class files for template-aware edits",
  includesAll(app, [
    "MAX_CODEX_LOCAL_STYLE_CONTEXT_FILES",
    "MAX_CODEX_LOCAL_STYLE_CONTEXT",
    "projectLocalStyleContexts",
    "setProjectLocalStyleContexts",
    "readProjectLocalStyleContexts(root, nextDependencies)",
    "isCodexLocalStyleContextPath",
    ".filter(isCodexLocalStyleContextPath)",
    "contextOverride?.localStyleContexts ?? projectLocalStyleContexts",
    "Local LaTeX style/class context",
    "project-local template/style files resolved from \\\\documentclass, \\\\usepackage",
    "Respect their macros, environments, submission rules, and formatting constraints",
    "File content was truncated to ${MAX_CODEX_LOCAL_STYLE_CONTEXT}",
    "/\\.(sty|cls|bst|bbx|cbx)$/.test(normalized)",
  ]),
);

addCheck(
  "Codex project context includes project-defined macro summaries",
  includesAll(app, [
    "CodexLatexMacroSummary",
    "MAX_CODEX_MACRO_SUMMARIES",
    "MAX_CODEX_MACRO_SOURCE_FILES",
    "projectMacroSummaries",
    "setProjectMacroSummaries",
    "readProjectMacroSummaries(",
    "parseLatexMacroSummaries(path, await readFile(root, path))",
    "parseLatexMacroSummaryLine",
    "newcommand|renewcommand|providecommand|DeclareRobustCommand",
    "NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|DeclareDocumentCommand",
    "DeclareMathOperator",
    "newenvironment|renewenvironment",
    "Project-defined LaTeX macros",
    "Prefer reusing these existing local commands/environments/operators",
    "No local macro definitions indexed from document sources or project-local style/class files.",
    "contextOverride?.macroSummaries ?? projectMacroSummaries",
  ]),
);

addCheck(
  "Codex project context includes main document source order",
  includesAll(app, [
    "MAX_CODEX_DOCUMENT_FILES",
    "listProjectDocumentFiles(root)",
    "setProjectDocumentFiles(nextDocumentFiles)",
    "contextOverride?.documentFiles ?? projectDocumentFiles",
    "Document source order (",
    "No document source order indexed.",
  ]) &&
    includesAll(backend, [
      "fn list_project_document_files",
      "tex_project_files_in_document_order",
      "lists_project_document_files_in_main_order",
    ]),
);

addCheck(
  "Codex project context includes the LaTeX dependency graph",
  includesAll(app, [
    "ProjectDependency",
    "listProjectDependencies(root)",
    "setProjectDependencies(nextDependencies)",
    "contextOverride?.dependencies ?? projectDependencies",
    "MAX_CODEX_DEPENDENCIES",
    "Project dependencies (",
    "No LaTeX file dependencies indexed.",
    "resolvedPath",
  ]) &&
    includesAll(backend, [
      "struct ProjectDependency",
      "fn list_project_dependencies",
      "list_project_dependencies_in_root",
      "parse_project_dependencies_in_visible_line",
      "resolve_latex_file_reference",
      "lists_project_dependencies_for_codex_context",
    ]),
);

addCheck(
  "sidebar exposes a compact project structure and dependency view",
  includesAll(app, [
    "STRUCTURE_COLLAPSED_PREF_KEY",
    "MAX_PROJECT_STRUCTURE_DOCUMENTS",
    "MAX_PROJECT_STRUCTURE_DEPENDENCIES",
    "visibleStructureDocuments",
    "visibleStructureDependencies",
    "handleProjectDependencyClick",
    "handleAddProjectDocumentToCodex",
    "handleAddProjectDependencyToCodex",
    "projectDependencyKindLabel",
    "项目结构",
    "文档顺序",
    "文件引用",
    "文件引用 ${dependency.sourceFile}:${dependency.line}",
    "已把 ${shortFileName(path)} 加入 Codex 上下文。",
    "已把 ${shortFileName(contextPath)} 的文件引用上下文加入 Codex。",
    "已打开 ${dependency.resolvedPath}。",
    "未找到 ${dependency.target}，已定位到引用位置。",
    'className="structure-codex-button"',
    "projectDependencies.length",
    "projectDocumentFiles.length",
  ]) &&
    hasCssBlock(".structure-pane", ["display: block;", "border-top: 1px solid #d8dee6;"]) &&
    hasCssBlock(".structure-panel", ["max-height: 260px;", "overflow: auto;"]) &&
    hasCssBlock(".structure-row", [
      "grid-template-columns: minmax(0, 1fr) 30px;",
      "align-items: stretch;",
    ]) &&
    hasCssBlock(".structure-document,\n.structure-dependency", [
      "grid-template-columns: auto minmax(0, 1fr);",
      "text-align: left;",
      "width: 100%;",
    ]) &&
    hasCssBlock(".structure-codex-button", ["width: 30px;", "background: #f5f8fb;"]) &&
    hasCssBlock(".structure-dependency-missing", ["background: #fff7f2;", "border-color: #efc7a8;"]),
);

addCheck(
  "Codex project context includes labels and citation keys",
  includesAll(app, [
    "MAX_CODEX_SYMBOLS",
    "projectSymbols",
    "contextOverride?.symbols ?? projectSymbols",
    "Project labels and citations (",
    "No labels or citations indexed.",
  ]) &&
    includesAll(backend, [
      "struct ProjectSymbol",
      "fn list_project_symbols",
      "parse_tex_symbols",
      "parse_bib_symbols",
      "indexes_project_symbols_for_refs_and_cites",
    ]),
);

addCheck(
  "Codex ask output can be copied and converted into edit prompts or review comments",
  includesAll(appAndCodexAnswer, [
    "handleCopyCodexAnswer",
    "navigator.clipboard.writeText(codexAnswer)",
    "handleUseCodexAnswerAsEditPrompt",
    "handleInsertCodexAnswerAsReviewComment",
    "formatCodexAnswerReviewComment(codexAnswer",
    "Codex 问答建议：",
    "已把 Codex 回答转为修改指令",
    "已把 Codex 输出插入为 REVIEW 批注",
    'className="codex-answer-actions"',
    "复制 Codex 回答",
    "Codex 输出",
    "已复制 Codex 输出。",
    "把回答转成修改指令",
    "把回答插入为 REVIEW 批注",
    "转为修改",
    "转为批注",
  ]) &&
    includesAll(editorLogic, [
      "export function formatCodexAnswerReviewComment",
      "% REVIEW: Codex 建议",
      "% REVIEW-END",
    ]) &&
    editorLogicTests.includes("formatCodexAnswerReviewComment(\"Add motivation.") &&
    hasCssBlock(".codex-answer-header", [
      "display: flex;",
      "justify-content: space-between;",
    ]) &&
    hasCssBlock(".codex-answer-actions button", [
      "height: 28px;",
      "background: #f5f8fb;",
    ]),
);

addCheck(
  "Codex answer view lives outside the main App component",
  includesAll(app, [
    'import { CodexAnswerView } from "./components/CodexAnswerView"',
    "<CodexAnswerView",
  ]) &&
    includesAll(codexAnswerView, [
      "export function CodexAnswerView",
      "Codex 输出",
      "复制 Codex 回答",
      "把回答转成修改指令",
      "把回答插入为 REVIEW 批注",
    ]) &&
    !app.includes('className="codex-answer-actions"'),
);

addCheck(
  "Overleaf-style project templates are visible in the UI and backed by real project generation",
  includesAll(app, [
    "PROJECT_TEMPLATES",
    'value: "preprint"',
    'value: "chinese-multifile"',
    'value: "beamer"',
    'className=\"template-gallery\"',
    'className="template-preview"',
    'aria-label="模板预览"',
    "selectedProjectTemplate",
    "useCase",
    "engine",
    "files",
    "features",
    'className="template-preview-badges"',
    'className="template-file-preview"',
  ]) &&
    includesAll(backend, [
      '"preprint" | "arxiv" | "draft"',
      '"chinese-multifile"',
      '"beamer" | "slides" | "presentation"',
      "creates_projects_from_templates",
    ]) &&
    hasCssBlock(".template-preview", [
      "background: #fbfdff;",
      "grid-template-columns: minmax(0, 1fr) minmax(180px, 0.72fr);",
    ]) &&
    hasCssBlock(".template-preview-badges", ["display: flex;", "flex-wrap: wrap;"]) &&
    hasCssBlock(".template-file-preview", ["background: #ffffff;", "display: grid;"]) &&
    hasCssBlock(".template-file-preview code", ["font-family: ui-monospace", "text-overflow: ellipsis;"]),
);

addCheck(
  "new project creation stays available while another project is open",
  includesAll(app, [
    "newProjectName",
    "setNewProjectName",
    "project-new-row",
    "新项目名；留空会自动创建 paper-...",
    "handleCreateProject(newProjectName)",
    "setNewProjectName(\"\")",
    "project-path-row",
    "粘贴已有项目文件夹路径，或输入已有项目名",
  ]) &&
    includesAll(backend, [
      "next_available_project_dir(",
      "default_projects_dir()?.join(unique_project_dir_name())",
    ]) &&
    hasCssBlock(".project-new-row", ["grid-template-columns: minmax(260px, 1fr) auto;"]) &&
    hasCssBlock(".project-path-row", ["grid-template-columns: minmax(260px, 1fr) auto auto;"]),
);

addCheck(
  "tabs, quick open, outline, citations, and project search stay wired into the writing workflow",
  includesAll(app, [
    'className="editor-tabs"',
    "openQuickOpen",
    'placeholder="快速打开文件"',
    'className={`outline-pane',
    'className={`symbols-pane',
    "handleProjectSearch",
    "projectSearchGroups",
    "groupSearchResultsByFile",
    'className="project-search-group"',
    'className="project-search-group-title"',
  ]) &&
    !app.includes('className="recent-file-strip"') &&
    !app.includes('aria-label="最近打开文件"') &&
    !app.includes("recentFileShortcuts.map"),
);

addCheck(
  "document outline can be filtered for long Overleaf-style projects",
  includesAll(app, [
    "outlineQuery",
    "setOutlineQuery",
    "visibleOutlineItems",
    "activeOutlineItem",
    "activeOutlineItemForCursor(outline, activePath, editorCursorPosition.line)",
    "activeOutlineItemForCursor(items: OutlineItem[], activePath: string, line: number)",
    'item.kind !== "label"',
    "outline-item-active",
    "filterOutlineItems(outline, outlineQuery).slice(0, 120)",
    "filterOutlineItems(items: OutlineItem[], query: string)",
    'className="outline-panel"',
    'aria-label="搜索文档大纲"',
    'placeholder="搜索大纲 / label"',
    "没有匹配的大纲项。",
    "已筛选 ${visibleOutlineItems.length}/${outline.length} 项。",
  ]) &&
    includesAll(backend, [
      "tex_project_files_in_document_order(&root, &settings)",
      "fn visit_tex_file_in_document_order",
      "project_outline_follows_main_document_order",
    ]) &&
    hasCssBlock(".outline-panel", ["display: grid;", "gap: 8px;", "padding: 8px;"]) &&
    hasCssBlock(".outline-panel input", ["height: 30px;", "padding: 0 9px;"]) &&
    hasCssBlock(".outline-item-row-active", ["background: #e7f3ec;"]) &&
    hasCssBlock(".outline-item-active", [
      "background: transparent;",
      "border-color: #b8d8c3;",
      "box-shadow: inset 3px 0 0 #2f7d4a;",
    ]) &&
    hasCssBlock(".outline-more", ["color: #758392;", "font-size: 11px;"]),
);

addCheck(
  "project-wide unresolved refs and citations are indexed for sidebar and Codex context",
  includesAll(app, [
    "listProjectReferenceIssues",
    "projectReferenceIssues",
    "visibleReferenceIssues",
    'className="reference-issues"',
    'className="reference-issues-list"',
    "handleReferenceIssueClick",
    "handleFixReferenceIssueWithCodex",
    "handleFixAllReferenceIssuesWithCodex",
    "Codex 引用前保存",
    "Codex 批量引用前保存",
    "buildReferenceIssueFixPrompt",
    "buildReferenceIssueFixPrompt(project, issue, sourceContext)",
    "buildReferenceIssuesFixPrompt",
    "buildReferenceIssuesFixPrompt(project, projectReferenceIssues, sourceContexts)",
    "codexAllowedFilesForReferenceIssues([issue], allProjectFiles, projectBibFiles)",
    "codexAllowedFilesForReferenceIssues(projectReferenceIssues, allProjectFiles, projectBibFiles)",
    "缺失引用相关文件",
    "MAX_CODEX_REFERENCE_ISSUES",
    "MAX_CODEX_REFERENCE_SOURCE_SNIPPETS",
    "REFERENCE_SOURCE_CONTEXT_RADIUS",
    "referenceIssueSourceSnippet",
    "Source context around the unresolved reference:",
    "Source contexts around the first unresolved references",
    "Use the source context below as the primary location for the fix.",
    'className="reference-issue-codex-button"',
    'className="reference-issues-codex-all"',
    "让 Codex 修复这条缺失引用",
    "让 Codex 批量修复缺失引用",
    "修全部",
    "referenceIssueKindLabel(issue.kind)",
    "Unresolved references",
    "Unresolved references shown",
    "缺失引用",
    "Do not invent bibliographic facts",
  ]) &&
    includesAll(backend, [
      "ProjectReferenceIssue",
      "list_project_reference_issues",
      "list_project_reference_issues_in_root",
      "parse_project_reference_issues",
      "parse_latex_references_in_line",
      "indexes_unresolved_project_references",
    ]) &&
    hasCssBlock(".reference-issues", ["background: #fff8eb;", "border: 1px solid #dfbd70;"]) &&
    hasCssBlock(".reference-issues-title", ["grid-template-columns: auto minmax(0, 1fr) auto auto;"]) &&
    hasCssBlock(".reference-issues-codex-all", ["height: 26px;", "padding: 0 7px;"]) &&
    hasCssBlock(".reference-issue", ["grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".reference-issue-main", ["grid-template-columns: 36px minmax(0, 1fr) auto;", "height: 30px;"]) &&
    hasCssBlock(".reference-issue-codex-button", ["height: 30px;", "width: 30px;"]),
);

addCheck(
  "file tree reveals the active file by expanding parent directories",
  includesAll(fileTreeNode, [
    "useEffect",
    "isActiveWithin",
    "activePath.startsWith(`${node.path}/`)",
    "setIsOpen(true)",
    "tree-directory-active",
  ]) &&
    hasCssBlock(".tree-directory-active > summary", [
      "background: #eef7f0;",
      "color: #1f5f3a;",
    ]),
);

addCheck(
  "file tree supports right-click operation menus for files and folders",
  includesAll(fileTreeNode, [
    "function openContextMenu",
    "function keepMenuClickInsideRow",
    "menuWrapRef",
    'window.addEventListener("pointerdown", closeOnPointerDown, true)',
    'window.addEventListener("keydown", closeOnEscape, true)',
    'event.key === "Escape"',
    "onMouseDown={keepMenuClickInsideRow}",
    "event.preventDefault()",
    "event.stopPropagation()",
    "setIsMenuOpen(true)",
    "onContextMenu={openContextMenu}",
    "tree-file-row",
  ]) &&
    hasCssBlock(".tree-directory summary", ["overflow: visible;"]) &&
    hasCssBlock(".tree-node-menu", ["position: absolute;", "z-index: 30;"]),
);

addCheck(
  "project file creation uses an inline Overleaf-style sidebar panel",
  includesAll(app, [
    "CreateEntryDraft",
    "createEntryDraft",
    "createEntryInputRef",
    "project-create-pane",
    "project-create-kind",
    "project-create-row",
    "handleSubmitCreateEntry",
    "suggestedProjectEntryPath",
    "setIsSearchOpen(false)",
    "event.key === \"Escape\"",
  ]) &&
    !app.includes("输入要新建的") &&
    hasCssBlock(".project-create-pane,\n.project-rename-pane,\n.project-delete-pane", [
      "background: #fbfcfd;",
      "border-bottom: 1px solid #d8dee6;",
    ]) &&
    hasCssBlock(".project-create-kind", ["grid-template-columns: 1fr 1fr;", "border-radius: 7px;"]) &&
    hasCssBlock(".project-create-row,\n.project-rename-row", ["grid-template-columns: minmax(0, 1fr) auto;"]),
);

addCheck(
  "project file rename uses an inline sidebar panel and keeps the main file setting in sync",
  includesAll(app, [
    "RenameEntryDraft",
    "renameEntryDraft",
    "renameEntryInputRef",
    "renameDraftHasDirtyTabs",
    "project-rename-pane",
    "project-rename-row",
    "project-rename-warning",
    "handleSubmitRenameEntry",
    "renameEntryDraft?.fromPath === targetPath",
    "已取消重命名。",
    "onRenameEntry={(node) => void runSafely(() => handleRenameEntry(node))}",
    "remapActivePathAfterRename(project.mainFile, targetPath, nextPath)",
    "updateProjectSettings(project.root, { ...projectSettings, mainFile: nextMainFile })",
    "await saveAllOpenTabs()",
    "setIsSidebarCollapsed(false)",
    "setCreateEntryDraft(null)",
    "event.key === \"Escape\"",
    "renameResult.updatedReferences",
    "同步更新 ${renameResult.updatedReferenceFiles.length} 个源码文件中的 ${renameResult.updatedReferences} 处 LaTeX 引用。",
  ]) &&
    includesAll(backend, [
      "RenameProjectEntryResult",
      "rewrite_latex_file_references_after_rename",
      "rewrite_latex_file_reference_argument",
      "remap_latex_file_reference_token",
      "remap_relative_path_after_rename",
      "主文件重命名后仍需要是 .tex 文件。",
      "settings.main_file = next_main_file",
      "write_json(&root.join(\".latex-studio.json\"), &settings)",
      "assert_eq!(load_settings(&root).unwrap().main_file, \"paper.tex\")",
      "load_settings(&nested_root).unwrap().main_file",
      "\"chapters/main.tex\"",
      "renaming_project_files_updates_latex_file_references",
      "assert!(main.contains(\"\\\\input{sections/background}\"))",
    ]) &&
    !app.includes("window.prompt(\"输入新的路径\"") &&
    !app.includes("相关文件还没有保存。重命名前先保存这些修改吗？") &&
    hasCssBlock(".project-create-pane,\n.project-rename-pane,\n.project-delete-pane", [
      "background: #fbfcfd;",
      "border-bottom: 1px solid #d8dee6;",
    ]) &&
    hasCssBlock(".project-create-row,\n.project-rename-row", ["grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".icon-button-active", ["background: #e7f3ec;", "color: #21613a;"]) &&
    hasCssBlock(".project-rename-warning", ["background: #fff8eb;", "grid-template-columns: auto minmax(0, 1fr);"]),
);

addCheck(
  "project file deletion uses an inline sidebar confirmation with main-file protection",
  includesAll(app, [
    "DeleteEntryDraft",
    "deleteEntryDraft",
    "ProjectFileUsage",
    "deleteDraftHasDirtyTabs",
    "project-delete-pane",
    "project-delete-warning",
    "project-delete-usages",
    "project-delete-usages-list",
    "project-delete-actions",
    "project-delete-danger",
    "handleSubmitDeleteEntry",
    "listProjectFileUsages(project.root, targetPath)",
    "deleteEntryDraft.usages.length",
    "删除后下面这些引用会失效",
    "isProjectMainPathAffected(project.mainFile, targetPath)",
    "setDeleteEntryDraft({ path: targetPath, usages: [], isCheckingUsages: true })",
    "setRenameEntryDraft(null)",
    "不能删除当前主文件",
    "event.key === \"Escape\"",
  ]) &&
    includesAll(tauri, ["list_project_file_usages", "ProjectFileUsage"]) &&
    includesAll(backend, [
      "list_project_file_usages",
      "list_project_file_usages_in_root",
      "parse_project_file_usages",
      "project_file_reference_matches_target",
      "lists_project_file_usages_before_deleting_referenced_files",
    ]) &&
    !app.includes("确定删除 ${targetPath}") &&
    hasCssBlock(".project-create-pane,\n.project-rename-pane,\n.project-delete-pane", [
      "background: #fbfcfd;",
      "border-bottom: 1px solid #d8dee6;",
    ]) &&
    hasCssBlock(".project-delete-warning", ["background: #fff4d7;", "grid-template-columns: auto minmax(0, 1fr);"]) &&
    hasCssBlock(".project-delete-usages", ["background: #fff8eb;", "border: 1px solid #dfbd70;"]) &&
    hasCssBlock(".project-delete-usages-list button", ["grid", "text-align: left;"]) &&
    hasCssBlock(".project-delete-danger", ["background: #fff1f1;", "color: #8f3030;"]),
);

addCheck(
  "project file listing sorts directories first while search hides internal metadata",
  includesAll(backend, [
    "right_is_dir",
    "cmp(&left_is_dir)",
    'name == ".git" || name == ".latex-studio"',
    "is_internal_project_metadata_path",
    'path == ".latex-studio.json"',
    "is_internal_project_metadata_path(&relative) || !is_searchable_text_path(&relative)",
    "list_project_files_sorts_directories_first_and_hides_metadata",
  ]),
);

addCheck(
  "quick open behaves like a multi-file paper switcher with focus, match highlights, and open/current badges",
  includesAll(app, [
    "quickOpenInputRef",
    "quickOpenInputRef.current?.focus()",
    "quickOpenInputRef.current?.select()",
    "setQuickOpenQuery(activeDisplayPath ? shortFileName(activeDisplayPath) : \"\")",
    "renderQuickOpenMatch(shortFileName(path), quickOpenQuery)",
    "renderQuickOpenMatch(path, quickOpenQuery)",
    "quickOpenMatchRanges(value: string, query: string)",
    "quick-open-badge-current",
    "quick-open-badge-open",
    "当前",
    "已打开",
  ]) &&
    hasCssBlock(".quick-open-item", ["grid-template-columns: minmax(0, 1fr) auto;", "align-items: center;"]) &&
    hasCssBlock(".quick-open-highlight", ["background: #ffe7a8;", "border-radius: 3px;"]) &&
    hasCssBlock(".quick-open-badge-current", ["background: #dff3e5;", "color: #1c6b3d;"]),
);

addCheck(
  "project search results are grouped by file for large LaTeX projects",
  includesAll(app, [
    "groupSearchResultsByFile(results: SearchResult[])",
    "new Map<string, SearchResult[]>()",
    "{group.results.length} 处",
    "{result.line}:{result.column}",
  ]) &&
    hasCssBlock(".project-search-group", ["border: 1px solid #d8dee6;", "overflow: hidden;"]) &&
    hasCssBlock(".project-search-group-title", [
      "grid-template-columns: minmax(0, 1fr) auto;",
      "background: #eef3f7;",
    ]) &&
    hasCssBlock(".project-search-result", ["grid-template-columns: 48px minmax(0, 1fr);", "width: 100%;"]),
);

addCheck(
  "project-wide replace uses an inline confirmation panel with history protection",
  includesAll(app, [
    "isReplaceConfirmVisible",
    "setIsReplaceConfirmVisible(true)",
    "handleConfirmProjectReplace",
    "createAutomaticHistorySnapshot(`替换“${searchQuery}”前`)",
    "project-replace-confirm",
    "project-replace-preview",
    "project-replace-confirm-button",
    "确认全项目替换",
    "确认替换",
    "替换后可从历史版本恢复",
  ]) &&
    !app.includes("将在整个项目中精确替换") &&
    hasCssBlock(".project-replace-confirm", ["background: #fff8eb;", "border: 1px solid #dfbd70;"]) &&
    hasCssBlock(".project-replace-preview", ["grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);"]) &&
    hasCssBlock(".project-replace-confirm-button", ["background: #fef0d4;", "color: #6b4a0e;"]),
);

addCheck(
  "Overleaf-style keyboard shortcuts are configurable and still work inside Monaco",
  includesAll(appAndPreferences, [
    "window.addEventListener(\"keydown\", handleKeyDown)",
    "SHORTCUT_PREF_KEY",
    "DEFAULT_SHORTCUTS",
    "SHORTCUT_DEFINITIONS",
    "loadShortcutPreferences",
    "saveShortcutPreferences",
    "eventMatchesShortcut(event, shortcuts.compile)",
    "eventMatchesShortcut(event, shortcuts.codex)",
    "eventMatchesShortcut(event, shortcuts.codexContext)",
    "eventMatchesShortcut(event, shortcuts.togglePreview)",
    "settings-shortcuts",
    "settings-shortcut-field",
    "让 Codex 修改...",
    "editor.addAction",
    "latex-studio.save",
    "latex-studio.compile",
    "latex-studio.quickOpen",
    "latex-studio.projectSearch",
    "latex-studio.findInFile",
    "latex-studio.replaceInFile",
    "latex-studio.goToLine",
    "latex-studio.focusCodex",
    "latex-studio.sendCodexContext",
    "latex-studio.syncPdf",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyF",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyF",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyG",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyJ",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyK",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyP",
    "latex-studio.bold",
    "latex-studio.italic",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyB",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyI",
    "latex-studio.closeActiveTab",
    "latex-studio.previousTab",
    "latex-studio.nextTab",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyW",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.BracketLeft",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.BracketRight",
    "projectSearchInputRef.current?.focus()",
    "editorShortcutActionsRef.current.findInFile()",
    "editorShortcutActionsRef.current.replaceInFile()",
    "editorShortcutActionsRef.current.goToLine()",
    "editorShortcutActionsRef.current.focusCodex()",
    "editorShortcutActionsRef.current.sendCodexContext()",
    "editorShortcutActionsRef.current.syncPdf()",
    "focusCodexPrompt",
    "handleSendEditorContextToCodex",
    "setIsSidebarCollapsed(false)",
    "setIsCodexCollapsed(false)",
    "⌘K",
    "⌘⇧K",
    "⌘P",
    "defaultLine = editorRef.current?.getPosition()?.lineNumber",
    "跳转行号",
    "项目搜索",
    "当前文件查找",
    "当前文件替换",
    "保存",
    "编译",
  ]),
);

addCheck(
  "preference and shortcut persistence lives outside the main App component",
  includesAll(app, [
    'from "./lib/preferences"',
    "loadBooleanPreference",
    "saveShortcutPreferences",
    "SHORTCUT_DEFINITIONS.map",
  ]) &&
    includesAll(preferences, [
      'const SHORTCUT_PREF_KEY = "latex-studio:shortcuts"',
      "export const DEFAULT_SHORTCUTS",
      "export const SHORTCUT_DEFINITIONS",
      "export function loadShortcutPreferences",
      "export function normalizeShortcutMap",
    ]) &&
    !app.includes("function loadBooleanPreference") &&
    !app.includes("function normalizeShortcutMap"),
);

addCheck(
  "Codex editor context can be locked from keyboard without leaving the editor",
  includesAll(appAndPreferences, [
    '| "codexContext"',
    'codexContext: "⌘⇧K"',
    '{ id: "codexContext", label: "锁定上下文"',
    "sendCodexContext: handleSendEditorContextToCodex",
    "latex-studio.sendCodexContext",
    "把当前选区或光标送入 Codex 上下文",
    "用 Codex 修改当前选区 (${shortcuts.codexContext})",
    "用 Codex 修改当前光标附近内容 (${shortcuts.codexContext})",
    "已锁定当前选区作为 Codex 上下文，请输入修改要求。",
  ]),
);

addCheck(
  "source-to-PDF SyncTeX has a configurable shortcut and toolbar hint",
  includesAll(appAndPreferences, [
    '| "syncPdf"',
    'syncPdf: "⌘⌥P"',
    '{ id: "syncPdf", label: "定位 PDF"',
    "eventMatchesShortcut(event, shortcuts.syncPdf)",
    "handleSyncPdfFromSource",
    "从当前源码位置定位到 PDF (${shortcuts.syncPdf})",
  ]),
);

addCheck(
  "editor toolbar exposes native current-file find and replace",
  includesAll(app, [
    "runEditorSearchAction(actionId: string, successStatus: string, failureStatus: string)",
    'runEditorSearchAction("actions.find"',
    'runEditorSearchAction(\n      "editor.action.startFindReplaceAction"',
    "editorRef.current.getAction(actionId)",
    "当前没有可查找的文本编辑器。",
    "已打开当前文件查找。",
    "已打开当前文件替换。",
    'aria-label="当前文件查找"',
    'aria-label="当前文件替换"',
  ]),
);

addCheck(
  "editor uses a white LaTeX theme with command and comment highlighting",
  includesAll(app, [
    "MONACO_LATEX_THEME",
    "configureMonacoLatexTheme",
    "beforeMount={configureMonacoLatexTheme}",
    "theme={MONACO_LATEX_THEME}",
  ]) &&
    includesAll(monacoLatex, [
      "latex-studio-light",
      "setMonarchTokensProvider(\"latex\"",
      "comment.latex",
      "keyword.latex",
      "\"editor.background\": \"#ffffff\"",
    ]) &&
    !app.includes('theme="vs-dark"') &&
    hasCssBlock(":root", ["background: #ffffff;"]) &&
    hasCssBlock(".app-shell", ["background: #ffffff;"]) &&
    hasCssBlock(".sidebar,\n.preview-panel", ["background: #ffffff;"]),
);

addCheck(
  "editor source content always fits the visible column without horizontal scrolling",
  includesAll(app, [
    'const EDITOR_WORD_WRAP_PREF_KEY = "latex-studio:editor-word-wrap"',
    "saveBooleanPreference(EDITOR_WORD_WRAP_PREF_KEY, true)",
    'wordWrap: "on"',
    'wrappingStrategy: "advanced"',
    'horizontal: "hidden"',
    "horizontalScrollbarSize: 0",
  ]) &&
    !app.includes("setIsEditorWordWrapEnabled") &&
    !app.includes('aria-label="切换自动换行"') &&
    hasCssBlock(".monaco-editor-host", ["height: 100%;", "overflow: hidden;", "width: 100%;"]) &&
    hasCssBlock(".monaco-editor-host > div,\n.monaco-editor-host .monaco-editor,\n.monaco-editor-host .overflow-guard", [
      "height: 100%;",
      "max-width: 100%;",
      "width: 100%;",
    ]) &&
    hasCssBlock(".monaco-editor-host .monaco-scrollable-element > .scrollbar.horizontal", [
      "display: none !important;",
    ]),
);

addCheck(
  "editor font size can be adjusted and persists as a writing preference",
  includesAll(app, [
    "DEFAULT_EDITOR_FONT_SIZE",
    "MIN_EDITOR_FONT_SIZE",
    "MAX_EDITOR_FONT_SIZE",
    'const EDITOR_FONT_SIZE_PREF_KEY = "latex-studio:editor-font-size"',
    "editorFontSize",
    "loadNumberPreference(\n      EDITOR_FONT_SIZE_PREF_KEY",
    "saveNumberPreference(EDITOR_FONT_SIZE_PREF_KEY, editorFontSize)",
    "editorRef.current?.updateOptions({ fontSize: editorFontSize })",
    "adjustEditorFontSize(delta: number)",
    "clamp(editorFontSize + delta, MIN_EDITOR_FONT_SIZE, MAX_EDITOR_FONT_SIZE)",
    "fontSize: editorFontSize",
    "减小编辑器字号",
    "增大编辑器字号",
    "编辑器字号 ${nextValue}px。",
  ]),
);

addCheck(
  "go-to-line uses an inline editor toolbar control instead of a browser prompt",
  includesAll(app, [
    "isGoToLineOpen",
    "goToLineValue",
    "goToLineInputRef",
    "handleSubmitGoToLine(event?: ReactFormEvent<HTMLFormElement>)",
    "setGoToLineValue(defaultLine.toString())",
    "setIsGoToLineOpen(true)",
    "className=\"go-to-line-form\"",
    "inputMode=\"numeric\"",
    "event.key === \"Escape\"",
    "已跳转到第 ${line} 行。",
  ]) &&
    !app.includes("window.prompt(\"跳转到行号\"") &&
    hasCssBlock(".go-to-line-form", ["display: inline-flex;", "height: 34px;"]) &&
    hasCssBlock(".go-to-line-form input", ["width: 48px;", "font-weight: 680;"]) &&
    hasCssBlock(".editor-toolbar .toolbar-actions .go-to-line-form button", ["height: 28px;", "width: 28px;"]),
);

addCheck(
  "editor status bar shows file, cursor, dirty, compile, and engine state",
  includesAll(app, [
    "editorCursorPosition",
    "editorSelectionSummary",
    "editorWordSummary",
    "countEditorText",
    "formatEditorWordSummary",
    "countPlainEditorText",
    "editorCompileStatus",
    "isPdfPossiblyStale",
    "pdfFreshnessLabel",
    "sourceRevision > compiledSourceRevision",
    "formatCompileTime(lastSuccessfulCompileAt)",
    "PDF 可能过期",
    "activeOutlineStatus",
    "activeOutlineItem",
    'className="editor-status-section"',
    'className="editor-statusbar"',
    'aria-label="编辑器状态"',
    "行 {editorCursorPosition.line}，列 {editorCursorPosition.column}",
    "outlineKindLabel(activeOutlineItem.kind)",
    "当前文件 ${count.words.toLocaleString(\"zh-CN\")} 词",
    "selectedCount.words",
    "selectedCount.characters",
    "dirtyTabCount ? `${dirtyTabCount} 个未保存` : \"全部已保存\"",
    "selectedEngine",
    'className={isPdfPossiblyStale ? "editor-status-pdf-stale" : ""}',
  ]) &&
    hasCssBlock(".editor-statusbar", [
      "display: flex;",
      "background: #20262d;",
      "overflow: auto hidden;",
    ]) &&
    hasCssBlock(".editor-status-path", ["text-overflow: ellipsis;", "font-weight: 680;"]) &&
    hasCssBlock(".editor-status-section", ["flex: 0 1 240px !important;", "text-overflow: ellipsis;"]) &&
    hasCssBlock(".editor-status-pdf-stale", ["color: #e7c06a;", "font-weight: 720;"]),
);

addCheck(
  "PDF preview header shows freshness without opening normal compile logs",
  includesAll(app, [
    "lastSuccessfulCompileAt",
    "setLastSuccessfulCompileAt(Date.now())",
    "setCompiledSourceRevision(sourceRevisionRef.current)",
    "已加载已有 PDF",
    "更新于 ${formatCompileTime(lastSuccessfulCompileAt)}",
    'className={isPdfPossiblyStale ? "preview-subtitle-stale" : ""}',
  ]) &&
    hasCssBlock(".panel-title-copy .preview-subtitle-stale", [
      "color: #9a6a12;",
      "font-weight: 720;",
    ]),
);

addCheck(
  "auto compile saves and compiles dirty edits even when auto save is disabled",
  includesAll(app, [
    "const shouldAutoCompile = isAutoCompileEnabled && environment?.canCompile === true;",
    "(!isAutoSaveEnabled && !shouldAutoCompile)",
    "const shouldAutoCompile = isAutoCompileEnabled && environment?.canCompile === true && !isCompiling;",
    "if (!project || !hasUnsavedTabs() || (!isAutoSaveEnabled && !shouldAutoCompile)) return;",
    "if (savedCount && shouldAutoCompile)",
    "await compileActiveProject(\"auto\")",
    "自动编译前保存",
  ]),
);

addCheck(
  "manual and automatic saves create de-duplicated project history versions",
  includesAll(app, [
    "PROJECT_SAVE_HISTORY_SIGNATURE_PREF_PREFIX",
    "lastSavedHistorySignatureRef",
    "computeProjectTextSaveSignature",
    "saveOpenTabsWithHistory(\"手动保存\")",
    "saveOpenTabsWithHistory(isAutoSaveEnabled ? \"自动保存\" : \"自动编译前保存\")",
    "saveOpenTabsWithHistory(source === \"auto\" ? \"自动编译前保存\" : \"编译前保存\"",
    "\"自动编译前保存\"",
    "isVersionedSaveHistoryLabel(label)",
    "label === \"手动保存\" || label === \"自动保存\"",
    "if (!isVersionedSaveHistoryLabel(label))",
    "if (isAutoSaveEnabled) {",
    "const { savedCount, recordedHistory } = await saveOpenTabsWithHistory(\"手动保存\")",
    "if (signature === previousSignature)",
    "createProjectHistorySnapshot(project.root, label)",
    "saveProjectSaveHistorySignature(project.root, signature)",
    "rememberCurrentProjectSaveSignature(",
  ]),
);

addCheck(
  "settings expose explicit auto-save and auto-compile toggles",
  includesAll(app, [
    'aria-label="自动行为设置"',
    "settings-toggles",
    "settings-toggle-row",
    "setIsAutoSaveEnabled(event.target.checked)",
    "setIsAutoCompileEnabled(event.target.checked)",
    "checked={isAutoSaveEnabled}",
    "checked={isAutoCompileEnabled}",
    "停止输入后写入磁盘",
    "保存后自动刷新 PDF",
  ]) &&
    hasCssBlock(".settings-toggles", ["display: grid;", "border-top: 1px solid #e4e9ef;"]) &&
    hasCssBlock(".settings-toggle-row", [
      "grid-template-columns: auto auto minmax(0, 1fr);",
      "border: 1px solid #d7e0e8;",
    ]) &&
    hasCssBlock(".settings-toggle-row-on", ["background: #eef8f2;", "border-color: #b7d9c4;"]),
);

addCheck(
  "manual compile from scratch clears cached build files before recompiling",
  includesAll(app, [
    "RefreshCcw",
    "handleCompileFromScratch",
    "正在清理构建缓存并从零编译",
    "await saveOpenTabsWithHistory(\"编译前保存\")",
    "await cleanProjectBuild(project.root)",
    "setCompileResult(null)",
    "setPdfRevision((value) => value + 1)",
    "await compileActiveProject(\"manual\")",
    'aria-label="从零重新编译"',
    "清理辅助文件并从零重新编译",
  ]),
);

addCheck(
  "editor tabs support keyboard close and left/right switching",
  includesAll(app, [
    "closeActiveTab",
    "switchTabByOffset",
    "closeTab(activePath)",
    "switchToTab(tabs[nextIndex])",
    "editorShortcutActionsRef.current.closeActiveTab()",
    "editorShortcutActionsRef.current.switchTab(-1)",
    "editorShortcutActionsRef.current.switchTab(1)",
    "关闭标签 (⌘W)",
  ]),
);

addCheck(
  "dirty editor tabs close through an inline save/discard confirmation",
  includesAll(app, [
    "pendingCloseTabPath",
    "pendingCloseTab",
    "handleSaveAndCloseTab",
    "editor-tab-close-confirm",
    "editor-tab-close-pending",
    "保存并关闭",
    "不保存",
    "setPendingCloseTabPath(path)",
    "closeTab(pendingCloseTab.path, { discardDirty: true })",
  ]) &&
    !app.includes("window.confirm(`${path} 还没有保存") &&
    hasCssBlock(".editor-tab-close-confirm", [
      "display: inline-flex;",
      "background: #fff8eb;",
      "border: 1px solid #dfbd70;",
    ]) &&
    hasCssBlock(".editor-tab-close-pending", ["background: #fff8eb;", "color: #6b4a0e;"]),
);

addCheck(
  "editor toolbar exposes Overleaf-style LaTeX insert actions that wrap selections",
  includesAll(app, [
    "LATEX_INSERT_ACTIONS",
    "handleLatexInsertAction",
    "editorShortcutActionsRef.current.insertLatex(\"bold\")",
    "editorShortcutActionsRef.current.insertLatex(\"italic\")",
    'className="latex-insert-toolbar"',
    "加粗选区 (⌘B)",
    "斜体选区 (⌘I)",
    "插入展示公式",
    "插入 subsection",
    "插入 enumerate",
    '"\\\\textbf{"',
    '"\\\\emph{"',
    '"\\\\[\\n"',
    '"\\\\subsection{"',
    '"\\\\begin{enumerate}',
    '"\\\\begin{figure}[t]',
    '"\\\\begin{table}[t]',
    "selection.isEmpty()",
    "editor.setSelection",
  ]) &&
    hasCssBlock(".latex-insert-toolbar", ["display: flex;", "max-width: 260px;", "overflow: auto hidden;"]) &&
    hasCssBlock(".latex-insert-button", ["flex: 0 0 30px;", "height: 30px;", "width: 30px;"]) &&
    hasCssBlock(".editor-panel-compact .latex-insert-toolbar", ["display: none;"]),
);

addCheck(
  "LaTeX editor supports Overleaf-style line comment toggling",
  includesAll(app, [
    "handleToggleLatexComment",
    "latex-studio.toggleComment",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Slash",
    "latex-toggle-comment",
    'text: "% "',
    "shouldUncomment",
    "注释/取消注释选中行 (⌘/)",
    "markActiveFileDirty(editor.getValue())",
  ]),
);

addCheck(
  "LaTeX editor can insert local TODO review comments for the sidebar and Codex context",
  includesAll(app, [
    "handleInsertTodoComment",
    "latex-insert-todo-comment",
    "描述需要修改的问题",
    "% TODO: ",
    "插入 TODO 批注",
    "保存后会出现在左侧待办批注",
    "markActiveFileDirty(editor.getValue())",
    "editor.setSelection({",
  ]) &&
    !app.includes("window.prompt(\"插入 TODO") &&
    includesAll(backend, ["parse_project_todos", "parse_todo_comment", '"TODO"']),
);

addCheck(
  "Review mode has a visible button, configurable shortcut, and editor highlights",
  includesAll(appAndPreferences, [
    '"reviewMode"',
    'reviewMode: "⌘⇧M"',
    '"insertReviewComment"',
    'insertReviewComment: "⌘⇧A"',
    "handleToggleReviewMode",
    "handleInsertReviewComment",
    "latex-studio.reviewMode",
    "latex-studio.insertReviewComment",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyM",
    "monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyA",
    "topbar-review-button",
    "topbar-review-add-button",
    "topbar-review-button-active",
    "latex-insert-review-button",
    "latex-insert-review-add-button",
    "latex-insert-button-active",
    "workspace-review",
    "editor-status-review",
    "% REVIEW: ",
    "% REVIEW-END",
    "model.getValueInRange(selection)",
    "selection.isEmpty()",
    "reviewBlockEndLine",
    "reviewEditorDecorationsForModel",
    "reviewDecorationCollectionRef",
    "review-editor-block",
    "review-editor-block-resolved",
    "review-editor-line-gutter",
    "Review 批注模式",
    "添加批注",
    "添加批注 (${shortcuts.insertReviewComment})",
    "添加 Review 批注",
    "在 Review 模式下为当前行或选中内容添加批注",
    "已为选中内容添加 REVIEW 批注高亮。",
  ]) &&
    includesAll(editorLogic, ["isReviewEndCommentText", "isReviewEndCommentLine"]) &&
    includesAll(backend, ['"review-end"', '"end-review"', "message == \"check claim\""]) &&
    hasCssBlock(".project-actions-minimal .topbar-review-button-active", [
      "background: #fff4d7;",
      "color: #8a5d0d;",
    ]) &&
    hasCssBlock(".project-actions-minimal .topbar-review-button span", ["display: inline;"]) &&
    hasCssBlock(".project-actions-minimal .topbar-review-add-button", [
      "background: #f6fbf8;",
      "color: #1f6d3d;",
    ]) &&
    hasCssBlock(".project-actions-minimal .topbar-review-add-button span", ["display: inline;"]) &&
    hasCssBlock(".workspace-review .latex-insert-toolbar", ["display: flex;"]) &&
    styles.includes(
      ".latex-insert-button:not(.latex-insert-review-button):not(.latex-insert-review-add-button)",
    ) &&
    hasCssBlock(".latex-insert-review-button", ["width: auto;", "gap: 5px;"]) &&
    hasCssBlock(".latex-insert-review-add-button", ["width: auto;", "gap: 5px;"]) &&
    hasCssBlock(".latex-insert-button-active", ["background: #fff4d7;", "color: #8a5d0d;"]) &&
    hasCssBlock(".editor-status-review", ["background: #fff4d7;", "display: inline-flex;"]) &&
    hasCssBlock(".review-editor-block", ["linear-gradient", "rgba(245, 181, 56, 0.24)"]) &&
    hasCssBlock(".review-editor-block-resolved", ["linear-gradient", "rgba(143, 154, 166, 0.16)"]) &&
    hasCssBlock(".workspace-review .todos-pane", ["display: block !important;"]),
);

addCheck(
  "LaTeX editor completes project file paths for input, graphics, and bibliography commands",
  includesAll(app, [
    "latexFileCompletionContext",
    "latexFileMatchesContext",
    "latexFileCompletionInsertText",
    "CompletionItemKind.File",
    '"includegraphics"',
    '"bibliography"',
  ]),
);

addCheck(
  "LaTeX project file paths support hover and Cmd/Ctrl-click navigation",
  includesAll(app, [
    "latexFileReferenceAtPosition(model, position, allProjectFiles)",
    "resolveLatexProjectFileReference(path, kind, projectFiles)",
    "openProjectPathFromEditor(fileReference.resolvedPath)",
    "按住 Cmd/Ctrl 点击可打开这个项目文件。",
    "未找到项目文件",
    "latexTexFileCommands",
    "latexGraphicsFileCommands",
    "latexBibliographyFileCommands",
    "candidates.push(`${path}.tex`)",
    "candidates.push(`${path}.bib`)",
    "pdf\", \"png\", \"jpg\", \"jpeg\", \"gif\", \"webp\", \"eps\", \"svg",
  ]),
);

addCheck(
  "LaTeX editor warns about unresolved project file paths",
  includesAll(app, [
    "unresolvedLatexFileReferenceMarkers(monacoApi, model, allProjectFiles)",
    "latexFileReferencesInLine(line, lineNumber, projectFiles)",
    "resolveLatexProjectFileReference(path, kind, projectFiles)",
    "isDynamicLatexFilePath(reference.path)",
    'source: "项目文件"',
    "未找到项目资源",
    "未找到 BibTeX 文件",
    "未找到 LaTeX 文件",
  ]),
);

addCheck(
  "LaTeX editor shows hover metadata for refs and citations",
  includesAll(app, [
    "registerHoverProvider",
    "latexReferenceAtPosition",
    "latexReferenceKindForCommand",
    "projectSymbols.find",
    "未找到 ${kindLabel}",
    "引用与标签",
  ]),
);

addCheck(
  "BibTeX citation completions expose author, year, and title metadata",
  includesAll(app, [
    "symbol.detail ?? \"bib\"",
    "symbol.detail ?? \"BibTeX\"",
    "symbol.detail ?? symbol.kind",
  ]) &&
    includesAll(backend, [
      "biblatex::Bibliography::parse",
      "format_bib_entry_detail",
      "format_bib_authors",
      "bib_entry_year",
      ".title()",
      "normalize_bib_field_value(&chunks.format_verbatim())",
      "Local LaTeX Studio with Codex",
    ]),
);

addCheck(
  "BibTeX entries can be created from the references sidebar and inserted as citations",
  includesAll(app, [
    "BibEntryDraft",
    "bibEntryDraft",
    "projectBibFiles",
    "defaultBibTargetFile",
    "handleStartBibEntryDraft",
    "handleSubmitBibEntryDraft",
    "sanitizeBibKey",
    "normalizeBibTargetFile",
    "buildBibEntry",
    "normalizeBibFieldValue",
    "新增 BibTeX",
    "创建后插入 citation",
    "BibTeX key ${key} 已存在",
    "新增 BibTeX ${key} 前",
    "saveFile(project.root, targetFile, nextContent)",
    "setPendingEditorInsertion({",
    "text: `\\\\cite{${key}}`",
    "project-bib-files",
    "bib-entry-form",
    "bib-entry-grid",
  ]) &&
    hasCssBlock(".symbols-toolbar", ["grid-template-columns: minmax(0, 1fr) auto;"]) &&
    hasCssBlock(".bib-entry-form", ["background: #f7fbfc;", "border: 1px solid #cddfe6;"]) &&
    hasCssBlock(".bib-entry-grid", ["grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);"]) &&
    hasCssBlock(".bib-entry-actions button[type=\"submit\"]", ["background: #e7f3ec;", "color: #21613a;"]),
);

addCheck(
  "LaTeX refs and citations support Cmd/Ctrl-click navigation to their source entries",
  includesAll(app, [
    "openSymbolFromReferenceRef",
    "editor.onMouseDown",
    "browserEvent.metaKey",
    "browserEvent.ctrlKey",
    "latexReferenceAtPosition(model, position)",
    "handleOpenSymbol(symbol)",
    "按住 Cmd/Ctrl 点击",
  ]),
);

addCheck(
  "TODO review comments are indexed, shown as local comment threads, and included in Codex context",
  includesAll(app, [
    "listProjectTodos",
    "projectTodos",
    "pendingProjectTodos",
    "resolvedProjectTodos",
    "visibleProjectTodos",
    "showResolvedTodos",
    'className={`todos-pane',
    "handleTodoClick",
    "handleAddTodoToCodex",
    "handleFixTodoWithCodex",
    "handleFixAllTodosWithCodex",
    "handleResolveTodoComment",
    "handleRestoreTodoComment",
    "rewriteLatexTodoCommentState",
    "parseLatexTodoCommentText",
    "MAX_CODEX_TODO_SOURCE_SNIPPETS",
    "TODO_SOURCE_CONTEXT_RADIUS",
    "todoSourceSnippet(item.file, await readFile(project.root, item.file), item.line)",
    "buildTodoFixPrompt",
    "buildTodoFixPrompt(project, item, sourceContext)",
    "buildTodosFixPrompt(project, unresolvedTodos, sourceContexts)",
    "codexAllowedFilesForTodos([item], allProjectFiles)",
    "codexAllowedFilesForTodos(unresolvedTodos, allProjectFiles)",
    "当前批注文件",
    "未解决批注文件",
    "Address the unresolved TODO/review comments in this LaTeX project.",
    "Codex 批量批注前保存",
    "todo-batch-codex-button",
    "让 Codex 处理全部",
    "Use the source context below as the primary editing target.",
    "Source context around the comment:",
    "Codex 批注前保存",
    "todo-filter-row",
    "todo-filter-active",
    "todo-resolved",
    'className="todo-codex-button"',
    'className="todo-context-button"',
    'className="todo-resolve-button"',
    'className="todo-restore-button"',
    "标记这条批注为完成",
    "恢复这条已解决批注",
    "RESOLVED ${parsed.kind}",
    "已完成 ${shortFileName(item.file)}:${item.line} 的批注。",
    "已恢复 ${shortFileName(item.file)}:${item.line} 的批注。",
    "Unresolved TODO/review comments",
  ]) &&
    includesAll(backend, ["list_project_todos", "parse_project_todos", "parse_todo_comment", "resolved: bool"]) &&
    hasCssBlock(".todo-list", ["max-height: 190px;", "overflow: auto;"]) &&
    hasCssBlock(".todo-filter-row", ["grid-template-columns: 1fr 1fr;", "border-radius: 7px;"]) &&
    hasCssBlock(".todo-filter-row .todo-filter-active", ["background: #ffffff;", "color: #26313d;"]) &&
    hasCssBlock(".todo-context-button", ["height: 30px;", "width: 30px;"]) &&
    hasCssBlock(".todo-codex-button", ["height: 30px;", "width: 30px;"]) &&
    hasCssBlock(".todo-batch-codex-button", ["height: 28px;", "width: 28px;"]) &&
    hasCssBlock(".todo-resolve-button", ["background: #f4fbf7;", "width: 30px;"]) &&
    hasCssBlock(".todo-restore-button", ["background: #f6f8fb;", "width: 30px;"]) &&
    hasCssBlock(".todo-item", ["grid-template-columns: minmax(0, 1fr) auto auto auto;"]) &&
    hasCssBlock(".todo-resolved", ["grid-template-columns: minmax(0, 1fr) auto;", "background: #f8fafb;"]),
);

const failed = checks.filter((check) => !check.passed);
for (const check of checks) {
  console.log(`${check.passed ? "ok" : "not ok"} - ${check.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} UI regression check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} UI regression checks passed.`);
