import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  CodexAskRequest,
  CodexAskResult,
  CodexRunRequest,
  CodexHistoryItem,
  CompileRequest,
  CompileResult,
  DiffSummary,
  EnvironmentStatus,
  FileNode,
  OutlineItem,
  ProjectAsset,
  ProjectDependency,
  ProjectFileUsage,
  ProjectOverview,
  ProjectReferenceIssue,
  ProjectSymbol,
  ProjectHistoryItem,
  ProjectSettings,
  ProjectSummary,
  RenameProjectEntryResult,
  RecentProject,
  ReplaceResult,
  SearchResult,
  SynctexLocation,
  SynctexSourceLocation,
  ProjectTodo,
  WordCountResult,
} from "./types";

export function checkEnvironment() {
  return invoke<EnvironmentStatus>("check_environment");
}

export function createProject(projectRoot: string, name?: string, template?: string) {
  return invoke<ProjectSummary>("create_project", { projectRoot, name, template });
}

export function openProject(projectRoot: string) {
  return invoke<ProjectSummary>("open_project", { projectRoot });
}

export function getProjectSettings(projectRoot: string) {
  return invoke<ProjectSettings>("get_project_settings", { projectRoot });
}

export function updateProjectSettings(projectRoot: string, settings: ProjectSettings) {
  return invoke<ProjectSummary>("update_project_settings", { projectRoot, settings });
}

export function listRecentProjects() {
  return invoke<RecentProject[]>("list_recent_projects");
}

export async function chooseProjectFolder() {
  return singleDialogPath(
    await open({
      title: "选择 LaTeX 项目文件夹",
      directory: true,
      multiple: false,
    }),
  );
}

export async function chooseProjectZip() {
  return singleDialogPath(
    await open({
      title: "选择 LaTeX 项目 ZIP",
      directory: false,
      multiple: false,
      filters: [{ name: "ZIP 项目", extensions: ["zip"] }],
    }),
  );
}

export async function chooseImportFiles() {
  const selected = await open({
    title: "选择要导入到项目的文件",
    directory: false,
    multiple: true,
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function importProjectZip(zipPath: string) {
  return invoke<ProjectSummary>("import_project_zip", { zipPath });
}

export function importProjectFiles(projectRoot: string, targetDir: string, sourcePaths: string[]) {
  return invoke<string[]>("import_project_files", { projectRoot, targetDir, sourcePaths });
}

export function listProjectFiles(projectRoot: string) {
  return invoke<FileNode[]>("list_project_files", { projectRoot });
}

export function searchProjectFiles(projectRoot: string, query: string) {
  return invoke<SearchResult[]>("search_project_files", { projectRoot, query });
}

export function replaceProjectText(projectRoot: string, query: string, replacement: string) {
  return invoke<ReplaceResult>("replace_project_text", { projectRoot, query, replacement });
}

export function countProjectWords(projectRoot: string) {
  return invoke<WordCountResult>("count_project_words", { projectRoot });
}

export function listProjectOutline(projectRoot: string) {
  return invoke<OutlineItem[]>("list_project_outline", { projectRoot });
}

export function listProjectOverview(projectRoot: string) {
  return invoke<ProjectOverview>("list_project_overview", { projectRoot });
}

export function listProjectDocumentFiles(projectRoot: string) {
  return invoke<string[]>("list_project_document_files", { projectRoot });
}

export function listProjectSymbols(projectRoot: string) {
  return invoke<ProjectSymbol[]>("list_project_symbols", { projectRoot });
}

export function listProjectTodos(projectRoot: string) {
  return invoke<ProjectTodo[]>("list_project_todos", { projectRoot });
}

export function listProjectReferenceIssues(projectRoot: string) {
  return invoke<ProjectReferenceIssue[]>("list_project_reference_issues", { projectRoot });
}

export function listProjectFileUsages(projectRoot: string, path: string) {
  return invoke<ProjectFileUsage[]>("list_project_file_usages", { projectRoot, path });
}

export function listProjectDependencies(projectRoot: string) {
  return invoke<ProjectDependency[]>("list_project_dependencies", { projectRoot });
}

export function readFile(projectRoot: string, path: string) {
  return invoke<string>("read_file", { projectRoot, path });
}

export function readProjectAssetFile(projectRoot: string, path: string) {
  return invoke<ProjectAsset>("read_project_asset_file", { projectRoot, path });
}

export function readPdfFile(projectRoot: string, pdfPath: string) {
  return invoke<number[]>("read_pdf_file", { projectRoot, pdfPath });
}

export function getExistingPdfOutput(projectRoot: string) {
  return invoke<string | null>("get_existing_pdf_output", { projectRoot });
}

export function synctexForwardSearch(
  projectRoot: string,
  sourcePath: string,
  line: number,
  column: number,
  pdfPath?: string,
) {
  return invoke<SynctexLocation>("synctex_forward_search", {
    projectRoot,
    sourcePath,
    line,
    column,
    pdfPath: pdfPath ?? null,
  });
}

export function synctexReverseSearch(
  projectRoot: string,
  page: number,
  x: number,
  y: number,
  pdfPath?: string,
) {
  return invoke<SynctexSourceLocation>("synctex_reverse_search", {
    projectRoot,
    page,
    x,
    y,
    pdfPath: pdfPath ?? null,
  });
}

export function openPdfFile(projectRoot: string, pdfPath: string) {
  return invoke<void>("open_pdf_file", { projectRoot, pdfPath });
}

export function revealPdfFile(projectRoot: string, pdfPath: string) {
  return invoke<void>("reveal_pdf_file", { projectRoot, pdfPath });
}

export async function exportPdfFile(projectRoot: string, pdfPath: string) {
  const targetPath = await save({
    title: "导出 PDF",
    defaultPath: fileNameFromPath(pdfPath) || "document.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!targetPath) return null;
  return invoke<string>("export_pdf_file", { projectRoot, pdfPath, targetPath });
}

export async function exportProjectZip(projectRoot: string) {
  const targetPath = await save({
    title: "导出项目源码 ZIP",
    defaultPath: `${sanitizeExportName(fileNameFromPath(projectRoot) || "latex-project")}.zip`,
    filters: [{ name: "ZIP 项目", extensions: ["zip"] }],
  });
  if (!targetPath) return null;
  return invoke<string>("export_project_zip", { projectRoot, targetPath });
}

export function saveFile(projectRoot: string, path: string, content: string) {
  return invoke<void>("save_file", { projectRoot, path, content });
}

export function createProjectEntry(projectRoot: string, path: string, kind: "file" | "directory") {
  return invoke<void>("create_project_entry", { projectRoot, path, kind });
}

export function renameProjectEntry(projectRoot: string, fromPath: string, toPath: string) {
  return invoke<RenameProjectEntryResult>("rename_project_entry", { projectRoot, fromPath, toPath });
}

export function deleteProjectEntry(projectRoot: string, path: string) {
  return invoke<void>("delete_project_entry", { projectRoot, path });
}

export function compileProject(request: CompileRequest) {
  return invoke<CompileResult>("compile_project", { request });
}

export function cleanProjectBuild(projectRoot: string) {
  return invoke<void>("clean_project_build", { projectRoot });
}

export function cancelCompile(projectRoot: string) {
  return invoke<boolean>("cancel_compile", { projectRoot });
}

export function runCodexEdit(request: CodexRunRequest) {
  return invoke<DiffSummary>("run_codex_edit", { request });
}

export function runCodexAsk(request: CodexAskRequest) {
  return invoke<CodexAskResult>("run_codex_ask", { request });
}

export function cancelCodexRun(projectRoot: string) {
  return invoke<boolean>("cancel_codex_run", { projectRoot });
}

export function getCodexDiff(projectRoot: string, runId: string) {
  return invoke<DiffSummary>("get_codex_diff", { projectRoot, runId });
}

export function listCodexHistory(projectRoot: string) {
  return invoke<CodexHistoryItem[]>("list_codex_history", { projectRoot });
}

export function createProjectHistorySnapshot(projectRoot: string, label: string) {
  return invoke<ProjectHistoryItem>("create_project_history_snapshot", { projectRoot, label });
}

export function listProjectHistory(projectRoot: string) {
  return invoke<ProjectHistoryItem[]>("list_project_history", { projectRoot });
}

export function getProjectHistoryDiff(projectRoot: string, snapshotId: string) {
  return invoke<DiffSummary>("get_project_history_diff", { projectRoot, snapshotId });
}

export function restoreProjectHistorySnapshot(projectRoot: string, snapshotId: string) {
  return invoke<ProjectSummary>("restore_project_history_snapshot", { projectRoot, snapshotId });
}

export function revertCodexRun(projectRoot: string, runId: string) {
  return invoke<void>("revert_codex_run", { projectRoot, runId });
}

export function revertCodexFile(projectRoot: string, runId: string, path: string) {
  return invoke<DiffSummary>("revert_codex_file", { projectRoot, runId, path });
}

function singleDialogPath(value: string | string[] | null) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function fileNameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}

function sanitizeExportName(name: string) {
  const sanitized = name
    .split("")
    .map((character) => (/^[A-Za-z0-9._-]$/.test(character) ? character : "-"))
    .join("")
    .replace(/^-+|-+$/g, "");
  return sanitized || "latex-project";
}
