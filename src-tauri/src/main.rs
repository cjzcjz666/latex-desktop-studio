use biblatex::ChunksExt;
use serde::{Deserialize, Serialize};
use similar::TextDiff;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

static ACTIVE_COMPILES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static ACTIVE_CODEX_RUNS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
const CODEX_RUN_TIMEOUT_SECS: u64 = 10 * 60;
const CODEX_STILL_RUNNING_NOTICE_SECS: u64 = 30;
const CODEX_CANCEL_GRACE_SECS: u64 = 2;
const CODEX_WAIT_POLL_MS: u64 = 100;
const MAX_ASSET_PREVIEW_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    name: String,
    found: bool,
    path: Option<String>,
    version: Option<String>,
    install_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    latexmk: ToolStatus,
    xelatex: ToolStatus,
    pdflatex: ToolStatus,
    lualatex: ToolStatus,
    codex: ToolStatus,
    can_compile: bool,
    can_run_codex: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    name: String,
    root: String,
    main_file: String,
    settings_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecentProject {
    name: String,
    root: String,
    main_file: String,
    last_opened: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    kind: FileKind,
    size: Option<u64>,
    children: Option<Vec<FileNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RenameProjectEntryResult {
    updated_references: u32,
    updated_reference_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectAsset {
    path: String,
    mime_type: String,
    bytes: Vec<u8>,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    file: String,
    line: u32,
    column: u32,
    preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReplaceFileResult {
    file: String,
    replacements: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReplaceResult {
    replacements: u32,
    files: Vec<ReplaceFileResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WordCountFile {
    file: String,
    words: u32,
    characters: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WordCountResult {
    words: u32,
    characters: u32,
    files: Vec<WordCountFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutlineItem {
    kind: String,
    title: String,
    file: String,
    line: u32,
    level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectOverview {
    title: Option<String>,
    author: Option<String>,
    date: Option<String>,
    abstract_text: Option<String>,
    keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectSymbol {
    kind: String,
    key: String,
    detail: Option<String>,
    file: String,
    line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectTodo {
    kind: String,
    message: String,
    file: String,
    line: u32,
    resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectReferenceIssue {
    kind: String,
    key: String,
    file: String,
    line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectFileUsage {
    file: String,
    line: u32,
    command: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectDependency {
    source_file: String,
    line: u32,
    command: String,
    kind: String,
    target: String,
    resolved_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SynctexLocation {
    page: u32,
    x: f64,
    y: f64,
    h: f64,
    v: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SynctexSourceLocation {
    file: String,
    line: u32,
    column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum FileKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    severity: DiagnosticSeverity,
    file: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    message: String,
    hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileRequest {
    project_root: String,
    main_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileResult {
    success: bool,
    pdf_path: Option<String>,
    log: String,
    diagnostics: Vec<Diagnostic>,
    command: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileEvent {
    kind: String,
    message: String,
    result: Option<CompileResult>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRunRequest {
    project_root: String,
    prompt: String,
    auto_compile: Option<bool>,
    #[serde(default)]
    allowed_files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAskRequest {
    project_root: String,
    prompt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexRunEvent {
    kind: String,
    run_id: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CodexAskResult {
    response: String,
    command: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DiffSummary {
    run_id: String,
    changed_files: Vec<String>,
    unified_diff: String,
    can_revert: bool,
    #[serde(default)]
    scope_reverted_files: Vec<String>,
    #[serde(default)]
    prompt_preview: Option<String>,
    #[serde(default)]
    final_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CodexHistoryItem {
    run_id: String,
    changed_files: Vec<String>,
    can_revert: bool,
    created_at: u64,
    #[serde(default)]
    prompt_preview: Option<String>,
    #[serde(default)]
    final_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectHistoryItem {
    snapshot_id: String,
    label: String,
    created_at: u64,
    file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectHistoryManifest {
    snapshot_id: String,
    label: String,
    created_at: u64,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProjectSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    main_file: String,
    engine: String,
    build_dir: String,
    #[serde(default)]
    compile_args: Vec<String>,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            display_name: None,
            main_file: "main.tex".to_string(),
            engine: "xelatex".to_string(),
            build_dir: ".latex-studio/build".to_string(),
            compile_args: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifest {
    run_id: String,
    files: Vec<String>,
}

#[tauri::command]
fn check_environment() -> EnvironmentStatus {
    let latexmk = tool_status(
        "latexmk",
        &["-v"],
        &[
            "/Library/TeX/texbin/latexmk",
            "/usr/local/texlive/2026/bin/universal-darwin/latexmk",
        ],
        Some("请安装 MacTeX 或 BasicTeX，并确认 latexmk 已加入 PATH。"),
    );
    let xelatex = tool_status(
        "xelatex",
        &["--version"],
        &[
            "/Library/TeX/texbin/xelatex",
            "/usr/local/texlive/2026/bin/universal-darwin/xelatex",
        ],
        Some("请安装 MacTeX 或 BasicTeX，并确认 xelatex 已加入 PATH。"),
    );
    let pdflatex = tool_status(
        "pdflatex",
        &["--version"],
        &[
            "/Library/TeX/texbin/pdflatex",
            "/usr/local/texlive/2026/bin/universal-darwin/pdflatex",
        ],
        Some("请安装 MacTeX 或 BasicTeX，并确认 pdflatex 已加入 PATH。"),
    );
    let lualatex = tool_status(
        "lualatex",
        &["--version"],
        &[
            "/Library/TeX/texbin/lualatex",
            "/usr/local/texlive/2026/bin/universal-darwin/lualatex",
        ],
        Some("请安装 MacTeX 或 BasicTeX，并确认 lualatex 已加入 PATH。"),
    );
    let codex = tool_status(
        "codex",
        &["--version"],
        &["/Applications/Codex.app/Contents/Resources/codex"],
        Some("请安装并登录 Codex Desktop，确保本地 codex CLI 可用。"),
    );

    EnvironmentStatus {
        can_compile: latexmk.found && (xelatex.found || pdflatex.found || lualatex.found),
        can_run_codex: codex.found,
        latexmk,
        xelatex,
        pdflatex,
        lualatex,
        codex,
    }
}

#[tauri::command]
fn create_project(
    project_root: String,
    name: Option<String>,
    template: Option<String>,
) -> Result<ProjectSummary, String> {
    let root = project_path_for_create(&project_root)?;
    fs::create_dir_all(&root)
        .map_err(|err| format!("failed to create project directory: {err}"))?;
    let root = canonicalize_existing_dir(&root)?;
    let project_name = name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("LaTeX Project")
                .to_string()
        });

    let template = normalized_project_template(template.as_deref())?;
    let mut settings = ProjectSettings::default();
    if !project_name.trim().is_empty() {
        settings.display_name = Some(project_name.trim().to_string());
    }
    let settings_path = root.join(".latex-studio.json");
    if !settings_path.exists() {
        write_json(&settings_path, &settings)?;
    }

    let main_path = root.join(&settings.main_file);
    if !main_path.exists() {
        fs::write(&main_path, template_main_tex(template, &project_name))
            .map_err(|err| format!("failed to write main.tex: {err}"))?;
    }

    if let Some(bibtex) = template_bibtex(template) {
        let bib_path = root.join("references.bib");
        if !bib_path.exists() {
            fs::write(&bib_path, bibtex)
                .map_err(|err| format!("failed to write references.bib: {err}"))?;
        }
    }

    for (relative, content) in template_extra_files(template) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create template directory: {err}"))?;
        }
        if !path.exists() {
            fs::write(&path, content)
                .map_err(|err| format!("failed to write template file {relative}: {err}"))?;
        }
    }

    fs::create_dir_all(root.join("assets"))
        .map_err(|err| format!("failed to create assets directory: {err}"))?;
    fs::create_dir_all(root.join(".latex-studio/build"))
        .map_err(|err| format!("failed to create build directory: {err}"))?;

    let summary = project_summary(&root)?;
    let _ = remember_recent_project(&summary);
    Ok(summary)
}

#[tauri::command]
fn open_project(project_root: String) -> Result<ProjectSummary, String> {
    let root = canonicalize_existing_dir(expand_user_path(&project_root)?)?;
    let settings_path = root.join(".latex-studio.json");
    let mut settings = load_settings(&root).unwrap_or_default();
    let settings_missing = !settings_path.exists();
    let mut changed = settings_missing;
    let magic = detect_tex_magic_settings(&root)?;

    if settings_missing {
        if let Some(detected) = magic.main_file.clone() {
            settings.main_file = detected;
        }
        if let Some(engine) = magic.engine.clone() {
            settings.engine = engine;
        }
    }

    if !project_main_file_is_valid(&root, &settings) {
        if let Some(detected) = magic.main_file.clone().or(detect_project_main_file(&root)?) {
            settings.main_file = detected;
        } else {
            settings.main_file = ProjectSettings::default().main_file;
            let project_name = root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("LaTeX Project");
            fs::write(
                root.join(&settings.main_file),
                template_main_tex("article", project_name),
            )
            .map_err(|err| format!("failed to create default main.tex: {err}"))?;
        }
        changed = true;
    }

    if normalized_engine(&settings.engine).is_err() {
        settings.engine = ProjectSettings::default().engine;
        changed = true;
    }

    let build_relative = Path::new(&settings.build_dir);
    if settings.build_dir.trim().is_empty()
        || reject_unsafe_relative_path(build_relative).is_err()
        || normalize_relative_path(build_relative).is_empty()
    {
        settings.build_dir = ProjectSettings::default().build_dir;
        changed = true;
    }

    if changed {
        write_json(&settings_path, &settings)?;
    }
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    fs::create_dir_all(&build_dir)
        .map_err(|err| format!("failed to create build directory: {err}"))?;
    let summary = project_summary(&root)?;
    let _ = remember_recent_project(&summary);
    Ok(summary)
}

#[tauri::command]
fn get_project_settings(project_root: String) -> Result<ProjectSettings, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    Ok(load_settings(&root).unwrap_or_default())
}

#[tauri::command]
fn update_project_settings(
    project_root: String,
    mut settings: ProjectSettings,
) -> Result<ProjectSummary, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    settings.display_name = settings
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    validate_project_settings(&root, &settings)?;
    let settings_path = root.join(".latex-studio.json");
    write_json(&settings_path, &settings)?;
    let summary = project_summary(&root)?;
    let _ = remember_recent_project(&summary);
    Ok(summary)
}

#[tauri::command]
fn list_recent_projects() -> Result<Vec<RecentProject>, String> {
    let mut projects = load_recent_projects()?;
    projects.retain(|project| Path::new(&project.root).is_dir());
    projects.sort_by(|left, right| right.last_opened.cmp(&left.last_opened));
    Ok(projects)
}

#[tauri::command]
fn import_project_zip(zip_path: String) -> Result<ProjectSummary, String> {
    let source = fs::canonicalize(expand_user_path(&zip_path)?)
        .map_err(|err| format!("无法读取 ZIP 文件 {}：{err}", zip_path))?;
    if !source.is_file() {
        return Err(format!("{} 不是文件。", source.to_string_lossy()));
    }
    if source.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("请选择 .zip 项目压缩包。".to_string());
    }
    let target_root = project_path_for_import_zip(&source)?;
    import_project_zip_to_root(&source, &target_root)?;
    open_project(target_root.to_string_lossy().to_string())
}

#[tauri::command]
fn import_project_files(
    project_root: String,
    target_dir: String,
    source_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let target_relative = if target_dir.trim().is_empty() {
        PathBuf::new()
    } else {
        PathBuf::from(target_dir.trim())
    };
    if !target_relative.as_os_str().is_empty() {
        reject_reserved_project_path(&target_relative)?;
    }
    let target_root = resolve_project_directory_for_write(&root, &target_relative)?;
    fs::create_dir_all(&target_root)
        .map_err(|err| format!("failed to create import target directory: {err}"))?;

    let mut imported = Vec::new();
    for source in source_paths {
        let source_path = fs::canonicalize(&source)
            .map_err(|err| format!("无法读取要导入的文件 {}：{err}", source))?;
        if !source_path.is_file() {
            return Err(format!("{} 不是文件。", source_path.to_string_lossy()));
        }
        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("无法识别文件名：{}", source_path.to_string_lossy()))?;
        let mut target = target_root.join(file_name);
        target = next_available_import_path(&target);
        fs::copy(&source_path, &target).map_err(|err| {
            format!(
                "failed to import {} to {}: {err}",
                source_path.to_string_lossy(),
                target.to_string_lossy()
            )
        })?;
        imported.push(relative_slash(&root, &target)?);
    }
    imported.sort();
    Ok(imported)
}

#[tauri::command]
fn list_project_files(project_root: String) -> Result<Vec<FileNode>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let mut nodes = Vec::new();
    let entries = sorted_read_dir(&root)?;
    for entry in entries {
        if should_skip_dir_entry(&entry) {
            continue;
        }
        nodes.push(file_node(&root, &entry.path())?);
    }
    Ok(nodes)
}

#[tauri::command]
fn search_project_files(project_root: String, query: String) -> Result<Vec<SearchResult>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let needle_lower = needle.to_lowercase();
    let mut results = Vec::new();
    for relative in collect_project_files(&root)? {
        if is_internal_project_metadata_path(&relative) || !is_searchable_text_path(&relative) {
            continue;
        }
        let path = resolve_project_file_existing(&root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for (line_index, line) in content.lines().enumerate() {
            let line_lower = line.to_lowercase();
            let Some(column_index) = line_lower.find(&needle_lower) else {
                continue;
            };
            results.push(SearchResult {
                file: relative.clone(),
                line: (line_index + 1) as u32,
                column: (column_index + 1) as u32,
                preview: line.trim().chars().take(180).collect(),
            });
            if results.len() >= 200 {
                return Ok(results);
            }
        }
    }
    Ok(results)
}

#[tauri::command]
fn replace_project_text(
    project_root: String,
    query: String,
    replacement: String,
) -> Result<ReplaceResult, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    replace_project_text_in_root(&root, &query, &replacement)
}

#[tauri::command]
fn count_project_words(project_root: String) -> Result<WordCountResult, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    count_project_words_in_root(&root)
}

#[tauri::command]
fn list_project_outline(project_root: String) -> Result<Vec<OutlineItem>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    let files = tex_project_files_in_document_order(&root, &settings)?;

    let mut outline = Vec::new();
    for relative in files {
        let path = resolve_project_file_existing(&root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        outline.extend(parse_tex_outline(&relative, &content));
        if outline.len() >= 500 {
            outline.truncate(500);
            break;
        }
    }
    Ok(outline)
}

#[tauri::command]
fn list_project_overview(project_root: String) -> Result<ProjectOverview, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    let files = tex_project_files_in_document_order(&root, &settings)?;

    let mut overview = ProjectOverview::default();
    for relative in files {
        let path = resolve_project_file_existing(&root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        merge_project_overview(&mut overview, parse_tex_overview(&content));
        if overview_has_core_context(&overview) {
            break;
        }
    }
    Ok(overview)
}

#[tauri::command]
fn list_project_document_files(project_root: String) -> Result<Vec<String>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    tex_project_files_in_document_order(&root, &settings)
}

#[tauri::command]
fn list_project_symbols(project_root: String) -> Result<Vec<ProjectSymbol>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let mut symbols = Vec::new();
    for relative in collect_project_files(&root)? {
        let extension = Path::new(&relative)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !matches!(extension, "tex" | "bib") {
            continue;
        }
        let path = resolve_project_file_existing(&root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        if extension == "tex" {
            symbols.extend(parse_tex_symbols(&relative, &content));
        } else {
            symbols.extend(parse_bib_symbols(&relative, &content));
        }
        if symbols.len() >= 1000 {
            symbols.truncate(1000);
            break;
        }
    }
    symbols.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.key.cmp(&right.key))
            .then_with(|| left.file.cmp(&right.file))
            .then_with(|| left.line.cmp(&right.line))
    });
    symbols.dedup_by(|left, right| left.kind == right.kind && left.key == right.key);
    Ok(symbols)
}

#[tauri::command]
fn list_project_todos(project_root: String) -> Result<Vec<ProjectTodo>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    let mut files = collect_project_files(&root)?
        .into_iter()
        .filter(|relative| is_todo_indexed_path(relative))
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        let left_rank = if left == &settings.main_file { 0 } else { 1 };
        let right_rank = if right == &settings.main_file { 0 } else { 1 };
        left_rank.cmp(&right_rank).then_with(|| left.cmp(right))
    });

    let mut todos = Vec::new();
    for relative in files {
        let path = resolve_project_file_existing(&root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        todos.extend(parse_project_todos(&relative, &content));
        if todos.len() >= 500 {
            todos.truncate(500);
            break;
        }
    }
    Ok(todos)
}

#[tauri::command]
fn list_project_reference_issues(
    project_root: String,
) -> Result<Vec<ProjectReferenceIssue>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    list_project_reference_issues_in_root(&root)
}

#[tauri::command]
fn list_project_file_usages(
    project_root: String,
    path: String,
) -> Result<Vec<ProjectFileUsage>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    list_project_file_usages_in_root(&root, &path)
}

#[tauri::command]
fn list_project_dependencies(project_root: String) -> Result<Vec<ProjectDependency>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    list_project_dependencies_in_root(&root)
}

#[tauri::command]
fn read_file(project_root: String, path: String) -> Result<String, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let file_path = resolve_project_file_existing(&root, Path::new(&path))?;
    fs::read_to_string(&file_path)
        .map_err(|err| format!("failed to read {} as UTF-8 text: {err}", path))
}

#[tauri::command]
fn read_project_asset_file(project_root: String, path: String) -> Result<ProjectAsset, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let raw_relative = Path::new(&path);
    reject_unsafe_relative_path(raw_relative)?;
    let relative = normalize_relative_path(raw_relative);
    if relative.is_empty() {
        return Err("资源路径不能为空。".to_string());
    }
    let mime_type = asset_mime_for_path(Path::new(&relative))
        .ok_or_else(|| format!("{relative} 暂不支持内置预览。"))?;
    let file_path = resolve_project_file_existing(&root, Path::new(&relative))?;
    if !file_path.is_file() {
        return Err("只能预览文件资源。".to_string());
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|err| format!("无法读取资源文件 {}：{err}", file_path.to_string_lossy()))?;
    if metadata.len() > MAX_ASSET_PREVIEW_BYTES {
        return Err(format!(
            "资源文件过大，暂不内置预览超过 {} MB 的文件。",
            MAX_ASSET_PREVIEW_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&file_path)
        .map_err(|err| format!("无法读取资源文件 {}：{err}", file_path.to_string_lossy()))?;
    Ok(ProjectAsset {
        path: relative,
        mime_type: mime_type.to_string(),
        size: metadata.len(),
        bytes,
    })
}

#[tauri::command]
fn read_pdf_file(project_root: String, pdf_path: String) -> Result<Vec<u8>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let path = resolve_project_pdf_existing(&root, &pdf_path)?;
    fs::read(&path).map_err(|err| format!("无法读取 PDF 文件 {}：{err}", path.to_string_lossy()))
}

#[tauri::command]
fn get_existing_pdf_output(project_root: String) -> Result<Option<String>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    if !project_main_file_is_valid(&root, &settings) {
        return Ok(None);
    }
    let main_path = resolve_project_file_existing(&root, Path::new(&settings.main_file))?;
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    let pdf_path = expected_pdf_path(&build_dir, &main_path);
    if pdf_path.is_file() {
        ensure_under_root(&root, &pdf_path)?;
        Ok(Some(pdf_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn synctex_forward_search(
    project_root: String,
    source_path: String,
    line: u32,
    column: Option<u32>,
    pdf_path: Option<String>,
) -> Result<SynctexLocation, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    if line == 0 {
        return Err("源码行号必须大于 0。".to_string());
    }

    let source_relative = Path::new(&source_path);
    let source_abs = resolve_project_file_existing(&root, source_relative)?;
    let settings = load_settings(&root).unwrap_or_default();
    validate_project_settings(&root, &settings)?;
    let main_path = resolve_project_file_existing(&root, Path::new(&settings.main_file))?;
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    let pdf_path = match pdf_path.filter(|value| !value.trim().is_empty()) {
        Some(path) => resolve_project_pdf_existing(&root, &path)?,
        None => expected_pdf_path(&build_dir, &main_path),
    };
    ensure_under_root(&root, &pdf_path)?;
    if !pdf_path.is_file() {
        return Err("还没有可定位的 PDF。请先成功编译一次项目。".to_string());
    }
    if !build_dir.is_dir()
        || !expected_synctex_paths(&build_dir, &main_path)
            .iter()
            .any(|path| path.is_file())
    {
        return Err("未找到 SyncTeX 索引。请重新编译项目后再定位 PDF。".to_string());
    }

    let synctex =
        find_executable("synctex", &["/Library/TeX/texbin/synctex"]).ok_or_else(|| {
            "未找到 synctex。请安装 MacTeX 或 BasicTeX，并确认 synctex 已加入 PATH。".to_string()
        })?;

    let normalized_source = normalize_relative_path(source_relative);
    let mut input_candidates = vec![normalized_source.clone()];
    let absolute_source = source_abs.to_string_lossy().to_string();
    if absolute_source != normalized_source {
        input_candidates.push(absolute_source);
    }

    let mut last_error = String::new();
    for input_path in input_candidates {
        match run_synctex_view(
            &synctex,
            &build_dir,
            &pdf_path,
            line,
            column.unwrap_or(1),
            &input_path,
        ) {
            Ok(location) => return Ok(location),
            Err(err) => last_error = err,
        }
    }

    Err(if last_error.is_empty() {
        "SyncTeX 没有找到当前源码位置对应的 PDF 区域。".to_string()
    } else {
        last_error
    })
}

#[tauri::command]
fn synctex_reverse_search(
    project_root: String,
    page: u32,
    x: f64,
    y: f64,
    pdf_path: Option<String>,
) -> Result<SynctexSourceLocation, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    if page == 0 || !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
        return Err("PDF 定位坐标无效。".to_string());
    }

    let settings = load_settings(&root).unwrap_or_default();
    validate_project_settings(&root, &settings)?;
    let main_path = resolve_project_file_existing(&root, Path::new(&settings.main_file))?;
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    let pdf_path = match pdf_path.filter(|value| !value.trim().is_empty()) {
        Some(path) => resolve_project_pdf_existing(&root, &path)?,
        None => expected_pdf_path(&build_dir, &main_path),
    };
    ensure_under_root(&root, &pdf_path)?;
    if !pdf_path.is_file() {
        return Err("还没有可反向定位的 PDF。请先成功编译一次项目。".to_string());
    }
    if !build_dir.is_dir()
        || !expected_synctex_paths(&build_dir, &main_path)
            .iter()
            .any(|path| path.is_file())
    {
        return Err("未找到 SyncTeX 索引。请重新编译项目后再从 PDF 定位源码。".to_string());
    }

    let synctex =
        find_executable("synctex", &["/Library/TeX/texbin/synctex"]).ok_or_else(|| {
            "未找到 synctex。请安装 MacTeX 或 BasicTeX，并确认 synctex 已加入 PATH。".to_string()
        })?;
    let raw_location = run_synctex_edit(&synctex, &build_dir, &pdf_path, page, x, y)?;
    let source_path = canonicalize_synctex_input(&root, &raw_location.file)?;
    Ok(SynctexSourceLocation {
        file: relative_slash(&root, &source_path)?,
        line: raw_location.line.max(1),
        column: raw_location.column,
    })
}

#[tauri::command]
fn open_pdf_file(project_root: String, pdf_path: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let path = resolve_project_pdf_existing(&root, &pdf_path)?;
    open_path_with_system(&path, false)
}

#[tauri::command]
fn reveal_pdf_file(project_root: String, pdf_path: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let path = resolve_project_pdf_existing(&root, &pdf_path)?;
    open_path_with_system(&path, true)
}

#[tauri::command]
fn export_pdf_file(
    project_root: String,
    pdf_path: String,
    target_path: String,
) -> Result<String, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let path = resolve_project_pdf_existing(&root, &pdf_path)?;
    let target = expand_user_path(&target_path)?;
    let target = with_extension_if_missing(target, "pdf");
    copy_pdf_export(&path, &target)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn export_project_zip(project_root: String, target_path: String) -> Result<String, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    validate_project_settings(&root, &settings)?;
    let target = expand_user_path(&target_path)?;
    let target = with_extension_if_missing(target, "zip");
    export_project_zip_to_path(&root, &settings, &target)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn save_file(project_root: String, path: String, content: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let file_path = resolve_project_file_for_write(&root, Path::new(&path))?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create parent directory: {err}"))?;
    }
    fs::write(&file_path, content).map_err(|err| format!("failed to write {path}: {err}"))
}

#[tauri::command]
fn create_project_entry(project_root: String, path: String, kind: FileKind) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let relative = Path::new(&path);
    reject_reserved_project_path(relative)?;
    let target = resolve_project_file_for_write(&root, relative)?;
    if target.exists() {
        return Err(format!("{} 已存在。", path));
    }

    match kind {
        FileKind::Directory => fs::create_dir_all(&target)
            .map_err(|err| format!("failed to create directory {}: {err}", path)),
        FileKind::File => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("failed to create parent directory: {err}"))?;
            }
            fs::write(&target, default_new_file_content(&path))
                .map_err(|err| format!("failed to create file {}: {err}", path))
        }
    }
}

#[tauri::command]
fn rename_project_entry(
    project_root: String,
    from_path: String,
    to_path: String,
) -> Result<RenameProjectEntryResult, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let from_relative = Path::new(&from_path);
    let to_relative = Path::new(&to_path);
    reject_reserved_project_path(from_relative)?;
    reject_reserved_project_path(to_relative)?;
    let normalized_from = normalize_relative_path(from_relative);
    let normalized_to = normalize_relative_path(to_relative);
    let mut settings = load_settings(&root).unwrap_or_default();
    let next_main_file =
        remap_relative_path_after_rename(&settings.main_file, &normalized_from, &normalized_to);
    let should_update_main_file = next_main_file != settings.main_file;
    if should_update_main_file && !next_main_file.to_lowercase().ends_with(".tex") {
        return Err("主文件重命名后仍需要是 .tex 文件。".to_string());
    }

    let source = resolve_project_file_existing(&root, from_relative)?;
    let target = resolve_project_file_for_write(&root, to_relative)?;
    if target.exists() {
        return Err(format!("{} 已存在。", to_path));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create parent directory: {err}"))?;
    }
    fs::rename(&source, &target).map_err(|err| format!("failed to rename {}: {err}", from_path))?;
    if should_update_main_file {
        settings.main_file = next_main_file;
        write_json(&root.join(".latex-studio.json"), &settings)?;
    }
    Ok(rewrite_latex_file_references_after_rename(
        &root,
        &normalized_from,
        &normalized_to,
    ))
}

#[tauri::command]
fn delete_project_entry(project_root: String, path: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let relative = Path::new(&path);
    reject_reserved_project_path(relative)?;
    reject_main_file_operation(&root, relative, "删除")?;
    let target = resolve_project_file_existing(&root, relative)?;
    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|err| format!("failed to delete directory {}: {err}", path))
    } else {
        fs::remove_file(&target).map_err(|err| format!("failed to delete file {}: {err}", path))
    }
}

#[tauri::command]
async fn compile_project(app: AppHandle, request: CompileRequest) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_latex_compile(Some(&app), request, None))
        .await
        .map_err(|err| format!("compile task failed: {err}"))?
}

#[tauri::command]
fn clean_project_build(project_root: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    validate_project_settings(&root, &settings)?;
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    if build_dir.exists() {
        if !build_dir.is_dir() {
            return Err("构建目录不是文件夹，不能清理。".to_string());
        }
        fs::remove_dir_all(&build_dir)
            .map_err(|err| format!("failed to clean build directory: {err}"))?;
    }
    fs::create_dir_all(&build_dir)
        .map_err(|err| format!("failed to recreate build directory: {err}"))?;
    Ok(())
}

#[tauri::command]
fn cancel_compile(project_root: String) -> Result<bool, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let key = path_key(&root);
    let maybe_pid = active_compiles().lock().unwrap().remove(&key);
    if let Some(pid) = maybe_pid {
        #[cfg(unix)]
        {
            let status = Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .status()
                .map_err(|err| format!("failed to send terminate signal: {err}"))?;
            return Ok(status.success());
        }

        #[cfg(not(unix))]
        {
            return Ok(false);
        }
    }
    Ok(false)
}

#[tauri::command]
async fn run_codex_edit(app: AppHandle, request: CodexRunRequest) -> Result<DiffSummary, String> {
    tauri::async_runtime::spawn_blocking(move || run_codex_edit_blocking(app, request))
        .await
        .map_err(|err| format!("Codex task failed: {err}"))?
}

#[tauri::command]
async fn run_codex_ask(app: AppHandle, request: CodexAskRequest) -> Result<CodexAskResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_codex_ask_blocking(app, request))
        .await
        .map_err(|err| format!("Codex ask task failed: {err}"))?
}

#[tauri::command]
fn cancel_codex_run(project_root: String) -> Result<bool, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let key = path_key(&root);
    let maybe_pid = active_codex_runs().lock().unwrap().remove(&key);
    if let Some(pid) = maybe_pid {
        #[cfg(unix)]
        {
            let status = Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .status()
                .map_err(|err| format!("failed to send terminate signal: {err}"))?;
            return Ok(status.success());
        }

        #[cfg(not(unix))]
        {
            return Ok(false);
        }
    }
    Ok(false)
}

#[tauri::command]
fn get_codex_diff(project_root: String, run_id: String) -> Result<DiffSummary, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    let saved_summary = load_saved_diff_summary(&root, &run_id);
    let mut summary = diff_snapshot(&root, &run_id)?;
    if let Some(saved_summary) = saved_summary {
        summary.prompt_preview = saved_summary.prompt_preview;
        summary.final_message = saved_summary.final_message;
    }
    save_diff_summary(&root, &summary)?;
    Ok(summary)
}

#[tauri::command]
fn list_codex_history(project_root: String) -> Result<Vec<CodexHistoryItem>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    list_codex_history_items(&root)
}

#[tauri::command]
fn create_project_history_snapshot(
    project_root: String,
    label: String,
) -> Result<ProjectHistoryItem, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    create_project_history_snapshot_in_root(&root, label.trim())
}

#[tauri::command]
fn list_project_history(project_root: String) -> Result<Vec<ProjectHistoryItem>, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    list_project_history_items(&root)
}

#[tauri::command]
fn get_project_history_diff(
    project_root: String,
    snapshot_id: String,
) -> Result<DiffSummary, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    diff_project_history_snapshot(&root, &snapshot_id)
}

#[tauri::command]
fn restore_project_history_snapshot(
    project_root: String,
    snapshot_id: String,
) -> Result<ProjectSummary, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    restore_project_history_snapshot_in_root(&root, &snapshot_id)?;
    let summary = project_summary(&root)?;
    let _ = remember_recent_project(&summary);
    Ok(summary)
}

#[tauri::command]
fn revert_codex_run(project_root: String, run_id: String) -> Result<(), String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    revert_snapshot(&root, &run_id)
}

#[tauri::command]
fn revert_codex_file(
    project_root: String,
    run_id: String,
    path: String,
) -> Result<DiffSummary, String> {
    let root = canonicalize_existing_dir(PathBuf::from(project_root))?;
    revert_snapshot_file(&root, &run_id, &path)
}

fn run_codex_edit_blocking(
    app: AppHandle,
    request: CodexRunRequest,
) -> Result<DiffSummary, String> {
    run_codex_edit_blocking_with_tools(Some(app), request, None, None)
}

fn run_codex_ask_blocking(
    app: AppHandle,
    request: CodexAskRequest,
) -> Result<CodexAskResult, String> {
    run_codex_ask_blocking_with_tool(Some(app), request, None)
}

fn run_codex_ask_blocking_with_tool(
    app: Option<AppHandle>,
    request: CodexAskRequest,
    codex_override: Option<PathBuf>,
) -> Result<CodexAskResult, String> {
    if request.prompt.trim().is_empty() {
        return Err("Codex 问题不能为空。".to_string());
    }

    let root = canonicalize_existing_dir(PathBuf::from(&request.project_root))?;
    let codex = codex_override
        .or_else(|| {
            find_executable(
                "codex",
                &["/Applications/Codex.app/Contents/Resources/codex"],
            )
        })
        .ok_or_else(|| "未找到 codex CLI。请先安装并登录 Codex Desktop。".to_string())?;
    let run_id = Uuid::new_v4().to_string();
    emit_codex_event(
        app.as_ref(),
        "started",
        Some(&run_id),
        "Codex 正在只读分析当前 LaTeX 项目。",
    );

    let prompt = guarded_codex_ask_prompt(&request.prompt);
    let last_message_path = codex_last_message_temp_path(&run_id);
    let args = build_codex_ask_args(&root, &prompt, &last_message_path);
    let mut child = Command::new(&codex)
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start codex: {err}"))?;
    let key = path_key(&root);
    active_codex_runs()
        .lock()
        .unwrap()
        .insert(key.clone(), child.id());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture codex stderr".to_string())?;

    let stdout_app = app.clone();
    let stdout_run_id = run_id.clone();
    let stdout_thread = std::thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stdout).lines().flatten() {
            output.push_str(&line);
            output.push('\n');
            if let Some((kind, message)) = humanize_codex_output_line(&line, false) {
                emit_codex_event(stdout_app.as_ref(), &kind, Some(&stdout_run_id), &message);
            }
        }
        output
    });

    let stderr_app = app.clone();
    let stderr_run_id = run_id.clone();
    let stderr_thread = std::thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stderr).lines().flatten() {
            output.push_str(&line);
            output.push('\n');
            if let Some((kind, message)) = humanize_codex_output_line(&line, true) {
                emit_codex_event(stderr_app.as_ref(), &kind, Some(&stderr_run_id), &message);
            }
        }
        output
    });

    let wait_result = wait_for_codex_child(&mut child, &key, app.as_ref(), &run_id)?;
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    let (status, was_cancelled) = match wait_result {
        CodexWaitResult::Finished {
            status,
            was_cancelled,
        } => (status, was_cancelled),
        CodexWaitResult::TimedOut => {
            cleanup_codex_last_message(&last_message_path);
            return Err(format!(
                "Codex 运行超过 {}，已自动终止。",
                human_duration(Duration::from_secs(CODEX_RUN_TIMEOUT_SECS))
            ));
        }
    };

    if !status.success() {
        cleanup_codex_last_message(&last_message_path);
        if was_cancelled {
            emit_codex_event(app.as_ref(), "error", Some(&run_id), "Codex 已取消。");
            return Err("Codex 已取消。".to_string());
        }
        emit_codex_event(app.as_ref(), "error", Some(&run_id), "Codex 只读分析失败。");
        return Err(format!(
            "codex exited with status {}{}",
            status,
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ));
    }

    let response = read_codex_last_message(&last_message_path)
        .unwrap_or_else(|| extract_codex_answer(&stdout));
    cleanup_codex_last_message(&last_message_path);
    if !response.trim().is_empty() {
        emit_codex_event(app.as_ref(), "assistant", Some(&run_id), &response);
    }
    emit_codex_event(app.as_ref(), "completed", Some(&run_id), "Codex 分析完成。");
    Ok(CodexAskResult {
        response,
        command: {
            let mut command = vec![codex.to_string_lossy().to_string()];
            command.extend(args);
            command
        },
    })
}

fn run_codex_edit_blocking_with_tools(
    app: Option<AppHandle>,
    request: CodexRunRequest,
    codex_override: Option<PathBuf>,
    latexmk_override: Option<PathBuf>,
) -> Result<DiffSummary, String> {
    if request.prompt.trim().is_empty() {
        return Err("Codex 指令不能为空。".to_string());
    }

    let root = canonicalize_existing_dir(PathBuf::from(&request.project_root))?;
    let allowed_files = normalize_codex_allowed_files(&root, request.allowed_files.as_ref())?;
    let codex = codex_override
        .or_else(|| {
            find_executable(
                "codex",
                &["/Applications/Codex.app/Contents/Resources/codex"],
            )
        })
        .ok_or_else(|| "未找到 codex CLI。请先安装并登录 Codex Desktop。".to_string())?;
    let run_id = Uuid::new_v4().to_string();
    create_snapshot(&root, &run_id)?;

    emit_codex_event(
        app.as_ref(),
        "started",
        Some(&run_id),
        "Codex 正在修改当前 LaTeX 项目。",
    );

    let prompt = guarded_codex_prompt(&request.prompt);
    let last_message_path = codex_last_message_temp_path(&run_id);
    let args = build_codex_args(&root, &prompt, &last_message_path);
    let mut child = Command::new(&codex)
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start codex: {err}"))?;
    let key = path_key(&root);
    active_codex_runs()
        .lock()
        .unwrap()
        .insert(key.clone(), child.id());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture codex stderr".to_string())?;

    let stdout_app = app.clone();
    let stdout_run_id = run_id.clone();
    let stdout_thread = std::thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stdout).lines().flatten() {
            output.push_str(&line);
            output.push('\n');
            if let Some((kind, message)) = humanize_codex_output_line(&line, false) {
                emit_codex_event(stdout_app.as_ref(), &kind, Some(&stdout_run_id), &message);
            }
        }
        output
    });

    let stderr_app = app.clone();
    let stderr_run_id = run_id.clone();
    let stderr_thread = std::thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stderr).lines().flatten() {
            output.push_str(&line);
            output.push('\n');
            if let Some((kind, message)) = humanize_codex_output_line(&line, true) {
                emit_codex_event(stderr_app.as_ref(), &kind, Some(&stderr_run_id), &message);
            }
        }
        output
    });

    let wait_result = wait_for_codex_child(&mut child, &key, app.as_ref(), &run_id)?;
    let _stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    let final_message = read_codex_last_message(&last_message_path);
    cleanup_codex_last_message(&last_message_path);
    let mut summary = enforce_codex_allowed_file_scope(
        &root,
        &run_id,
        diff_snapshot(&root, &run_id)?,
        allowed_files.as_ref(),
    )?;
    summary.prompt_preview = codex_prompt_preview(&request.prompt);
    summary.final_message = final_message.clone();
    for file in &summary.scope_reverted_files {
        emit_codex_event(
            app.as_ref(),
            "file-change",
            Some(&run_id),
            &format!("已自动撤回上下文外文件：{file}"),
        );
    }
    if !summary.changed_files.is_empty() {
        save_diff_summary(&root, &summary)?;
    }

    for file in &summary.changed_files {
        emit_codex_event(app.as_ref(), "file-change", Some(&run_id), file);
    }

    let (status, was_cancelled) = match wait_result {
        CodexWaitResult::Finished {
            status,
            was_cancelled,
        } => (status, was_cancelled),
        CodexWaitResult::TimedOut => {
            cleanup_codex_last_message(&last_message_path);
            return Err(format!(
                "Codex 运行超过 {}，已自动终止。",
                human_duration(Duration::from_secs(CODEX_RUN_TIMEOUT_SECS))
            ));
        }
    };

    if !status.success() {
        cleanup_codex_last_message(&last_message_path);
        if was_cancelled {
            emit_codex_event(app.as_ref(), "error", Some(&run_id), "Codex 已取消。");
            return Err("Codex 已取消。".to_string());
        }
        emit_codex_event(
            app.as_ref(),
            "error",
            Some(&run_id),
            "Codex 在完成修改前退出。",
        );
        return Err(format!(
            "codex exited with status {}{}",
            status,
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ));
    }

    if summary.changed_files.is_empty() {
        if let Some(message) = final_message.as_deref() {
            emit_codex_event(app.as_ref(), "assistant", Some(&run_id), message);
        }
        emit_codex_event(
            app.as_ref(),
            "completed",
            Some(&run_id),
            "Codex 已完成，没有修改文件。",
        );
        return Ok(summary);
    }

    if request.auto_compile.unwrap_or(true) {
        emit_codex_event(
            app.as_ref(),
            "compile",
            Some(&run_id),
            "Codex 已完成，正在重新编译项目。",
        );
        let compile_request = CompileRequest {
            project_root: request.project_root,
            main_file: None,
        };
        if let Err(err) = run_latex_compile(app.as_ref(), compile_request, latexmk_override) {
            emit_codex_event(
                app.as_ref(),
                "error",
                Some(&run_id),
                &format!("Codex 修改后的自动编译失败：{err}"),
            );
        }
    }

    if let Some(message) = final_message.as_deref() {
        emit_codex_event(app.as_ref(), "assistant", Some(&run_id), message);
    }
    emit_codex_event(app.as_ref(), "completed", Some(&run_id), "Codex 修改完成。");
    Ok(summary)
}

fn run_latex_compile(
    app: Option<&AppHandle>,
    request: CompileRequest,
    latexmk_override: Option<PathBuf>,
) -> Result<CompileResult, String> {
    let root = canonicalize_existing_dir(PathBuf::from(&request.project_root))?;
    let settings = load_settings(&root).unwrap_or_default();
    validate_project_settings(&root, &settings)?;
    let engine = normalized_engine(&settings.engine)?;
    let main_file = request
        .main_file
        .unwrap_or_else(|| settings.main_file.clone());
    let main_path = resolve_project_file_existing(&root, Path::new(&main_file))?;
    let build_dir = resolve_project_build_dir_for_write(&root, &settings.build_dir)?;
    fs::create_dir_all(&build_dir)
        .map_err(|err| format!("failed to create build directory: {err}"))?;

    let latexmk = latexmk_override
        .or_else(|| find_executable("latexmk", &["/Library/TeX/texbin/latexmk"]))
        .ok_or_else(|| {
            "未找到 latexmk。请安装 MacTeX 或 BasicTeX，并确认 latexmk 已加入 PATH。".to_string()
        })?;

    let mut args = vec![
        format!("-{engine}"),
        "-g".to_string(),
        "-interaction=nonstopmode".to_string(),
        "-file-line-error".to_string(),
        "-synctex=1".to_string(),
        "-halt-on-error".to_string(),
        format!("-outdir={}", build_dir.to_string_lossy()),
        main_file.clone(),
    ];
    let main_file_arg = args.pop().unwrap_or_else(|| main_file.clone());
    args.extend(settings.compile_args.iter().cloned());
    args.push(main_file_arg);

    emit_compile_event(
        app,
        "started",
        &format!("正在使用 latexmk + {engine} 编译。"),
        None,
    );

    let key = path_key(&root);
    let output = run_latexmk_command(&latexmk, &args, &root, &key)?;
    let mut log = latexmk_output_log(&output, &expected_log_path(&build_dir, &main_path));
    let diagnostics = parse_latex_diagnostics(&log);
    let pdf_path = expected_pdf_path(&build_dir, &main_path);
    let mut success = output.status.success() && pdf_path.exists();
    let mut diagnostics = diagnostics;
    if !success && should_retry_latexmk_after_clean(&log) {
        emit_compile_event(
            app,
            "log",
            "检测到上次失败留下的构建缓存，正在清理并重试编译。",
            None,
        );
        clean_resolved_build_dir(&build_dir)?;
        let retry_output = run_latexmk_command(&latexmk, &args, &root, &key)?;
        let retry_log =
            latexmk_output_log(&retry_output, &expected_log_path(&build_dir, &main_path));
        success = retry_output.status.success() && pdf_path.exists();
        diagnostics = parse_latex_diagnostics(&retry_log);
        log.push_str("\n\n--- LaTeX Studio clean retry ---\n");
        log.push_str(&retry_log);
    }
    if success {
        diagnostics.clear();
    }
    let result = CompileResult {
        success,
        pdf_path: pdf_path
            .exists()
            .then(|| pdf_path.to_string_lossy().to_string()),
        log,
        diagnostics,
        command: {
            let mut command = vec![latexmk.to_string_lossy().to_string()];
            command.append(&mut args);
            command
        },
    };

    emit_compile_event(
        app,
        if success { "completed" } else { "error" },
        if success {
            "编译完成。"
        } else {
            "编译失败，请查看诊断和日志。"
        },
        Some(result.clone()),
    );

    Ok(result)
}

fn run_latexmk_command(
    latexmk: &Path,
    args: &[String],
    root: &Path,
    active_key: &str,
) -> Result<Output, String> {
    let mut command = Command::new(latexmk);
    command
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepend_child_path(
        &mut command,
        &[
            latexmk.parent().map(Path::to_path_buf),
            Some(PathBuf::from("/Library/TeX/texbin")),
        ],
    );
    let child = command
        .spawn()
        .map_err(|err| format!("failed to start latexmk: {err}"))?;

    let pid = child.id();
    active_compiles()
        .lock()
        .unwrap()
        .insert(active_key.to_string(), pid);
    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for latexmk: {err}"));
    active_compiles().lock().unwrap().remove(active_key);
    output
}

fn latexmk_output_log(output: &Output, log_path: &Path) -> String {
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    append_latex_log_file(&mut log, log_path);
    log
}

fn should_retry_latexmk_after_clean(log: &str) -> bool {
    log.contains("gave an error in previous invocation of latexmk")
        || (log.contains("Rerun of 'bibtex")
            && (log.contains("I found no \\bibdata command")
                || log.contains("I found no \\bibstyle command")))
}

fn clean_resolved_build_dir(build_dir: &Path) -> Result<(), String> {
    if build_dir.exists() {
        if !build_dir.is_dir() {
            return Err("构建目录不是文件夹，不能清理。".to_string());
        }
        fs::remove_dir_all(build_dir)
            .map_err(|err| format!("failed to clean build directory before retry: {err}"))?;
    }
    fs::create_dir_all(build_dir)
        .map_err(|err| format!("failed to recreate build directory before retry: {err}"))
}

fn active_compiles() -> &'static Mutex<HashMap<String, u32>> {
    ACTIVE_COMPILES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_codex_runs() -> &'static Mutex<HashMap<String, u32>> {
    ACTIVE_CODEX_RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

enum CodexWaitResult {
    Finished {
        status: ExitStatus,
        was_cancelled: bool,
    },
    TimedOut,
}

fn wait_for_codex_child(
    child: &mut Child,
    key: &str,
    app: Option<&AppHandle>,
    run_id: &str,
) -> Result<CodexWaitResult, String> {
    wait_for_codex_child_with_timeout(
        child,
        key,
        app,
        run_id,
        Duration::from_secs(CODEX_RUN_TIMEOUT_SECS),
    )
}

fn wait_for_codex_child_with_timeout(
    child: &mut Child,
    key: &str,
    app: Option<&AppHandle>,
    run_id: &str,
    timeout: Duration,
) -> Result<CodexWaitResult, String> {
    let started = Instant::now();
    let mut notice_sent = false;
    let mut cancel_seen_at: Option<Instant> = None;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("failed to poll codex: {err}"))?
        {
            let was_cancelled = active_codex_runs().lock().unwrap().remove(key).is_none();
            return Ok(CodexWaitResult::Finished {
                status,
                was_cancelled,
            });
        }

        let is_active = active_codex_runs().lock().unwrap().contains_key(key);
        if !is_active {
            let first_seen = cancel_seen_at.get_or_insert_with(Instant::now);
            if first_seen.elapsed() >= Duration::from_secs(CODEX_CANCEL_GRACE_SECS) {
                let _ = child.kill();
            }
        }

        if !notice_sent && started.elapsed() >= Duration::from_secs(CODEX_STILL_RUNNING_NOTICE_SECS)
        {
            emit_codex_event(
                app,
                "progress",
                Some(run_id),
                "Codex 仍在运行。可以继续等待，或使用运行卡片里的终止按钮。",
            );
            notice_sent = true;
        }

        if started.elapsed() >= timeout {
            active_codex_runs().lock().unwrap().remove(key);
            let _ = child.kill();
            let _ = child.wait();
            emit_codex_event(
                app,
                "error",
                Some(run_id),
                &format!("Codex 运行超过 {}，已自动终止。", human_duration(timeout)),
            );
            return Ok(CodexWaitResult::TimedOut);
        }

        std::thread::sleep(Duration::from_millis(CODEX_WAIT_POLL_MS));
    }
}

fn canonicalize_existing_dir(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path.as_ref()).map_err(|err| {
        format!(
            "failed to resolve project directory {}: {err}",
            path.as_ref().to_string_lossy()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "{} is not a directory",
            canonical.to_string_lossy()
        ));
    }
    Ok(canonical)
}

fn project_path_for_create(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(next_available_project_dir(
            &default_projects_dir()?.join(unique_project_dir_name()),
        ));
    }

    let expanded = expand_user_path(trimmed)?;
    if expanded.is_absolute() {
        return Ok(expanded);
    }

    Ok(default_projects_dir()?.join(trimmed))
}

fn project_path_for_import_zip(source: &Path) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_export_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "imported-project".to_string());
    let base = default_projects_dir()?.join(stem);
    Ok(next_available_project_dir(&base))
}

fn next_available_project_dir(base: &Path) -> PathBuf {
    if !base.exists() {
        return base.to_path_buf();
    }
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    let name = base
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("imported-project");
    for index in 1..1000 {
        let candidate = parent.join(format!("{name}-{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{name}-{}", unix_timestamp()))
}

fn expand_user_path(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed == "~" {
        return home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return Ok(home_dir()?.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法读取 HOME 目录。".to_string())
}

fn default_projects_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Documents").join("LaTeX Studio"))
}

fn unique_project_dir_name() -> String {
    format!("paper-{}", unix_timestamp())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn human_duration(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds >= 60 {
        format!("{} 分钟", seconds / 60)
    } else {
        format!("{} 秒", seconds)
    }
}

fn app_state_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".latex-desktop-studio"))
}

fn recent_projects_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("recent-projects.json"))
}

fn load_recent_projects() -> Result<Vec<RecentProject>, String> {
    let path = recent_projects_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("failed to read recent projects: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("invalid recent projects JSON: {err}"))
}

fn save_recent_projects(projects: &[RecentProject]) -> Result<(), String> {
    let path = recent_projects_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create app state directory: {err}"))?;
    }
    write_json(&path, &projects)
}

fn remember_recent_project(summary: &ProjectSummary) -> Result<(), String> {
    let mut projects = load_recent_projects().unwrap_or_default();
    projects.retain(|project| project.root != summary.root);
    projects.insert(
        0,
        RecentProject {
            name: summary.name.clone(),
            root: summary.root.clone(),
            main_file: summary.main_file.clone(),
            last_opened: unix_timestamp(),
        },
    );
    projects.truncate(12);
    save_recent_projects(&projects)
}

fn reject_unsafe_relative_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("path cannot be empty".to_string());
    }
    if path.is_absolute() {
        return Err("absolute paths are not allowed inside a project command".to_string());
    }
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("unsafe project path: {}", path.to_string_lossy()));
            }
        }
    }
    Ok(())
}

fn reject_reserved_project_path(path: &Path) -> Result<(), String> {
    reject_unsafe_relative_path(path)?;
    let mut components = path.components();
    let first = components
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            Component::CurDir => Some("."),
            _ => None,
        })
        .unwrap_or("");
    if matches!(first, ".latex-studio" | ".git" | ".latex-studio.json") {
        return Err("不能修改 LaTeX Studio 的项目元数据。".to_string());
    }
    Ok(())
}

fn reject_main_file_operation(root: &Path, path: &Path, operation: &str) -> Result<(), String> {
    let settings = load_settings(root).unwrap_or_default();
    let target = normalize_relative_path(path);
    let main_file = normalize_relative_path(Path::new(&settings.main_file));
    if main_file == target || main_file.starts_with(&format!("{target}/")) {
        return Err(format!(
            "当前版本暂不允许{operation}主文件 {}。请先保留 main.tex，避免项目无法编译。",
            settings.main_file
        ));
    }
    Ok(())
}

fn remap_relative_path_after_rename(current: &str, from_path: &str, to_path: &str) -> String {
    if current == from_path {
        return to_path.to_string();
    }
    if let Some(suffix) = current.strip_prefix(&format!("{from_path}/")) {
        return format!("{to_path}/{suffix}");
    }
    current.to_string()
}

fn rewrite_latex_file_references_after_rename(
    root: &Path,
    from_path: &str,
    to_path: &str,
) -> RenameProjectEntryResult {
    let mut updated_references = 0_u32;
    let mut updated_reference_files = Vec::new();
    let Ok(files) = collect_project_files(root) else {
        return RenameProjectEntryResult {
            updated_references,
            updated_reference_files,
        };
    };

    for relative in files {
        if !is_latex_reference_source_path(&relative) {
            continue;
        }
        let Ok(path) = resolve_project_file_existing(root, Path::new(&relative)) else {
            continue;
        };
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let (updated, replacements) =
            rewrite_latex_file_references_in_content(&content, from_path, to_path);
        if replacements == 0 {
            continue;
        }
        if fs::write(&path, updated).is_ok() {
            updated_references += replacements;
            updated_reference_files.push(relative);
        }
    }

    RenameProjectEntryResult {
        updated_references,
        updated_reference_files,
    }
}

fn rewrite_latex_file_references_in_content(
    content: &str,
    from_path: &str,
    to_path: &str,
) -> (String, u32) {
    let mut replacements = 0_u32;
    let updated_lines = content
        .split('\n')
        .map(|line| {
            let visible = strip_latex_comment(line);
            let comment = &line[visible.len()..];
            let (updated_visible, line_replacements) =
                rewrite_latex_file_references_in_visible_line(&visible, from_path, to_path);
            replacements += line_replacements;
            format!("{updated_visible}{comment}")
        })
        .collect::<Vec<_>>();
    (updated_lines.join("\n"), replacements)
}

fn rewrite_latex_file_references_in_visible_line(
    line: &str,
    from_path: &str,
    to_path: &str,
) -> (String, u32) {
    let mut output = String::new();
    let mut cursor = 0_usize;
    let mut replacements = 0_u32;

    while let Some(offset) = line[cursor..].find('\\') {
        let command_start = cursor + offset;
        let Some((command, argument_start, argument_end)) =
            latex_file_command_argument_range(line, command_start)
        else {
            output.push_str(&line[cursor..command_start + 1]);
            cursor = command_start + 1;
            continue;
        };
        let Some(kind) = latex_file_reference_kind_for_command(&command) else {
            output.push_str(&line[cursor..argument_end]);
            cursor = argument_end;
            continue;
        };
        let argument = &line[argument_start..argument_end];
        let (updated_argument, argument_replacements) =
            rewrite_latex_file_reference_argument(argument, kind, from_path, to_path);
        if argument_replacements == 0 {
            output.push_str(&line[cursor..argument_end]);
        } else {
            output.push_str(&line[cursor..argument_start]);
            output.push_str(&updated_argument);
            replacements += argument_replacements;
        }
        cursor = argument_end;
    }

    output.push_str(&line[cursor..]);
    (output, replacements)
}

fn latex_file_command_argument_range(
    line: &str,
    command_start: usize,
) -> Option<(String, usize, usize)> {
    let mut index = command_start + 1;
    let command_end = consume_ascii_letters(line, index);
    if command_end == index {
        return None;
    }
    let command = line[index..command_end].to_ascii_lowercase();
    index = command_end;
    if matches!(byte_at(line, index), Some(b'*')) {
        index += 1;
    }

    loop {
        index = skip_ascii_whitespace(line, index);
        if !matches!(byte_at(line, index), Some(b'[')) {
            break;
        }
        index = find_balanced_latex_argument_end(line, index, b'[', b']')? + 1;
    }

    index = skip_ascii_whitespace(line, index);
    if !matches!(byte_at(line, index), Some(b'{')) {
        return None;
    }
    let argument_end = find_balanced_latex_argument_end(line, index, b'{', b'}')?;
    Some((command, index + 1, argument_end))
}

fn rewrite_latex_file_reference_argument(
    argument: &str,
    kind: LatexFileReferenceKind,
    from_path: &str,
    to_path: &str,
) -> (String, u32) {
    let mut output = String::new();
    let mut replacements = 0_u32;
    for (index, raw_token) in argument.split(',').enumerate() {
        if index > 0 {
            output.push(',');
        }
        let leading = raw_token
            .char_indices()
            .take_while(|(_, character)| character.is_whitespace())
            .last()
            .map(|(offset, character)| offset + character.len_utf8())
            .unwrap_or(0);
        let trailing_start = raw_token
            .char_indices()
            .rev()
            .take_while(|(_, character)| character.is_whitespace())
            .last()
            .map(|(offset, _)| offset)
            .unwrap_or(raw_token.len());
        if leading >= trailing_start {
            output.push_str(raw_token);
            continue;
        }
        let token = &raw_token[leading..trailing_start];
        output.push_str(&raw_token[..leading]);
        if let Some(replacement) = remap_latex_file_reference_token(token, kind, from_path, to_path)
        {
            output.push_str(&replacement);
            replacements += 1;
        } else {
            output.push_str(token);
        }
        output.push_str(&raw_token[trailing_start..]);
    }
    (output, replacements)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LatexFileReferenceKind {
    Tex,
    Graphics,
    Bibliography,
}

fn latex_file_reference_kind_for_command(command: &str) -> Option<LatexFileReferenceKind> {
    match command {
        "input" | "include" | "subfile" => Some(LatexFileReferenceKind::Tex),
        "includegraphics" => Some(LatexFileReferenceKind::Graphics),
        "bibliography" | "addbibresource" | "addglobalbib" => {
            Some(LatexFileReferenceKind::Bibliography)
        }
        _ => None,
    }
}

fn latex_file_reference_kind_label(kind: LatexFileReferenceKind) -> &'static str {
    match kind {
        LatexFileReferenceKind::Tex => "tex",
        LatexFileReferenceKind::Graphics => "graphics",
        LatexFileReferenceKind::Bibliography => "bibliography",
    }
}

fn resolve_latex_file_reference(
    root: &Path,
    token: &str,
    kind: LatexFileReferenceKind,
) -> Option<String> {
    for (candidate, _) in latex_file_reference_candidate_paths(token, kind) {
        let candidate_path = root.join(&candidate);
        let Ok(canonical) = fs::canonicalize(&candidate_path) else {
            continue;
        };
        if !canonical.is_file() || ensure_under_root(root, &canonical).is_err() {
            continue;
        }
        return Some(normalize_relative_path(Path::new(&candidate)));
    }
    None
}

fn remap_latex_file_reference_token(
    token: &str,
    kind: LatexFileReferenceKind,
    from_path: &str,
    to_path: &str,
) -> Option<String> {
    if token.trim().is_empty()
        || is_dynamic_latex_file_reference(token)
        || Path::new(token).is_absolute()
    {
        return None;
    }
    let has_dot_prefix = token.starts_with("./");
    let normalized = token.strip_prefix("./").unwrap_or(token);
    for (candidate, added_extension) in latex_file_reference_candidate_paths(normalized, kind) {
        let remapped = remap_relative_path_after_rename(&candidate, from_path, to_path);
        if remapped == candidate {
            continue;
        }
        let mut replacement = if let Some(extension) = added_extension {
            strip_extension_for_latex_token(&remapped, extension)
        } else {
            remapped
        };
        if has_dot_prefix {
            replacement = format!("./{replacement}");
        }
        return Some(replacement);
    }
    None
}

fn latex_file_reference_candidate_paths(
    token: &str,
    kind: LatexFileReferenceKind,
) -> Vec<(String, Option<&'static str>)> {
    let extension = path_extension_lower(token);
    let mut candidates = vec![(token.to_string(), None)];
    match kind {
        LatexFileReferenceKind::Tex if extension.as_deref() != Some("tex") => {
            candidates.push((format!("{token}.tex"), Some("tex")));
        }
        LatexFileReferenceKind::Bibliography if extension.as_deref() != Some("bib") => {
            candidates.push((format!("{token}.bib"), Some("bib")));
        }
        LatexFileReferenceKind::Graphics if extension.is_none() => {
            for extension in ["pdf", "png", "jpg", "jpeg", "gif", "webp", "eps", "svg"] {
                candidates.push((format!("{token}.{extension}"), Some(extension)));
            }
        }
        _ => {}
    }
    candidates
}

fn strip_extension_for_latex_token(path: &str, extension: &str) -> String {
    let suffix = format!(".{extension}");
    if path.to_ascii_lowercase().ends_with(&suffix) {
        path[..path.len() - suffix.len()].to_string()
    } else {
        path.to_string()
    }
}

fn path_extension_lower(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
}

fn is_dynamic_latex_file_reference(token: &str) -> bool {
    token
        .chars()
        .any(|character| matches!(character, '\\' | '{' | '}' | '$' | '#'))
}

fn consume_ascii_letters(value: &str, mut index: usize) -> usize {
    while matches!(byte_at(value, index), Some(byte) if byte.is_ascii_alphabetic()) {
        index += 1;
    }
    index
}

fn skip_ascii_whitespace(value: &str, mut index: usize) -> usize {
    while matches!(byte_at(value, index), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        index += 1;
    }
    index
}

fn find_balanced_latex_argument_end(
    value: &str,
    open_index: usize,
    open: u8,
    close: u8,
) -> Option<usize> {
    let mut depth = 0_i32;
    let mut escaped = false;
    for (index, byte) in value.as_bytes().iter().enumerate().skip(open_index) {
        if escaped {
            escaped = false;
            continue;
        }
        if *byte == b'\\' {
            escaped = true;
            continue;
        }
        if *byte == open {
            depth += 1;
            continue;
        }
        if *byte == close {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn byte_at(value: &str, index: usize) -> Option<u8> {
    value.as_bytes().get(index).copied()
}

fn normalize_relative_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn resolve_project_file_existing(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    reject_unsafe_relative_path(relative)?;
    let joined = root.join(relative);
    let canonical = fs::canonicalize(&joined).map_err(|err| {
        format!(
            "failed to resolve project file {}: {err}",
            relative.to_string_lossy()
        )
    })?;
    ensure_under_root(root, &canonical)?;
    Ok(canonical)
}

fn resolve_project_pdf_existing(root: &Path, pdf_path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(pdf_path)
        .map_err(|err| format!("无法读取 PDF 文件 {}：{err}", pdf_path))?;
    ensure_under_root(root, &path)?;
    if path.extension().and_then(|value| value.to_str()) != Some("pdf") {
        return Err("只能操作当前项目中的 PDF 文件。".to_string());
    }
    Ok(path)
}

fn resolve_project_file_for_write(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    reject_unsafe_relative_path(relative)?;
    let joined = root.join(relative);
    if joined.exists() {
        let canonical = fs::canonicalize(&joined).map_err(|err| {
            format!(
                "failed to resolve existing project file {}: {err}",
                relative.to_string_lossy()
            )
        })?;
        ensure_under_root(root, &canonical)?;
        return Ok(canonical);
    }
    let parent = joined
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", relative.to_string_lossy()))?;
    let canonical_parent = nearest_existing_parent(parent)?;
    ensure_under_root(root, &canonical_parent)?;
    Ok(joined)
}

fn resolve_project_directory_for_write(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if relative.as_os_str().is_empty() {
        return Ok(root.to_path_buf());
    }
    reject_unsafe_relative_path(relative)?;
    let joined = root.join(relative);
    if joined.exists() {
        let canonical = fs::canonicalize(&joined).map_err(|err| {
            format!(
                "failed to resolve existing project directory {}: {err}",
                relative.to_string_lossy()
            )
        })?;
        ensure_under_root(root, &canonical)?;
        if !canonical.is_dir() {
            return Err(format!("{} 不是文件夹。", relative.to_string_lossy()));
        }
        return Ok(canonical);
    }
    let parent = joined
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", relative.to_string_lossy()))?;
    let canonical_parent = nearest_existing_parent(parent)?;
    ensure_under_root(root, &canonical_parent)?;
    Ok(joined)
}

fn resolve_project_build_dir_for_write(root: &Path, build_dir: &str) -> Result<PathBuf, String> {
    let relative = Path::new(build_dir);
    reject_unsafe_relative_path(relative)?;
    let normalized = normalize_relative_path(relative);
    if normalized.is_empty() {
        return Err("构建目录不能是项目根目录。".to_string());
    }
    let build_path = resolve_project_file_for_write(root, relative)?;
    if build_path == root {
        return Err("构建目录不能是项目根目录。".to_string());
    }
    Ok(build_path)
}

fn next_available_import_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..1000 {
        let file_name = if let Some(extension) = extension {
            format!("{stem}-{index}.{extension}")
        } else {
            format!("{stem}-{index}")
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path;
    while !current.exists() {
        current = current
            .parent()
            .ok_or_else(|| "could not find an existing parent directory".to_string())?;
    }
    fs::canonicalize(current).map_err(|err| format!("failed to resolve parent directory: {err}"))
}

fn ensure_under_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(format!(
            "path {} escapes project root {}",
            path.to_string_lossy(),
            root.to_string_lossy()
        ))
    }
}

fn project_summary(root: &Path) -> Result<ProjectSummary, String> {
    let settings = load_settings(root).unwrap_or_default();
    let fallback_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("LaTeX Project");
    let name = settings
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_name)
        .to_string();
    Ok(ProjectSummary {
        name,
        root: root.to_string_lossy().to_string(),
        main_file: settings.main_file,
        settings_path: root
            .join(".latex-studio.json")
            .to_string_lossy()
            .to_string(),
    })
}

fn load_settings(root: &Path) -> Result<ProjectSettings, String> {
    let settings_path = root.join(".latex-studio.json");
    let content = fs::read_to_string(&settings_path)
        .map_err(|err| format!("failed to read .latex-studio.json: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("invalid .latex-studio.json: {err}"))
}

fn validate_project_settings(root: &Path, settings: &ProjectSettings) -> Result<(), String> {
    if let Some(display_name) = settings.display_name.as_deref() {
        if display_name.trim().chars().count() > 120 {
            return Err("项目名不能超过 120 个字符。".to_string());
        }
    }
    let main_relative = Path::new(&settings.main_file);
    reject_unsafe_relative_path(main_relative)?;
    let main_path = resolve_project_file_existing(root, main_relative)?;
    if main_path.extension().and_then(|value| value.to_str()) != Some("tex") {
        return Err("主文件必须是 .tex 文件。".to_string());
    }
    normalized_engine(&settings.engine)?;
    let build_relative = Path::new(&settings.build_dir);
    reject_unsafe_relative_path(build_relative)?;
    if build_relative.as_os_str().is_empty() {
        return Err("构建目录不能为空。".to_string());
    }
    if normalize_relative_path(build_relative).is_empty() {
        return Err("构建目录不能是项目根目录。".to_string());
    }
    validate_latexmk_extra_args(&settings.compile_args)?;
    Ok(())
}

fn project_main_file_is_valid(root: &Path, settings: &ProjectSettings) -> bool {
    let main_relative = Path::new(&settings.main_file);
    reject_unsafe_relative_path(main_relative).is_ok()
        && resolve_project_file_existing(root, main_relative)
            .map(|path| path.extension().and_then(|value| value.to_str()) == Some("tex"))
            .unwrap_or(false)
}

#[derive(Debug, Default)]
struct TexMagicSettings {
    main_file: Option<String>,
    engine: Option<String>,
}

fn detect_tex_magic_settings(root: &Path) -> Result<TexMagicSettings, String> {
    let mut detected = TexMagicSettings::default();
    let walker = WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !should_skip_walk_entry(entry));
    for entry in walker {
        let entry = entry.map_err(|err| format!("failed to scan project TeX metadata: {err}"))?;
        if !entry.file_type().is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("tex")
        {
            continue;
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        for (line_index, line) in content.lines().take(80).enumerate() {
            let Some((key, value)) = parse_tex_magic_comment(line) else {
                continue;
            };
            match key.as_str() {
                "root" if detected.main_file.is_none() => {
                    if let Some(main_file) = resolve_magic_root_file(root, entry.path(), &value)? {
                        detected.main_file = Some(main_file);
                    }
                }
                "program" | "engine" | "ts-program" if detected.engine.is_none() => {
                    if let Some(engine) = tex_magic_engine(&value) {
                        detected.engine = Some(engine);
                    }
                }
                _ => {}
            }
            if detected.main_file.is_some() && detected.engine.is_some() {
                return Ok(detected);
            }
            if line_index > 8 && !line.trim_start().starts_with('%') {
                break;
            }
        }
    }
    Ok(detected)
}

fn parse_tex_magic_comment(line: &str) -> Option<(String, String)> {
    let comment = latex_comment_text(line)?;
    let trimmed = comment.trim_start();
    let rest = trimmed
        .strip_prefix("!TEX")
        .or_else(|| trimmed.strip_prefix("!TeX"))
        .or_else(|| trimmed.strip_prefix("!tex"))?
        .trim();
    let (key, value) = rest.split_once('=').or_else(|| rest.split_once(':'))?;
    let key = key.trim().to_ascii_lowercase().replace([' ', '_'], "-");
    let value = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if key.is_empty() || value.is_empty() {
        return None;
    }
    Some((key, value))
}

fn resolve_magic_root_file(
    root: &Path,
    source_path: &Path,
    value: &str,
) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let base_dir = source_path.parent().unwrap_or(root);
    let candidate = if Path::new(value).is_absolute() {
        PathBuf::from(value)
    } else {
        base_dir.join(value)
    };
    if !candidate.exists() || candidate.extension().and_then(|item| item.to_str()) != Some("tex") {
        return Ok(None);
    }
    let canonical = fs::canonicalize(&candidate)
        .map_err(|err| format!("failed to resolve TeX root comment {value}: {err}"))?;
    ensure_under_root(root, &canonical)?;
    relative_slash(root, &canonical).map(Some)
}

fn tex_magic_engine(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "");
    match normalized.as_str() {
        "xelatex" | "xetex" => Some("xelatex".to_string()),
        "pdflatex" | "pdftex" => Some("pdflatex".to_string()),
        "lualatex" | "luatex" => Some("lualatex".to_string()),
        _ => None,
    }
}

fn detect_project_main_file(root: &Path) -> Result<Option<String>, String> {
    let mut candidates: Vec<(u8, String)> = Vec::new();
    let walker = WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !should_skip_walk_entry(entry));
    for entry in walker {
        let entry = entry.map_err(|err| format!("failed to scan project for main file: {err}"))?;
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|value| value.to_str()) != Some("tex") {
            continue;
        }
        let relative = relative_slash(root, entry.path())?;
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        let is_root_level = !relative.contains('/');
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        let has_documentclass = content.contains("\\documentclass");
        let has_begin_document = content.contains("\\begin{document}");
        let rank = if file_name == "main.tex" && is_root_level {
            0
        } else if file_name == "main.tex" {
            1
        } else if has_documentclass && has_begin_document && is_root_level {
            2
        } else if has_documentclass && has_begin_document {
            3
        } else if has_documentclass && is_root_level {
            4
        } else if has_documentclass {
            5
        } else if is_root_level {
            6
        } else {
            7
        };
        candidates.push((rank, relative));
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    Ok(candidates.into_iter().next().map(|candidate| candidate.1))
}

fn normalized_engine(engine: &str) -> Result<String, String> {
    let engine = engine.trim().to_ascii_lowercase();
    match engine.as_str() {
        "xelatex" | "pdflatex" | "lualatex" => Ok(engine),
        _ => Err("编译引擎只能选择 xelatex、pdflatex 或 lualatex。".to_string()),
    }
}

fn validate_latexmk_extra_args(args: &[String]) -> Result<(), String> {
    for arg in args {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            return Err("附加编译参数不能为空。".to_string());
        }
        if trimmed.contains('\0') || trimmed.contains('\n') || trimmed.contains('\r') {
            return Err("附加编译参数不能包含控制字符。".to_string());
        }
        if !trimmed.starts_with('-') {
            return Err(format!(
                "附加编译参数 `{trimmed}` 不安全：不能在这里指定主文件或位置参数。"
            ));
        }

        let lower = trimmed.to_ascii_lowercase();
        let managed_prefixes = [
            "-outdir",
            "-output-directory",
            "-aux-directory",
            "-jobname",
            "-cd",
        ];
        if managed_prefixes
            .iter()
            .any(|prefix| lower == *prefix || lower.starts_with(&format!("{prefix}=")))
        {
            return Err(format!(
                "附加编译参数 `{trimmed}` 与项目设置冲突，请使用主文件/构建目录设置。"
            ));
        }

        let unsafe_args = [
            "-shell-escape",
            "--shell-escape",
            "-enable-write18",
            "-e",
            "-r",
        ];
        if unsafe_args.iter().any(|blocked| lower == *blocked) {
            return Err(format!(
                "附加编译参数 `{trimmed}` 会扩大本地执行权限，已被 LaTeX Studio 拒绝。"
            ));
        }
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|err| format!("failed to serialize JSON: {err}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|err| format!("failed to write {}: {err}", path.to_string_lossy()))
}

fn sorted_read_dir(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|err| format!("failed to list {}: {err}", path.to_string_lossy()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("failed to list {}: {err}", path.to_string_lossy()))?;
    entries.sort_by(|left, right| {
        let left_is_dir = left
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        let right_is_dir = right
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        right_is_dir
            .cmp(&left_is_dir)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    Ok(entries)
}

fn file_node(root: &Path, path: &Path) -> Result<FileNode, String> {
    let metadata = fs::metadata(path)
        .map_err(|err| format!("failed to stat {}: {err}", path.to_string_lossy()))?;
    let relative = relative_slash(root, path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    if metadata.is_dir() {
        let mut children = Vec::new();
        for entry in sorted_read_dir(path)? {
            if should_skip_dir_entry(&entry) {
                continue;
            }
            children.push(file_node(root, &entry.path())?);
        }
        Ok(FileNode {
            name,
            path: relative,
            kind: FileKind::Directory,
            size: None,
            children: Some(children),
        })
    } else {
        Ok(FileNode {
            name,
            path: relative,
            kind: FileKind::File,
            size: Some(metadata.len()),
            children: None,
        })
    }
}

fn should_skip_dir_entry(entry: &fs::DirEntry) -> bool {
    let name = entry.file_name();
    matches!(
        name.to_str(),
        Some(".git") | Some(".latex-studio") | Some(".latex-studio.json")
    )
}

fn should_skip_walk_entry(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name == ".git" || name == ".latex-studio"
}

fn is_internal_project_metadata_path(path: &str) -> bool {
    path == ".latex-studio.json" || path.starts_with(".latex-studio/") || path.starts_with(".git/")
}

fn is_searchable_text_path(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|value| value.to_str()),
        Some("tex" | "bib" | "sty" | "cls" | "bst" | "json" | "md" | "txt")
    )
}

fn is_todo_indexed_path(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|value| value.to_str()),
        Some("tex" | "bib" | "sty" | "cls" | "md" | "txt")
    )
}

fn is_latex_reference_source_path(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|value| value.to_str()),
        Some("tex" | "sty" | "cls")
    )
}

fn tex_project_files_in_document_order(
    root: &Path,
    settings: &ProjectSettings,
) -> Result<Vec<String>, String> {
    let mut tex_files = collect_project_files(root)?
        .into_iter()
        .filter(|relative| path_extension_lower(relative).as_deref() == Some("tex"))
        .collect::<Vec<_>>();
    tex_files.sort();
    let tex_set = tex_files.iter().cloned().collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    let mut ordered = Vec::new();

    if tex_set.contains(&settings.main_file) {
        visit_tex_file_in_document_order(
            root,
            &settings.main_file,
            &tex_set,
            &mut seen,
            &mut ordered,
        )?;
    } else if let Some(first_file) = tex_files.first() {
        visit_tex_file_in_document_order(root, first_file, &tex_set, &mut seen, &mut ordered)?;
    }

    for relative in tex_files {
        visit_tex_file_in_document_order(root, &relative, &tex_set, &mut seen, &mut ordered)?;
    }

    Ok(ordered)
}

fn visit_tex_file_in_document_order(
    root: &Path,
    relative: &str,
    tex_set: &BTreeSet<String>,
    seen: &mut BTreeSet<String>,
    ordered: &mut Vec<String>,
) -> Result<(), String> {
    if !tex_set.contains(relative) || !seen.insert(relative.to_string()) {
        return Ok(());
    }
    ordered.push(relative.to_string());

    let path = resolve_project_file_existing(root, Path::new(relative))?;
    let Ok(content) = fs::read_to_string(&path) else {
        return Ok(());
    };
    for dependency in parse_project_dependencies(root, relative, &content) {
        if dependency.kind != "tex" {
            continue;
        }
        let Some(resolved_path) = dependency.resolved_path else {
            continue;
        };
        visit_tex_file_in_document_order(root, &resolved_path, tex_set, seen, ordered)?;
    }

    Ok(())
}

fn asset_mime_for_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("pdf") => Some("application/pdf"),
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn parse_tex_outline(relative: &str, content: &str) -> Vec<OutlineItem> {
    let mut items = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let visible = strip_latex_comment(line);
        if let Some((kind, title, level)) = parse_heading_outline(&visible) {
            items.push(OutlineItem {
                kind,
                title,
                file: relative.to_string(),
                line: (line_index + 1) as u32,
                level,
            });
        }
        if let Some(label) = find_latex_command_argument(&visible, "label") {
            items.push(OutlineItem {
                kind: "label".to_string(),
                title: label,
                file: relative.to_string(),
                line: (line_index + 1) as u32,
                level: 7,
            });
        }
    }
    items
}

fn parse_tex_overview(content: &str) -> ProjectOverview {
    let visible = content
        .lines()
        .map(strip_latex_comment)
        .collect::<Vec<_>>()
        .join("\n");
    let title = find_latex_command_argument(&visible, "title")
        .map(|value| cleanup_latex_context_text(&value, 320))
        .filter(|value| !value.is_empty());
    let author = find_latex_command_argument(&visible, "author")
        .map(|value| cleanup_latex_context_text(&value, 420))
        .filter(|value| !value.is_empty());
    let date = find_latex_command_argument(&visible, "date")
        .map(|value| cleanup_latex_context_text(&value, 160))
        .filter(|value| !value.is_empty());
    let abstract_text = find_latex_environment_content(&visible, "abstract")
        .map(|value| cleanup_latex_context_text(&value, 1_200))
        .filter(|value| !value.is_empty());
    let mut keywords = Vec::new();
    for command in ["keywords", "keyword"] {
        for argument in find_latex_command_arguments(&visible, command) {
            keywords.extend(split_project_keywords(&argument));
        }
    }
    if let Some(keyword_block) = find_latex_environment_content(&visible, "keywords") {
        keywords.extend(split_project_keywords(&keyword_block));
    }
    keywords.sort();
    keywords.dedup();
    keywords.truncate(16);

    ProjectOverview {
        title,
        author,
        date,
        abstract_text,
        keywords,
    }
}

fn merge_project_overview(target: &mut ProjectOverview, source: ProjectOverview) {
    if target.title.is_none() {
        target.title = source.title;
    }
    if target.author.is_none() {
        target.author = source.author;
    }
    if target.date.is_none() {
        target.date = source.date;
    }
    if target.abstract_text.is_none() {
        target.abstract_text = source.abstract_text;
    }
    target.keywords.extend(source.keywords);
    target.keywords.sort();
    target.keywords.dedup();
    target.keywords.truncate(16);
}

fn overview_has_core_context(overview: &ProjectOverview) -> bool {
    overview.title.is_some()
        && overview.author.is_some()
        && overview.abstract_text.is_some()
        && !overview.keywords.is_empty()
}

fn parse_tex_symbols(relative: &str, content: &str) -> Vec<ProjectSymbol> {
    let mut symbols = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let visible = strip_latex_comment(line);
        for label in find_latex_command_arguments(&visible, "label") {
            symbols.push(ProjectSymbol {
                kind: "label".to_string(),
                key: label,
                detail: Some("label".to_string()),
                file: relative.to_string(),
                line: (line_index + 1) as u32,
            });
        }
    }
    symbols
}

fn parse_project_todos(relative: &str, content: &str) -> Vec<ProjectTodo> {
    let mut todos = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let Some(comment) = latex_comment_text(line) else {
            continue;
        };
        if let Some((kind, message, resolved)) = parse_todo_comment(&comment) {
            todos.push(ProjectTodo {
                kind,
                message,
                file: relative.to_string(),
                line: (line_index + 1) as u32,
                resolved,
            });
        }
    }
    todos
}

fn list_project_reference_issues_in_root(
    root: &Path,
) -> Result<Vec<ProjectReferenceIssue>, String> {
    let settings = load_settings(root).unwrap_or_default();
    let files = collect_project_files(root)?;
    let mut known = BTreeSet::new();
    for relative in &files {
        let extension = Path::new(relative)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !matches!(extension, "tex" | "bib") {
            continue;
        }
        let path = resolve_project_file_existing(root, Path::new(relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let symbols = if extension == "tex" {
            parse_tex_symbols(relative, &content)
        } else {
            parse_bib_symbols(relative, &content)
        };
        for symbol in symbols {
            known.insert((symbol.kind, symbol.key));
        }
    }

    let mut source_files = files
        .into_iter()
        .filter(|relative| is_latex_reference_source_path(relative))
        .collect::<Vec<_>>();
    source_files.sort_by(|left, right| {
        let left_rank = if left == &settings.main_file { 0 } else { 1 };
        let right_rank = if right == &settings.main_file { 0 } else { 1 };
        left_rank.cmp(&right_rank).then_with(|| left.cmp(right))
    });

    let mut issues = Vec::new();
    let mut seen = BTreeSet::new();
    for relative in source_files {
        let path = resolve_project_file_existing(root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for issue in parse_project_reference_issues(&relative, &content, &known) {
            let unique_key = (
                issue.kind.clone(),
                issue.key.clone(),
                issue.file.clone(),
                issue.line,
            );
            if seen.insert(unique_key) {
                issues.push(issue);
            }
            if issues.len() >= 500 {
                issues.truncate(500);
                return Ok(issues);
            }
        }
    }
    Ok(issues)
}

fn list_project_file_usages_in_root(
    root: &Path,
    target_path: &str,
) -> Result<Vec<ProjectFileUsage>, String> {
    let target_relative = Path::new(target_path);
    reject_reserved_project_path(target_relative)?;
    let target = resolve_project_file_existing(root, target_relative)?;
    let target_is_dir = target.is_dir();
    let normalized_target = normalize_relative_path(target_relative);
    let mut usages = Vec::new();
    for relative in collect_project_files(root)? {
        if !is_latex_reference_source_path(&relative) {
            continue;
        }
        let path = resolve_project_file_existing(root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        usages.extend(parse_project_file_usages(
            &relative,
            &content,
            &normalized_target,
            target_is_dir,
        ));
        if usages.len() >= 500 {
            usages.truncate(500);
            break;
        }
    }
    usages.sort_by(|left, right| {
        left.file
            .cmp(&right.file)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.command.cmp(&right.command))
            .then_with(|| left.path.cmp(&right.path))
    });
    usages.dedup_by(|left, right| {
        left.file == right.file
            && left.line == right.line
            && left.command == right.command
            && left.path == right.path
    });
    Ok(usages)
}

fn list_project_dependencies_in_root(root: &Path) -> Result<Vec<ProjectDependency>, String> {
    let settings = load_settings(root).unwrap_or_default();
    let mut source_files = tex_project_files_in_document_order(root, &settings)?;
    let mut style_files = collect_project_files(root)?
        .into_iter()
        .filter(|relative| is_latex_reference_source_path(relative))
        .filter(|relative| path_extension_lower(relative).as_deref() != Some("tex"))
        .collect::<Vec<_>>();
    style_files.sort();
    source_files.extend(style_files);

    let mut dependencies = Vec::new();
    let mut seen = BTreeSet::new();
    for relative in source_files {
        let path = resolve_project_file_existing(root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for dependency in parse_project_dependencies(root, &relative, &content) {
            let key = (
                dependency.source_file.clone(),
                dependency.line,
                dependency.command.clone(),
                dependency.target.clone(),
            );
            if seen.insert(key) {
                dependencies.push(dependency);
            }
            if dependencies.len() >= 800 {
                dependencies.truncate(800);
                return Ok(dependencies);
            }
        }
    }
    Ok(dependencies)
}

fn parse_project_file_usages(
    source_relative: &str,
    content: &str,
    target_path: &str,
    target_is_dir: bool,
) -> Vec<ProjectFileUsage> {
    let mut usages = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let visible = strip_latex_comment(line);
        usages.extend(parse_latex_file_usages_in_visible_line(
            source_relative,
            &visible,
            (line_index + 1) as u32,
            target_path,
            target_is_dir,
        ));
    }
    usages
}

fn parse_project_dependencies(
    root: &Path,
    source_relative: &str,
    content: &str,
) -> Vec<ProjectDependency> {
    let mut dependencies = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let visible = strip_latex_comment(line);
        dependencies.extend(parse_project_dependencies_in_visible_line(
            root,
            source_relative,
            &visible,
            (line_index + 1) as u32,
        ));
    }
    dependencies
}

fn parse_project_dependencies_in_visible_line(
    root: &Path,
    source_relative: &str,
    line: &str,
    line_number: u32,
) -> Vec<ProjectDependency> {
    let mut dependencies = Vec::new();
    let mut cursor = 0_usize;
    while let Some(offset) = line[cursor..].find('\\') {
        let command_start = cursor + offset;
        let Some((command, argument_start, argument_end)) =
            latex_file_command_argument_range(line, command_start)
        else {
            cursor = command_start + 1;
            continue;
        };
        let Some(kind) = latex_file_reference_kind_for_command(&command) else {
            cursor = argument_end;
            continue;
        };
        for token in line[argument_start..argument_end].split(',').map(str::trim) {
            if token.is_empty()
                || is_dynamic_latex_file_reference(token)
                || Path::new(token).is_absolute()
                || token.split('/').any(|part| part == "..")
            {
                continue;
            }
            let normalized = token.strip_prefix("./").unwrap_or(token);
            dependencies.push(ProjectDependency {
                source_file: source_relative.to_string(),
                line: line_number,
                command: command.clone(),
                kind: latex_file_reference_kind_label(kind).to_string(),
                target: token.to_string(),
                resolved_path: resolve_latex_file_reference(root, normalized, kind),
            });
        }
        cursor = argument_end;
    }
    dependencies
}

fn parse_latex_file_usages_in_visible_line(
    source_relative: &str,
    line: &str,
    line_number: u32,
    target_path: &str,
    target_is_dir: bool,
) -> Vec<ProjectFileUsage> {
    let mut usages = Vec::new();
    let mut cursor = 0_usize;
    while let Some(offset) = line[cursor..].find('\\') {
        let command_start = cursor + offset;
        let Some((command, argument_start, argument_end)) =
            latex_file_command_argument_range(line, command_start)
        else {
            cursor = command_start + 1;
            continue;
        };
        let Some(kind) = latex_file_reference_kind_for_command(&command) else {
            cursor = argument_end;
            continue;
        };
        for token in line[argument_start..argument_end].split(',').map(str::trim) {
            if token.is_empty()
                || is_dynamic_latex_file_reference(token)
                || Path::new(token).is_absolute()
            {
                continue;
            }
            let normalized = token.strip_prefix("./").unwrap_or(token);
            let mut matched = false;
            for (candidate, _) in latex_file_reference_candidate_paths(normalized, kind) {
                if project_file_reference_matches_target(&candidate, target_path, target_is_dir) {
                    matched = true;
                    break;
                }
            }
            if matched {
                usages.push(ProjectFileUsage {
                    file: source_relative.to_string(),
                    line: line_number,
                    command: command.clone(),
                    path: token.to_string(),
                });
            }
        }
        cursor = argument_end;
    }
    usages
}

fn project_file_reference_matches_target(
    candidate: &str,
    target_path: &str,
    target_is_dir: bool,
) -> bool {
    if target_is_dir {
        candidate == target_path || candidate.starts_with(&format!("{target_path}/"))
    } else {
        candidate == target_path
    }
}

fn parse_project_reference_issues(
    relative: &str,
    content: &str,
    known: &BTreeSet<(String, String)>,
) -> Vec<ProjectReferenceIssue> {
    let mut issues = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let visible = strip_latex_comment(line);
        for (kind, key) in parse_latex_references_in_line(&visible) {
            if kind == "citation" && key == "*" {
                continue;
            }
            if known.contains(&(kind.clone(), key.clone())) {
                continue;
            }
            issues.push(ProjectReferenceIssue {
                kind,
                key,
                file: relative.to_string(),
                line: (line_index + 1) as u32,
            });
        }
    }
    issues
}

fn parse_latex_references_in_line(line: &str) -> Vec<(String, String)> {
    let mut references = Vec::new();
    for command in latex_citation_commands() {
        for argument in find_latex_command_arguments(line, command) {
            references.extend(
                split_latex_reference_keys(&argument).map(|key| ("citation".to_string(), key)),
            );
        }
    }
    for command in latex_label_reference_commands() {
        for argument in find_latex_command_arguments(line, command) {
            references.extend(
                split_latex_reference_keys(&argument).map(|key| ("label".to_string(), key)),
            );
        }
    }
    references
}

fn split_latex_reference_keys(argument: &str) -> impl Iterator<Item = String> + '_ {
    argument
        .split(',')
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(ToString::to_string)
}

fn latex_citation_commands() -> &'static [&'static str] {
    &[
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
    ]
}

fn latex_label_reference_commands() -> &'static [&'static str] {
    &[
        "ref",
        "eqref",
        "autoref",
        "cref",
        "labelcref",
        "vref",
        "pageref",
    ]
}

fn count_project_words_in_root(root: &Path) -> Result<WordCountResult, String> {
    let mut files = Vec::new();
    for relative in collect_project_files(root)? {
        if Path::new(&relative)
            .extension()
            .and_then(|value| value.to_str())
            != Some("tex")
        {
            continue;
        }
        let path = resolve_project_file_existing(root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let (words, characters) = count_latex_words(&content);
        files.push(WordCountFile {
            file: relative,
            words,
            characters,
        });
    }
    files.sort_by(|left, right| {
        right
            .words
            .cmp(&left.words)
            .then_with(|| left.file.cmp(&right.file))
    });
    let words = files.iter().map(|file| file.words).sum();
    let characters = files.iter().map(|file| file.characters).sum();
    Ok(WordCountResult {
        words,
        characters,
        files,
    })
}

fn replace_project_text_in_root(
    root: &Path,
    query: &str,
    replacement: &str,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Err("替换内容不能为空。".to_string());
    }
    let mut files = Vec::new();
    let mut total = 0_u32;
    for relative in collect_project_files(root)? {
        if is_internal_project_metadata_path(&relative) || !is_searchable_text_path(&relative) {
            continue;
        }
        let path = resolve_project_file_existing(root, Path::new(&relative))?;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let replacements = content.matches(query).count() as u32;
        if replacements == 0 {
            continue;
        }
        let updated = content.replace(query, replacement);
        fs::write(&path, updated)
            .map_err(|err| format!("failed to replace text in {relative}: {err}"))?;
        total += replacements;
        files.push(ReplaceFileResult {
            file: relative,
            replacements,
        });
    }
    Ok(ReplaceResult {
        replacements: total,
        files,
    })
}

fn count_latex_words(content: &str) -> (u32, u32) {
    let mut text = String::new();
    for line in content.lines() {
        text.push_str(&latex_line_for_word_count(&strip_latex_comment(line)));
        text.push('\n');
    }
    count_words_in_plain_text(&text)
}

fn latex_line_for_word_count(line: &str) -> String {
    let mut result = String::new();
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\\' {
            let mut command = String::new();
            while matches!(chars.peek(), Some(next) if next.is_ascii_alphabetic()) {
                if let Some(next) = chars.next() {
                    command.push(next);
                }
            }
            while matches!(chars.peek(), Some('*')) {
                chars.next();
            }
            if should_skip_word_count_command_argument(&command) {
                skip_optional_latex_argument(&mut chars);
                skip_required_latex_argument(&mut chars);
            }
            result.push(' ');
            continue;
        }
        if matches!(
            character,
            '{' | '}' | '[' | ']' | '$' | '^' | '_' | '&' | '~'
        ) {
            result.push(' ');
        } else {
            result.push(character);
        }
    }
    result
}

fn should_skip_word_count_command_argument(command: &str) -> bool {
    matches!(
        command,
        "label"
            | "ref"
            | "eqref"
            | "pageref"
            | "autoref"
            | "cref"
            | "Cref"
            | "cite"
            | "citet"
            | "citep"
            | "citealp"
            | "citeauthor"
            | "citeyear"
            | "bibliography"
            | "bibliographystyle"
            | "input"
            | "include"
            | "includegraphics"
            | "usepackage"
            | "documentclass"
    )
}

fn skip_optional_latex_argument<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    while matches!(chars.peek(), Some(character) if character.is_whitespace()) {
        chars.next();
    }
    if matches!(chars.peek(), Some('[')) {
        skip_balanced_latex_argument(chars, '[', ']');
    }
}

fn skip_required_latex_argument<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    while matches!(chars.peek(), Some(character) if character.is_whitespace()) {
        chars.next();
    }
    if matches!(chars.peek(), Some('{')) {
        skip_balanced_latex_argument(chars, '{', '}');
    }
}

fn skip_balanced_latex_argument<I>(chars: &mut std::iter::Peekable<I>, open: char, close: char)
where
    I: Iterator<Item = char>,
{
    if chars.next() != Some(open) {
        return;
    }
    let mut depth = 1_u32;
    while let Some(character) = chars.next() {
        if character == '\\' {
            let _ = chars.next();
            continue;
        }
        if character == open {
            depth += 1;
        } else if character == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                break;
            }
        }
    }
}

fn count_words_in_plain_text(text: &str) -> (u32, u32) {
    let mut words = 0_u32;
    let mut characters = 0_u32;
    let mut in_latin_word = false;
    for character in text.chars() {
        if character.is_whitespace() {
            in_latin_word = false;
            continue;
        }
        if is_cjk_character(character) {
            words += 1;
            characters += 1;
            in_latin_word = false;
            continue;
        }
        if character.is_alphanumeric() {
            characters += 1;
            if !in_latin_word {
                words += 1;
                in_latin_word = true;
            }
        } else {
            in_latin_word = false;
        }
    }
    (words, characters)
}

fn is_cjk_character(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
    )
}

fn parse_bib_symbols(relative: &str, content: &str) -> Vec<ProjectSymbol> {
    let line_numbers = bib_entry_line_numbers(content);
    let Ok(bibliography) = biblatex::Bibliography::parse(content) else {
        return parse_bib_symbols_from_entry_blocks(relative, content);
    };
    bibliography
        .iter()
        .map(|entry| ProjectSymbol {
            kind: "citation".to_string(),
            key: entry.key.clone(),
            detail: Some(format_bib_entry_detail(entry)),
            file: relative.to_string(),
            line: line_numbers.get(&entry.key).copied().unwrap_or(1),
        })
        .collect()
}

fn parse_bib_symbols_from_entry_blocks(relative: &str, content: &str) -> Vec<ProjectSymbol> {
    let mut symbols = Vec::new();
    for (line, entry_type, key, block) in bib_entry_blocks(content) {
        let normalized_block = normalize_bib_entry_block_for_biblatex(&block);
        if let Ok(bibliography) = biblatex::Bibliography::parse(&normalized_block) {
            symbols.extend(bibliography.iter().map(|entry| ProjectSymbol {
                kind: "citation".to_string(),
                key: entry.key.clone(),
                detail: Some(format_bib_entry_detail(entry)),
                file: relative.to_string(),
                line,
            }));
        } else {
            symbols.push(ProjectSymbol {
                kind: "citation".to_string(),
                key,
                detail: Some(entry_type),
                file: relative.to_string(),
                line,
            });
        }
    }
    symbols
}

fn bib_entry_blocks(content: &str) -> Vec<(u32, String, String, String)> {
    let mut blocks = Vec::new();
    let mut current: Option<(u32, String, String, String)> = None;
    for (line_index, line) in content.lines().enumerate() {
        if let Some((entry_type, key)) = parse_bib_entry_header(line) {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            current = Some(((line_index + 1) as u32, entry_type, key, line.to_string()));
        } else if let Some((_line, _entry_type, _key, block)) = &mut current {
            block.push('\n');
            block.push_str(line);
        }
    }
    if let Some(block) = current {
        blocks.push(block);
    }
    blocks
}

fn normalize_bib_entry_block_for_biblatex(block: &str) -> String {
    let Some(start) = block.find('@') else {
        return block.to_string();
    };
    let after_at = start + 1;
    let entry_type_len = block[after_at..]
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .map(char::len_utf8)
        .sum::<usize>();
    let mut open_index = after_at + entry_type_len;
    while matches!(block[open_index..].chars().next(), Some(character) if character.is_whitespace())
    {
        open_index += block[open_index..].chars().next().unwrap().len_utf8();
    }
    if !block[open_index..].starts_with('(') {
        return block.to_string();
    }

    let mut normalized = block.to_string();
    normalized.replace_range(open_index..open_index + 1, "{");
    if let Some((close_index, ')')) = normalized
        .char_indices()
        .rev()
        .find(|(_index, character)| !character.is_whitespace())
    {
        normalized.replace_range(close_index..close_index + 1, "}");
    }
    normalized
}

fn bib_entry_line_numbers(content: &str) -> HashMap<String, u32> {
    let mut line_numbers = HashMap::new();
    for (line_index, line) in content.lines().enumerate() {
        if let Some((_entry_type, key)) = parse_bib_entry_header(line) {
            line_numbers.entry(key).or_insert((line_index + 1) as u32);
        }
    }
    line_numbers
}

fn format_bib_entry_detail(entry: &biblatex::Entry) -> String {
    let mut pieces = vec![entry.entry_type.to_string()];
    if let Ok(authors) = entry.author() {
        let author = format_bib_authors(&authors);
        if !author.is_empty() {
            pieces.push(author);
        }
    }
    if let Some(year) = bib_entry_year(entry) {
        if !year.is_empty() {
            pieces.push(year);
        }
    }
    if let Ok(title) = entry
        .title()
        .map(|chunks| normalize_bib_field_value(&chunks.format_verbatim()))
    {
        if !title.is_empty() {
            pieces.push(truncate_bib_detail(&title, 90));
        }
    }
    pieces.join(" · ")
}

fn bib_entry_year(entry: &biblatex::Entry) -> Option<String> {
    if let Ok(date) = entry.date() {
        if let biblatex::PermissiveType::Typed(date) = date {
            let year = match date.value {
                biblatex::DateValue::At(datetime)
                | biblatex::DateValue::After(datetime)
                | biblatex::DateValue::Before(datetime) => datetime.year,
                biblatex::DateValue::Between(start, _end) => start.year,
            };
            return Some(year.to_string());
        }
    }
    entry
        .get("year")
        .map(|chunks| normalize_bib_field_value(&chunks.format_verbatim()))
        .filter(|year| !year.is_empty())
}

fn normalize_bib_field_value(value: &str) -> String {
    value
        .chars()
        .filter(|character| !matches!(character, '{' | '}'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_bib_authors(authors: &[biblatex::Person]) -> String {
    let authors = authors
        .iter()
        .map(format_bib_author_name)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    match authors.as_slice() {
        [] => String::new(),
        [single] => single.clone(),
        [first, second] => format!("{first} & {second}"),
        [first, ..] => format!("{first} et al."),
    }
}

fn format_bib_author_name(author: &biblatex::Person) -> String {
    let family = normalize_bib_field_value(&author.name);
    if !family.is_empty() {
        return family;
    }
    normalize_bib_field_value(&author.given_name)
}

fn truncate_bib_detail(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn parse_bib_entry_header(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix('@')?;
    let entry_type = rest
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .collect::<String>()
        .to_lowercase();
    if entry_type.is_empty() || matches!(entry_type.as_str(), "comment" | "preamble" | "string") {
        return None;
    }
    let rest = rest[entry_type.len()..].trim_start();
    let rest = rest.strip_prefix('{').or_else(|| rest.strip_prefix('('))?;
    let key = rest
        .chars()
        .take_while(|character| !matches!(character, ',' | '}' | ')' | ' ' | '\t' | '\r' | '\n'))
        .collect::<String>();
    if key.is_empty() {
        None
    } else {
        Some((entry_type, key))
    }
}

fn strip_latex_comment(line: &str) -> String {
    let mut result = String::new();
    let mut slash_count = 0;
    for character in line.chars() {
        if character == '\\' {
            slash_count += 1;
            result.push(character);
            continue;
        }
        if character == '%' && slash_count % 2 == 0 {
            break;
        }
        slash_count = 0;
        result.push(character);
    }
    result
}

fn latex_comment_text(line: &str) -> Option<String> {
    let mut slash_count = 0;
    for (index, character) in line.char_indices() {
        if character == '\\' {
            slash_count += 1;
            continue;
        }
        if character == '%' && slash_count % 2 == 0 {
            return Some(line[index + character.len_utf8()..].trim().to_string());
        }
        slash_count = 0;
    }
    None
}

fn parse_todo_comment(comment: &str) -> Option<(String, String, bool)> {
    let mut trimmed = comment.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut resolved = false;
    loop {
        let lower = trimmed.to_ascii_lowercase();
        let next = if lower.starts_with("resolved") {
            Some(
                trimmed["resolved".len()..].trim_start_matches(|value: char| {
                    matches!(value, ':' | '-' | '：' | '—' | ' ' | '\t')
                }),
            )
        } else if trimmed.starts_with("已解决") {
            Some(trimmed["已解决".len()..].trim_start_matches(|value: char| {
                matches!(value, ':' | '-' | '：' | '—' | ' ' | '\t')
            }))
        } else if trimmed.starts_with("完成") {
            Some(trimmed["完成".len()..].trim_start_matches(|value: char| {
                matches!(value, ':' | '-' | '：' | '—' | ' ' | '\t')
            }))
        } else {
            None
        };
        let Some(next_trimmed) = next else {
            break;
        };
        if next_trimmed.is_empty() || next_trimmed == trimmed {
            break;
        }
        resolved = true;
        trimmed = next_trimmed;
    }
    let lower = trimmed.to_ascii_lowercase();
    if matches!(lower.as_str(), "review-end" | "end-review") || lower.starts_with("review-end ") {
        return None;
    }
    let markers = [
        ("todo", "TODO"),
        ("fixme", "FIXME"),
        ("review", "REVIEW"),
        ("note", "NOTE"),
        ("待办", "TODO"),
        ("修复", "FIXME"),
        ("注意", "NOTE"),
        ("批注", "NOTE"),
    ];
    for (marker, kind) in markers {
        let matches_marker = if marker.is_ascii() {
            lower.starts_with(marker)
        } else {
            trimmed.starts_with(marker)
        };
        if !matches_marker {
            continue;
        }
        let rest = if marker.is_ascii() {
            &trimmed[marker.len()..]
        } else {
            &trimmed[marker.len()..]
        };
        let message = rest
            .trim_start_matches(|value: char| matches!(value, ':' | '-' | '：' | '—' | ' ' | '\t'))
            .trim();
        return Some((
            kind.to_string(),
            if message.is_empty() {
                trimmed.to_string()
            } else {
                message.to_string()
            },
            resolved,
        ));
    }
    None
}

fn parse_heading_outline(line: &str) -> Option<(String, String, u8)> {
    let commands = [
        ("part", 1_u8),
        ("chapter", 2),
        ("section", 3),
        ("subsection", 4),
        ("subsubsection", 5),
        ("paragraph", 6),
        ("subparagraph", 7),
    ];
    let trimmed = line.trim_start();
    for (command, level) in commands {
        if let Some(title) = parse_latex_command_argument(trimmed, command) {
            return Some((
                command.to_string(),
                cleanup_latex_outline_title(&title),
                level,
            ));
        }
    }
    None
}

fn find_latex_command_argument(line: &str, command: &str) -> Option<String> {
    find_latex_command_arguments(line, command)
        .into_iter()
        .next()
}

fn find_latex_command_arguments(line: &str, command: &str) -> Vec<String> {
    let needle = format!("\\{command}");
    let mut arguments = Vec::new();
    for (index, _) in line.match_indices(&needle) {
        let rest = &line[index..];
        if let Some(argument) = parse_latex_command_argument(rest, command) {
            arguments.push(cleanup_latex_outline_title(&argument));
        }
    }
    arguments
}

fn find_latex_environment_content(content: &str, environment: &str) -> Option<String> {
    let begin = format!("\\begin{{{environment}}}");
    let end = format!("\\end{{{environment}}}");
    let start = content.find(&begin)? + begin.len();
    let rest = &content[start..];
    let end_index = rest.find(&end)?;
    Some(rest[..end_index].to_string())
}

fn parse_latex_command_argument(line: &str, command: &str) -> Option<String> {
    let prefix = format!("\\{command}");
    let mut rest = line.strip_prefix(&prefix)?;
    if rest
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
    {
        return None;
    }
    rest = rest.trim_start();
    if let Some(next) = rest.strip_prefix('*') {
        rest = next.trim_start();
    }
    loop {
        if !rest.starts_with('[') {
            break;
        }
        let end = rest.find(']')?;
        rest = rest[end + 1..].trim_start();
    }
    extract_braced_argument(rest)
}

fn extract_braced_argument(input: &str) -> Option<String> {
    let rest = input.trim_start();
    if !rest.starts_with('{') {
        return None;
    }
    let mut depth = 0_i32;
    let mut escaped = false;
    let mut value = String::new();
    for character in rest.chars() {
        if escaped {
            if depth > 0 {
                value.push(character);
            }
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            if depth > 0 {
                value.push(character);
            }
            continue;
        }
        if character == '{' {
            depth += 1;
            if depth > 1 {
                value.push(character);
            }
            continue;
        }
        if character == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(value);
            }
            if depth > 0 {
                value.push(character);
            }
            continue;
        }
        if depth > 0 {
            value.push(character);
        }
    }
    None
}

fn cleanup_latex_outline_title(value: &str) -> String {
    value
        .trim()
        .replace("\\_", "_")
        .replace("\\%", "%")
        .replace("\\&", "&")
        .chars()
        .take(180)
        .collect()
}

fn cleanup_latex_context_text(value: &str, limit: usize) -> String {
    let unescaped = value
        .replace("\\_", "_")
        .replace("\\%", "%")
        .replace("\\&", "&")
        .replace("\\#", "#")
        .replace("\\$", "$")
        .replace("\\{", "{")
        .replace("\\}", "}")
        .replace('~', " ");
    let compact = unescaped.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(limit).collect()
}

fn split_project_keywords(value: &str) -> Vec<String> {
    value
        .split(|character| matches!(character, ',' | ';' | '\n'))
        .map(|keyword| cleanup_latex_context_text(keyword, 80))
        .filter(|keyword| !keyword.is_empty())
        .collect()
}

fn relative_slash(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|err| format!("failed to make relative path: {err}"))?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn normalized_project_template(template: Option<&str>) -> Result<&'static str, String> {
    match template.unwrap_or("article").trim().to_lowercase().as_str() {
        "" | "article" | "paper" => Ok("article"),
        "preprint" | "arxiv" | "draft" => Ok("preprint"),
        "blank" => Ok("blank"),
        "chinese" | "ctex" | "中文" => Ok("chinese"),
        "chinese-multifile" | "chinese_multifile" | "cn-multifile" | "中文多文件" => {
            Ok("chinese-multifile")
        }
        "multifile" | "multi-file" | "multi_file" | "multi" => Ok("multifile"),
        "beamer" | "slides" | "presentation" => Ok("beamer"),
        value => Err(format!("未知项目模板：{value}")),
    }
}

fn template_main_tex(template: &str, project_name: &str) -> String {
    match template {
        "blank" => format!(
            "\\documentclass[11pt]{{article}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\nStart writing here.\n\n\\end{{document}}\n"
        ),
        "preprint" => format!(
            "\\documentclass[11pt]{{article}}\n\\usepackage{{amsmath,amssymb,graphicx,booktabs,hyperref}}\n\\usepackage[margin=1in]{{geometry}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\n\\begin{{abstract}}\nSummarize the problem, method, and main result in one concise paragraph.\n\\end{{abstract}}\n\n\\section{{Introduction}}\nMotivate the problem and cite related work \\cite{{sample}}.\n\n\\section{{Method}}\nDescribe the model, algorithm, or proof idea.\n\n\\section{{Experiments}}\nReport datasets, baselines, and metrics. Table~\\ref{{tab:results}} is a starting point.\n\n\\begin{{table}}[t]\n  \\centering\n  \\begin{{tabular}}{{lcc}}\n    \\toprule\n    Method & Metric A & Metric B \\\\\n    \\midrule\n    Baseline & -- & -- \\\\\n    Proposed & -- & -- \\\\\n    \\bottomrule\n  \\end{{tabular}}\n  \\caption{{Replace with the main quantitative result.}}\n  \\label{{tab:results}}\n\\end{{table}}\n\n\\section{{Conclusion}}\nSummarize what changed and what remains open.\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\\end{{document}}\n"
        ),
        "chinese" => format!(
            "\\documentclass[UTF8,zihao=-4]{{ctexart}}\n\\usepackage{{amsmath,amssymb,graphicx,hyperref}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\n\\section{{引言}}\n从这里开始写作。这里可以引用参考文献 \\cite{{sample}}。\n\n\\section{{方法}}\n描述你的方法、实验设置或理论推导。\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\\end{{document}}\n"
        ),
        "chinese-multifile" => format!(
            "\\documentclass[UTF8,zihao=-4]{{ctexart}}\n\\usepackage{{amsmath,amssymb,graphicx,booktabs,hyperref}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\n\\input{{sections/intro}}\n\\input{{sections/method}}\n\\input{{sections/experiments}}\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\\end{{document}}\n"
        ),
        "multifile" => format!(
            "\\documentclass[11pt]{{article}}\n\\usepackage{{amsmath,amssymb,graphicx,hyperref}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\n\\input{{sections/intro}}\n\\input{{sections/method}}\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\\end{{document}}\n"
        ),
        "beamer" => format!(
            "\\documentclass[aspectratio=169]{{beamer}}\n\\usetheme{{Madrid}}\n\\usecolortheme{{default}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\n\\begin{{frame}}\n  \\titlepage\n\\end{{frame}}\n\n\\begin{{frame}}{{Outline}}\n  \\tableofcontents\n\\end{{frame}}\n\n\\section{{Motivation}}\n\\begin{{frame}}{{Motivation}}\n  \\begin{{itemize}}\n    \\item What problem are we solving?\n    \\item Why does it matter now?\n    \\item What is the key idea?\n  \\end{{itemize}}\n\\end{{frame}}\n\n\\section{{Method}}\n\\begin{{frame}}{{Method}}\n  Add the core method or theorem here.\n\\end{{frame}}\n\n\\section{{Results}}\n\\begin{{frame}}{{Results}}\n  Replace this slide with the main result.\n\\end{{frame}}\n\n\\end{{document}}\n"
        ),
        _ => format!(
            "\\documentclass[11pt]{{article}}\n\\usepackage{{fontspec}}\n\\usepackage{{hyperref}}\n\\title{{{project_name}}}\n\\author{{}}\n\\date{{\\today}}\n\n\\begin{{document}}\n\\maketitle\n\n\\section{{Introduction}}\nStart writing here. Cite an example with \\cite{{sample}}.\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\\end{{document}}\n"
        ),
    }
}

fn template_bibtex(template: &str) -> Option<&'static str> {
    if matches!(template, "blank" | "beamer") {
        return None;
    }
    Some(
    "@article{sample,\n  title = {A Sample Reference},\n  author = {Doe, Jane},\n  journal = {Journal of Local Drafts},\n  year = {2026}\n}\n"
    )
}

fn template_extra_files(template: &str) -> Vec<(&'static str, &'static str)> {
    if template == "multifile" {
        return vec![
            (
                "sections/intro.tex",
                "\\section{Introduction}\nThis project is split across multiple files. Add background and motivation here.\n\n\\label{sec:intro}\n",
            ),
            (
                "sections/method.tex",
                "\\section{Method}\nDescribe the main method here.\n\n\\label{sec:method}\n",
            ),
        ];
    }
    if template == "chinese-multifile" {
        return vec![
            (
                "sections/intro.tex",
                "\\section{引言}\n这里写研究背景、问题定义和主要贡献。可以引用参考文献 \\cite{sample}。\n\n\\label{sec:intro}\n",
            ),
            (
                "sections/method.tex",
                "\\section{方法}\n这里描述方法、系统设计、理论推导或实验设置。\n\n\\label{sec:method}\n",
            ),
            (
                "sections/experiments.tex",
                "\\section{实验}\n这里写数据集、评价指标、对比方法和主要结果。\n\n\\label{sec:experiments}\n",
            ),
        ];
    }
    Vec::new()
}

fn default_new_file_content(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|value| value.to_str()) {
        Some("tex") => "% New LaTeX file\n\n",
        Some("bib") => "",
        Some("sty") => "% LaTeX style file\n\n",
        Some("cls") => "% LaTeX class file\n\n",
        Some("md") => "# Notes\n\n",
        _ => "",
    }
}

fn tool_status(
    name: &str,
    version_args: &[&str],
    extra_paths: &[&str],
    install_hint: Option<&str>,
) -> ToolStatus {
    if let Some(path) = find_executable(name, extra_paths) {
        let version = Command::new(&path)
            .args(version_args)
            .output()
            .ok()
            .map(|output| {
                let mut text = String::new();
                text.push_str(&String::from_utf8_lossy(&output.stdout));
                text.push_str(&String::from_utf8_lossy(&output.stderr));
                text.lines().next().unwrap_or("").trim().to_string()
            })
            .filter(|line| !line.is_empty());
        ToolStatus {
            name: name.to_string(),
            found: true,
            path: Some(path.to_string_lossy().to_string()),
            version,
            install_hint: None,
        }
    } else {
        ToolStatus {
            name: name.to_string(),
            found: false,
            path: None,
            version: None,
            install_hint: install_hint.map(ToString::to_string),
        }
    }
}

fn with_extension_if_missing(mut path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension(extension);
    }
    path
}

fn copy_pdf_export(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() && !target.is_file() {
        return Err("导出目标不是文件。".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create export directory: {err}"))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|err| format!("导出 PDF 失败：{err}"))
}

fn export_project_zip_to_path(
    root: &Path,
    settings: &ProjectSettings,
    target: &Path,
) -> Result<(), String> {
    if target.exists() && !target.is_file() {
        return Err("导出目标不是文件。".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create export directory: {err}"))?;
    }

    let project_name = export_project_name(root);
    let skip_target = if target.exists() {
        fs::canonicalize(target).ok()
    } else {
        None
    };
    let temp_target = target.with_extension(format!(
        "{}.tmp-{}",
        target
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("zip"),
        Uuid::new_v4()
    ));
    let write_result = write_project_zip_archive(
        root,
        settings,
        &project_name,
        &temp_target,
        skip_target.as_deref(),
    );
    if let Err(err) = write_result {
        let _ = fs::remove_file(&temp_target);
        return Err(err);
    }
    if target.exists() {
        fs::remove_file(target)
            .map_err(|err| format!("failed to replace existing export file: {err}"))?;
    }
    fs::rename(&temp_target, target).map_err(|err| format!("failed to save export ZIP: {err}"))
}

fn write_project_zip_archive(
    root: &Path,
    settings: &ProjectSettings,
    project_name: &str,
    target: &Path,
    skip_target: Option<&Path>,
) -> Result<(), String> {
    let file =
        fs::File::create(target).map_err(|err| format!("failed to create export ZIP: {err}"))?;
    let mut writer = ZipWriter::new(file);
    let file_options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let dir_options = file_options.unix_permissions(0o755);
    let build_dir = normalize_relative_path(Path::new(&settings.build_dir));
    let main_pdf = Path::new(&settings.main_file)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|stem| format!("{stem}.pdf"));
    let walker = WalkDir::new(root).into_iter().filter_entry(|entry| {
        !should_skip_export_entry(root, entry, &build_dir, main_pdf.as_deref())
    });

    for entry in walker {
        let entry = entry.map_err(|err| format!("failed to walk project for ZIP export: {err}"))?;
        let path = entry.path();
        if path == root
            || entry.file_type().is_symlink()
            || !entry.file_type().is_file() && !entry.file_type().is_dir()
        {
            continue;
        }
        if let Some(skip_target) = skip_target {
            if let Ok(canonical) = fs::canonicalize(path) {
                if canonical == skip_target {
                    continue;
                }
            }
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|err| format!("failed to export relative path: {err}"))?;
        let normalized = normalize_relative_path(relative);
        if normalized.is_empty() {
            continue;
        }
        let archive_path = format!("{project_name}/{normalized}");
        validate_zip_entry_path(&archive_path)?;
        if entry.file_type().is_dir() {
            writer
                .add_directory(format!("{archive_path}/"), dir_options)
                .map_err(|err| format!("failed to add ZIP directory {normalized}: {err}"))?;
            continue;
        }
        writer
            .start_file(&archive_path, file_options)
            .map_err(|err| format!("failed to add ZIP file {normalized}: {err}"))?;
        let mut source =
            fs::File::open(path).map_err(|err| format!("failed to read export file: {err}"))?;
        io::copy(&mut source, &mut writer)
            .map_err(|err| format!("failed to write ZIP file {normalized}: {err}"))?;
    }
    writer
        .finish()
        .map(|_| ())
        .map_err(|err| format!("failed to finish export ZIP: {err}"))
}

fn should_skip_export_entry(
    root: &Path,
    entry: &DirEntry,
    build_dir: &str,
    main_pdf: Option<&str>,
) -> bool {
    let path = entry.path();
    if path == root {
        return false;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    let normalized = normalize_relative_path(relative);
    if normalized.is_empty() {
        return false;
    }
    let file_name = entry.file_name().to_string_lossy();
    if matches!(
        file_name.as_ref(),
        ".git" | ".latex-studio" | ".latex-studio.json"
    ) {
        return true;
    }
    if !build_dir.is_empty()
        && (normalized == build_dir || normalized.starts_with(&format!("{build_dir}/")))
    {
        return true;
    }
    if entry.file_type().is_file() {
        if is_latex_generated_file(&normalized) {
            return true;
        }
        if Some(file_name.as_ref()) == main_pdf && !normalized.contains('/') {
            return true;
        }
    }
    false
}

fn is_latex_generated_file(path: &str) -> bool {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if file_name.ends_with(".synctex.gz") || file_name.ends_with(".run.xml") {
        return true;
    }
    matches!(
        Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str()),
        Some(
            "aux"
                | "bbl"
                | "bcf"
                | "blg"
                | "brf"
                | "fdb_latexmk"
                | "fls"
                | "lof"
                | "log"
                | "lot"
                | "nav"
                | "out"
                | "snm"
                | "toc"
                | "xdv"
        )
    )
}

fn export_project_name(root: &Path) -> String {
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("latex-project");
    sanitize_export_name(name)
}

fn sanitize_export_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.') {
                value
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if sanitized.is_empty() {
        "latex-project".to_string()
    } else {
        sanitized
    }
}

fn import_project_zip_to_root(source_zip: &Path, target_root: &Path) -> Result<(), String> {
    if target_root.exists() {
        return Err(format!(
            "目标项目目录已存在：{}",
            target_root.to_string_lossy()
        ));
    }
    if let Some(parent) = target_root.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create project directory: {err}"))?;
    }

    let staging_parent =
        std::env::temp_dir().join(format!("latex-studio-import-{}", Uuid::new_v4()));
    let staging_root = staging_parent.join("extract");
    fs::create_dir_all(&staging_root)
        .map_err(|err| format!("failed to create import staging directory: {err}"))?;

    if let Err(err) = extract_zip_archive_to_directory(source_zip, &staging_root) {
        let _ = fs::remove_dir_all(&staging_parent);
        return Err(err);
    }

    let content_root = detect_import_content_root(&staging_root)?;
    fs::create_dir_all(target_root)
        .map_err(|err| format!("failed to create imported project directory: {err}"))?;
    let copy_result = copy_imported_project_sources(&content_root, target_root);
    let _ = fs::remove_dir_all(&staging_parent);
    copy_result
}

#[cfg(test)]
fn validate_zip_archive_entries(source_zip: &Path) -> Result<(), String> {
    let mut archive = open_zip_archive(source_zip)?;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|err| format!("ZIP 文件无法读取或已损坏：{err}"))?;
        validate_zip_entry_path(file.name())?;
    }
    Ok(())
}

fn extract_zip_archive_to_directory(source_zip: &Path, target_root: &Path) -> Result<(), String> {
    let mut archive = open_zip_archive(source_zip)?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| format!("ZIP 文件无法读取或已损坏：{err}"))?;
        let entry_name = file.name().to_string();
        validate_zip_entry_path(&entry_name)?;
        if file.is_symlink() {
            continue;
        }
        let Some(relative) = zip_entry_relative_path(&entry_name)? else {
            continue;
        };
        let target = target_root.join(&relative);
        if !target.starts_with(target_root) {
            return Err(format!("ZIP 路径不安全：{entry_name}"));
        }
        if file.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|err| format!("failed to create ZIP import directory: {err}"))?;
        } else if file.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("failed to create ZIP import directory: {err}"))?;
            }
            let mut output = fs::File::create(&target)
                .map_err(|err| format!("failed to create imported ZIP file: {err}"))?;
            io::copy(&mut file, &mut output)
                .map_err(|err| format!("failed to extract ZIP file {entry_name}: {err}"))?;
        }
    }
    Ok(())
}

fn open_zip_archive(source_zip: &Path) -> Result<ZipArchive<fs::File>, String> {
    let file = fs::File::open(source_zip)
        .map_err(|err| format!("无法读取 ZIP 文件 {}：{err}", source_zip.to_string_lossy()))?;
    ZipArchive::new(file).map_err(|err| format!("ZIP 文件无法读取或已损坏：{err}"))
}

fn validate_zip_entry_path(raw_entry: &str) -> Result<(), String> {
    if raw_entry.contains('\0') {
        return Err("ZIP 文件包含非法路径。".to_string());
    }
    let normalized = raw_entry.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("ZIP 路径不安全：{raw_entry}"));
    }
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(format!("ZIP 路径不安全：{raw_entry}"));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("ZIP 路径不安全：{raw_entry}"));
            }
        }
    }
    Ok(())
}

fn zip_entry_relative_path(raw_entry: &str) -> Result<Option<PathBuf>, String> {
    let normalized = raw_entry.replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let mut relative = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(value) => relative.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("ZIP 路径不安全：{raw_entry}"));
            }
        }
    }
    if relative.as_os_str().is_empty() {
        Ok(None)
    } else {
        Ok(Some(relative))
    }
}

fn detect_import_content_root(staging_root: &Path) -> Result<PathBuf, String> {
    let visible_entries = sorted_read_dir(staging_root)?
        .into_iter()
        .filter(|entry| !should_skip_import_dir_entry(entry))
        .collect::<Vec<_>>();
    if visible_entries.len() == 1 {
        let only = visible_entries[0].path();
        if only.is_dir() {
            return Ok(only);
        }
    }
    Ok(staging_root.to_path_buf())
}

fn copy_imported_project_sources(source_root: &Path, target_root: &Path) -> Result<(), String> {
    let source_root = fs::canonicalize(source_root)
        .map_err(|err| format!("failed to resolve import source: {err}"))?;
    let walker = WalkDir::new(&source_root)
        .into_iter()
        .filter_entry(|entry| !should_skip_import_walk_entry(entry));
    for entry in walker {
        let entry = entry.map_err(|err| format!("failed to walk imported project: {err}"))?;
        let path = entry.path();
        if path == source_root {
            continue;
        }
        if entry.file_type().is_symlink() {
            continue;
        }
        let relative = path
            .strip_prefix(&source_root)
            .map_err(|err| format!("failed to copy import relative path: {err}"))?;
        validate_zip_entry_path(&relative.to_string_lossy())?;
        let target = target_root.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)
                .map_err(|err| format!("failed to create imported directory: {err}"))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("failed to create imported directory: {err}"))?;
            }
            fs::copy(path, &target).map_err(|err| {
                format!(
                    "failed to copy imported file {}: {err}",
                    relative.to_string_lossy()
                )
            })?;
        }
    }
    Ok(())
}

fn should_skip_import_dir_entry(entry: &fs::DirEntry) -> bool {
    matches!(
        entry.file_name().to_str(),
        Some("__MACOSX") | Some(".DS_Store") | Some(".git") | Some(".latex-studio")
    )
}

fn should_skip_import_walk_entry(entry: &DirEntry) -> bool {
    matches!(
        entry.file_name().to_str(),
        Some("__MACOSX")
            | Some(".DS_Store")
            | Some(".git")
            | Some(".latex-studio")
            | Some(".latex-studio.json")
    )
}

fn open_path_with_system(path: &Path, reveal: bool) -> Result<(), String> {
    let mut command = Command::new("open");
    if reveal {
        command.arg("-R");
    }
    let status = command
        .arg(path)
        .status()
        .map_err(|err| format!("无法打开 PDF：{err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("系统打开 PDF 失败：{status}"))
    }
}

fn find_executable(name: &str, extra_paths: &[&str]) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|path| path.join(name)));
    }
    candidates.extend(extra_paths.iter().map(PathBuf::from));
    candidates.into_iter().find(|path| is_executable(path))
}

fn prepend_child_path(command: &mut Command, entries: &[Option<PathBuf>]) {
    let mut paths = Vec::new();
    for entry in entries.iter().flatten() {
        if !paths.contains(entry) {
            paths.push(entry.clone());
        }
    }
    if let Some(existing) = std::env::var_os("PATH") {
        for entry in std::env::split_paths(&existing) {
            if !paths.contains(&entry) {
                paths.push(entry);
            }
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn expected_pdf_path(build_dir: &Path, main_path: &Path) -> PathBuf {
    let stem = main_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("main");
    build_dir.join(format!("{stem}.pdf"))
}

fn expected_log_path(build_dir: &Path, main_path: &Path) -> PathBuf {
    let stem = main_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("main");
    build_dir.join(format!("{stem}.log"))
}

fn expected_synctex_paths(build_dir: &Path, main_path: &Path) -> Vec<PathBuf> {
    let stem = main_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("main");
    vec![
        build_dir.join(format!("{stem}.synctex.gz")),
        build_dir.join(format!("{stem}.synctex")),
    ]
}

fn run_synctex_view(
    synctex: &Path,
    build_dir: &Path,
    pdf_path: &Path,
    line: u32,
    column: u32,
    input_path: &str,
) -> Result<SynctexLocation, String> {
    let selector = format!("{line}:{column}:{input_path}");
    let mut command = Command::new(synctex);
    command
        .arg("view")
        .arg("-i")
        .arg(&selector)
        .arg("-o")
        .arg(pdf_path)
        .arg("-d")
        .arg(build_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepend_child_path(
        &mut command,
        &[
            synctex.parent().map(Path::to_path_buf),
            Some(PathBuf::from("/Library/TeX/texbin")),
        ],
    );
    let output = command
        .output()
        .map_err(|err| format!("启动 SyncTeX 失败：{err}"))?;
    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if let Some(location) = parse_synctex_forward_output(&combined) {
        return Ok(location);
    }
    let detail = compact_process_output(&combined);
    if output.status.success() {
        Err(if detail.is_empty() {
            "SyncTeX 没有找到当前源码位置对应的 PDF 区域。".to_string()
        } else {
            format!("SyncTeX 没有找到对应位置：{detail}")
        })
    } else if detail.is_empty() {
        Err("SyncTeX 定位失败。请确认项目刚刚成功编译。".to_string())
    } else {
        Err(format!("SyncTeX 定位失败：{detail}"))
    }
}

fn run_synctex_edit(
    synctex: &Path,
    build_dir: &Path,
    pdf_path: &Path,
    page: u32,
    x: f64,
    y: f64,
) -> Result<SynctexSourceLocation, String> {
    let selector = format!("{page}:{x:.3}:{y:.3}:{}", pdf_path.to_string_lossy());
    let mut command = Command::new(synctex);
    command
        .arg("edit")
        .arg("-o")
        .arg(&selector)
        .arg("-d")
        .arg(build_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepend_child_path(
        &mut command,
        &[
            synctex.parent().map(Path::to_path_buf),
            Some(PathBuf::from("/Library/TeX/texbin")),
        ],
    );
    let output = command
        .output()
        .map_err(|err| format!("启动 SyncTeX 失败：{err}"))?;
    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if let Some(location) = parse_synctex_reverse_output(&combined) {
        return Ok(location);
    }
    let detail = compact_process_output(&combined);
    if output.status.success() {
        Err(if detail.is_empty() {
            "SyncTeX 没有找到 PDF 点击位置对应的源码。".to_string()
        } else {
            format!("SyncTeX 没有找到对应源码：{detail}")
        })
    } else if detail.is_empty() {
        Err("SyncTeX 反向定位失败。请确认项目刚刚成功编译。".to_string())
    } else {
        Err(format!("SyncTeX 反向定位失败：{detail}"))
    }
}

#[derive(Default)]
struct SynctexRecord {
    page: Option<u32>,
    x: Option<f64>,
    y: Option<f64>,
    h: Option<f64>,
    v: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
}

impl SynctexRecord {
    fn into_location(self) -> Option<SynctexLocation> {
        let page = self.page?;
        let x = self.x?;
        let y = self.y?;
        Some(SynctexLocation {
            page,
            x,
            y,
            h: self.h.unwrap_or(x),
            v: self.v.unwrap_or(y),
            width: self.width.unwrap_or(0.0).abs(),
            height: self.height.unwrap_or(0.0).abs(),
        })
    }
}

fn parse_synctex_forward_output(output: &str) -> Option<SynctexLocation> {
    let mut record = SynctexRecord::default();
    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.starts_with("Output:") {
            if let Some(location) = record.into_location() {
                return Some(location);
            }
            record = SynctexRecord::default();
            continue;
        }
        if let Some(value) = line.strip_prefix("Page:") {
            record.page = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("x:") {
            record.x = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("y:") {
            record.y = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("h:") {
            record.h = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("v:") {
            record.v = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("W:") {
            record.width = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("H:") {
            record.height = value.trim().parse().ok();
        }
    }
    record.into_location()
}

#[derive(Default)]
struct SynctexSourceRecord {
    input: Option<String>,
    line: Option<u32>,
    column: Option<i32>,
}

impl SynctexSourceRecord {
    fn into_location(self) -> Option<SynctexSourceLocation> {
        let file = self.input?;
        let line = self.line?;
        Some(SynctexSourceLocation {
            file,
            line: line.max(1),
            column: self.column.and_then(|value| {
                if value >= 0 {
                    Some((value as u32) + 1)
                } else {
                    None
                }
            }),
        })
    }
}

fn parse_synctex_reverse_output(output: &str) -> Option<SynctexSourceLocation> {
    let mut record = SynctexSourceRecord::default();
    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.starts_with("Output:") {
            if let Some(location) = record.into_location() {
                return Some(location);
            }
            record = SynctexSourceRecord::default();
        } else if let Some(value) = line.strip_prefix("Input:") {
            record.input = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("Line:") {
            record.line = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("Column:") {
            record.column = value.trim().parse().ok();
        }
    }
    record.into_location()
}

fn canonicalize_synctex_input(root: &Path, input: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(input.trim());
    let path = if raw.is_absolute() {
        raw
    } else {
        root.join(raw)
    };
    let canonical = fs::canonicalize(&path).map_err(|err| {
        format!(
            "SyncTeX 返回的源码文件无法读取 {}：{err}",
            path.to_string_lossy()
        )
    })?;
    ensure_under_root(root, &canonical)?;
    if !canonical.is_file() {
        return Err("SyncTeX 返回的源码不是文件。".to_string());
    }
    Ok(canonical)
}

fn compact_process_output(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty() && !line.starts_with("This is SyncTeX command line utility")
        })
        .take(6)
        .collect::<Vec<_>>()
        .join(" ")
}

fn append_latex_log_file(log: &mut String, log_path: &Path) {
    let Ok(tex_log) = fs::read_to_string(log_path) else {
        return;
    };
    if !log.ends_with('\n') {
        log.push('\n');
    }
    log.push_str("\n--- LaTeX .log ---\n");
    log.push_str(&tex_log);
}

fn parse_latex_diagnostics(log: &str) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut current_source_file: Option<String> = None;
    for raw_line in log.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with('!') && line.contains('(') {
            if let Some(file) = parse_opened_source_file(line) {
                current_source_file = Some(file);
            }
        } else if let Some(value) = line.strip_prefix("**") {
            let file = normalize_latex_log_file(value.trim());
            if is_latex_source_file(&file) {
                current_source_file = Some(file);
            }
        }
        if let Some(line_number) = parse_tex_source_line(line) {
            if let Some(last) = diagnostics.last_mut() {
                if last.line.is_none() {
                    last.line = Some(line_number);
                }
                if last.file.is_none() {
                    last.file = current_source_file.clone();
                }
            }
            continue;
        }
        if let Some(diagnostic) = parse_file_line_diagnostic(line) {
            push_unique_diagnostic(&mut diagnostics, diagnostic);
        } else if line.contains("LaTeX Warning:") {
            push_unique_diagnostic(
                &mut diagnostics,
                Diagnostic {
                    severity: DiagnosticSeverity::Warning,
                    file: current_source_file.clone(),
                    line: parse_input_line(line),
                    column: None,
                    message: line.to_string(),
                    hint: None,
                },
            );
        } else if line.starts_with("!") {
            let text = friendly_latex_diagnostic_text(line.trim_start_matches('!').trim());
            push_unique_diagnostic(
                &mut diagnostics,
                Diagnostic {
                    severity: DiagnosticSeverity::Error,
                    file: current_source_file.clone(),
                    line: None,
                    column: None,
                    message: text.message,
                    hint: text.hint,
                },
            );
        }
    }
    diagnostics
}

fn parse_file_line_diagnostic(line: &str) -> Option<Diagnostic> {
    let mut parts = line.splitn(3, ':');
    let file = normalize_latex_log_file(parts.next()?.trim());
    let line_number = parts.next()?.trim().parse::<u32>().ok()?;
    let text = friendly_latex_diagnostic_text(parts.next()?.trim());
    if file.is_empty() || text.message.is_empty() {
        return None;
    }
    let lowercase = text.message.to_ascii_lowercase();
    let severity = if lowercase.contains("warning") {
        DiagnosticSeverity::Warning
    } else {
        DiagnosticSeverity::Error
    };
    Some(Diagnostic {
        severity,
        file: Some(file),
        line: Some(line_number),
        column: None,
        message: text.message,
        hint: text.hint,
    })
}

fn parse_opened_source_file(line: &str) -> Option<String> {
    if let Some(value) = line.strip_prefix("**") {
        let file = normalize_latex_log_file(value.trim());
        if is_latex_source_file(&file) {
            return Some(file);
        }
    }

    for token in line.split_whitespace() {
        let candidate = normalize_latex_log_file(
            token
                .trim_start_matches('(')
                .trim_end_matches(|value| value == ')' || value == ','),
        );
        if is_latex_source_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn parse_tex_source_line(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("l.")?;
    let digits = rest
        .chars()
        .take_while(|value| value.is_ascii_digit())
        .collect::<String>();
    digits.parse().ok()
}

fn normalize_latex_log_file(file: &str) -> String {
    file.trim_matches('`')
        .trim_matches('\'')
        .trim_start_matches("./")
        .to_string()
}

fn is_latex_source_file(file: &str) -> bool {
    matches!(
        Path::new(file).extension().and_then(|value| value.to_str()),
        Some("tex" | "bib" | "sty" | "cls")
    )
}

struct LatexDiagnosticText {
    message: String,
    hint: Option<String>,
}

fn friendly_latex_diagnostic_text(message: &str) -> LatexDiagnosticText {
    let trimmed = message.trim();
    LatexDiagnosticText {
        message: trimmed.to_string(),
        hint: missing_latex_file_name(trimmed).and_then(|file| missing_latex_file_hint(&file)),
    }
}

fn missing_latex_file_name(message: &str) -> Option<String> {
    let lowercase = message.to_ascii_lowercase();
    if !lowercase.contains("not found") {
        return None;
    }

    for marker in ["File `", "File '", "file `", "file '"] {
        let Some(start) = message.find(marker) else {
            continue;
        };
        let rest = &message[start + marker.len()..];
        let end = rest
            .find(|value| value == '\'' || value == '`')
            .unwrap_or(rest.len());
        let file = rest[..end].trim();
        if !file.is_empty() {
            return Some(file.to_string());
        }
    }
    None
}

fn missing_latex_file_hint(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    let stem = Path::new(&lower)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(lower.as_str());

    if matches!(lower.as_str(), "xecjk.sty" | "ctex.sty" | "ctexart.cls") {
        return Some("当前 TeX 环境缺少中文排版组件。建议安装完整 MacTeX；如果使用 BasicTeX，可在终端运行 `sudo tlmgr install xecjk ctex fontspec fandol` 后重新编译。".to_string());
    }

    if lower == "fontspec.sty" {
        return Some("`fontspec` 通常需要 XeLaTeX 或 LuaLaTeX。请在项目设置中选择 XeLaTeX/LuaLaTeX，并确认 TeX Live 已安装 fontspec。".to_string());
    }

    if lower.ends_with(".sty") {
        return Some(format!(
            "缺少 LaTeX 宏包 `{stem}`。如果使用 BasicTeX，可尝试运行 `sudo tlmgr install {stem}`；也可以安装完整 MacTeX。"
        ));
    }

    if lower.ends_with(".cls") || lower.ends_with(".bst") {
        return Some(format!(
            "缺少模板相关文件 `{file_name}`。请把该文件加入当前项目，或安装包含它的 TeX Live 模板包。"
        ));
    }

    None
}

fn push_unique_diagnostic(diagnostics: &mut Vec<Diagnostic>, diagnostic: Diagnostic) {
    if !diagnostics.contains(&diagnostic) {
        diagnostics.push(diagnostic);
    }
}

fn parse_input_line(line: &str) -> Option<u32> {
    let marker = "input line ";
    let start = line.find(marker)? + marker.len();
    let digits = line[start..]
        .chars()
        .take_while(|value| value.is_ascii_digit())
        .collect::<String>();
    digits.parse().ok()
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn emit_compile_event(
    app: Option<&AppHandle>,
    kind: &str,
    message: &str,
    result: Option<CompileResult>,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "compile:event",
            CompileEvent {
                kind: kind.to_string(),
                message: message.to_string(),
                result,
            },
        );
    }
}

fn emit_codex_event(app: Option<&AppHandle>, kind: &str, run_id: Option<&str>, message: &str) {
    if let Some(app) = app {
        let _ = app.emit(
            "codex:event",
            CodexRunEvent {
                kind: kind.to_string(),
                run_id: run_id.map(ToString::to_string),
                message: message.to_string(),
            },
        );
    }
}

fn humanize_codex_output_line(line: &str, is_stderr: bool) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        let value = serde_json::from_str::<serde_json::Value>(trimmed).ok()?;
        let event_type = value.get("type").and_then(|value| value.as_str())?;
        if let Some(message) = codex_message_text(&value) {
            return Some(("assistant".to_string(), message));
        }
        let message = match event_type {
            "thread.started" => "Codex 会话已创建。",
            "turn.started" => "Codex 正在分析项目并准备修改。",
            "turn.completed" => "Codex 完成了一轮处理。",
            "turn.failed" => "Codex 处理失败。",
            "item.started" => item_event_message(&value, "正在处理")?,
            "item.completed" => item_event_message(&value, "已完成")?,
            "exec_command.started" => "Codex 正在运行本地命令。",
            "exec_command.completed" => "Codex 本地命令已结束。",
            "patch_apply.started" => "Codex 正在写入修改。",
            "patch_apply.completed" => "Codex 已写入修改。",
            _ => return None,
        };
        let kind = if event_type.contains("failed") {
            "error"
        } else {
            "progress"
        };
        return Some((kind.to_string(), message.to_string()));
    }

    if trimmed.starts_with("Reading additional input from stdin") {
        return Some((
            "progress".to_string(),
            "Codex 已启动，正在等待本地会话响应。".to_string(),
        ));
    }

    Some((
        if is_stderr { "error" } else { "assistant" }.to_string(),
        if is_stderr {
            format!("Codex 提示：{trimmed}")
        } else {
            trimmed.to_string()
        },
    ))
}

fn codex_message_text(value: &serde_json::Value) -> Option<String> {
    if !is_codex_message_json(value) {
        return None;
    }
    let mut parts = Vec::new();
    collect_json_text_fields(value, &mut parts);
    let mut unique = Vec::new();
    for part in parts {
        let cleaned = part.trim();
        if cleaned.is_empty() || unique.iter().any(|item: &String| item == cleaned) {
            continue;
        }
        unique.push(cleaned.to_string());
    }
    let message = unique.join("\n\n").trim().to_string();
    if message.is_empty() {
        None
    } else {
        Some(message)
    }
}

fn is_codex_message_json(value: &serde_json::Value) -> bool {
    let event_type = value
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if matches!(
        event_type,
        "message" | "agent_message" | "assistant_message" | "response.output_text.done"
    ) || event_type.contains("message")
    {
        return true;
    }
    value
        .get("item")
        .and_then(|item| item.get("type"))
        .and_then(|value| value.as_str())
        .map(|item_type| item_type == "message" || item_type.contains("message"))
        .unwrap_or(false)
}

fn item_event_message(value: &serde_json::Value, state: &str) -> Option<&'static str> {
    let item_type = value
        .get("item")
        .and_then(|item| item.get("type"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    match item_type {
        "message" => Some(if state == "正在处理" {
            "Codex 正在生成说明。"
        } else {
            "Codex 已生成说明。"
        }),
        "tool_call" | "function_call" => Some(if state == "正在处理" {
            "Codex 正在调用工具。"
        } else {
            "Codex 工具调用已完成。"
        }),
        "command_execution" => Some(if state == "正在处理" {
            "Codex 正在运行本地命令。"
        } else {
            "Codex 本地命令已结束。"
        }),
        _ => Some(if state == "正在处理" {
            "Codex 正在处理项目。"
        } else {
            "Codex 处理步骤已完成。"
        }),
    }
}

fn guarded_codex_prompt(user_prompt: &str) -> String {
    format!(
        "You are editing a local multi-file LaTeX project.\n\
Only inspect or modify files inside the current project directory.\n\
Do not modify .latex-studio, build artifacts, parent directories, or application source code.\n\
Preserve valid LaTeX and keep changes focused on this request.\n\n\
User request:\n{user_prompt}"
    )
}

fn guarded_codex_ask_prompt(user_prompt: &str) -> String {
    format!(
        "You are answering a question about a local multi-file LaTeX project.\n\
Only inspect files inside the current project directory.\n\
Do not modify, create, delete, move, or rename any files.\n\
Answer concisely and cite relevant filenames or line numbers when useful.\n\n\
User question:\n{user_prompt}"
    )
}

fn build_codex_args(root: &Path, prompt: &str, last_message_path: &Path) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--json".to_string(),
        "--sandbox".to_string(),
        "workspace-write".to_string(),
        "--skip-git-repo-check".to_string(),
        "--cd".to_string(),
        root.to_string_lossy().to_string(),
        "--output-last-message".to_string(),
        last_message_path.to_string_lossy().to_string(),
        prompt.to_string(),
    ]
}

fn build_codex_ask_args(root: &Path, prompt: &str, last_message_path: &Path) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--json".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--skip-git-repo-check".to_string(),
        "--cd".to_string(),
        root.to_string_lossy().to_string(),
        "--output-last-message".to_string(),
        last_message_path.to_string_lossy().to_string(),
        prompt.to_string(),
    ]
}

fn codex_last_message_temp_path(run_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("latex-studio-codex-last-message-{run_id}.txt"))
}

fn read_codex_last_message(path: &Path) -> Option<String> {
    let message = fs::read_to_string(path).ok()?.trim().to_string();
    if message.is_empty() {
        None
    } else {
        Some(message)
    }
}

fn cleanup_codex_last_message(path: &Path) {
    let _ = fs::remove_file(path);
}

fn extract_codex_answer(stdout: &str) -> String {
    let mut parts = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('{') {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(message) = codex_message_text(&value) {
                    parts.push(message);
                }
            }
            continue;
        }
        if !trimmed.starts_with("Reading additional input from stdin") {
            parts.push(trimmed.to_string());
        }
    }
    let answer = parts.join("\n").trim().to_string();
    if answer.is_empty() {
        "Codex 已完成，但没有返回可显示的文本。".to_string()
    } else {
        answer
    }
}

fn collect_json_text_fields(value: &serde_json::Value, parts: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                if matches!(key.as_str(), "text" | "content" | "message") {
                    if let Some(text) = child.as_str() {
                        let text = text.trim();
                        if !text.is_empty() {
                            parts.push(text.to_string());
                        }
                    }
                }
                collect_json_text_fields(child, parts);
            }
        }
        serde_json::Value::Array(values) => {
            for child in values {
                collect_json_text_fields(child, parts);
            }
        }
        _ => {}
    }
}

fn codex_prompt_preview(prompt: &str) -> Option<String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return None;
    }

    let mut end = prompt.len();
    for marker in [
        "\n\nProject context from LaTeX Studio:",
        "\nProject context from LaTeX Studio:",
        "\n\nCurrent editor context from LaTeX Studio:",
        "\nCurrent editor context from LaTeX Studio:",
        "\n\nSelected text:",
        "\nSelected text:",
    ] {
        if let Some(index) = prompt.find(marker) {
            end = end.min(index);
        }
    }

    let preview = prompt[..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if preview.is_empty() {
        return None;
    }
    Some(truncate_text_boundary(&preview, 180))
}

fn truncate_text_boundary(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            return output;
        }
        output.push(character);
    }
    output
}

fn project_meta_dir(root: &Path) -> PathBuf {
    root.join(".latex-studio")
}

fn snapshot_root(root: &Path, run_id: &str) -> PathBuf {
    project_meta_dir(root)
        .join("snapshots")
        .join(run_id)
        .join("root")
}

fn snapshot_manifest_path(root: &Path, run_id: &str) -> PathBuf {
    project_meta_dir(root)
        .join("snapshots")
        .join(run_id)
        .join("manifest.json")
}

fn project_history_dir(root: &Path) -> PathBuf {
    project_meta_dir(root).join("history")
}

fn project_history_root(root: &Path, snapshot_id: &str) -> PathBuf {
    project_history_dir(root).join(snapshot_id).join("root")
}

fn project_history_manifest_path(root: &Path, snapshot_id: &str) -> PathBuf {
    project_history_dir(root)
        .join(snapshot_id)
        .join("manifest.json")
}

fn diff_summary_path(root: &Path, run_id: &str) -> PathBuf {
    project_meta_dir(root)
        .join("codex")
        .join(format!("{run_id}.diff.json"))
}

fn collect_project_files(root: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let walker = WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !should_skip_walk_entry(entry));
    for entry in walker {
        let entry = entry.map_err(|err| format!("failed to walk project: {err}"))?;
        if entry.file_type().is_file() {
            files.push(relative_slash(root, entry.path())?);
        }
    }
    files.sort();
    Ok(files)
}

fn create_snapshot(root: &Path, run_id: &str) -> Result<(), String> {
    let files = collect_project_files(root)?;
    let snapshot_root = snapshot_root(root, run_id);
    fs::create_dir_all(&snapshot_root)
        .map_err(|err| format!("failed to create snapshot: {err}"))?;
    for relative in &files {
        let source = resolve_project_file_existing(root, Path::new(relative))?;
        let target = snapshot_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create snapshot directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("failed to snapshot {}: {err}", relative))?;
    }
    let manifest = SnapshotManifest {
        run_id: run_id.to_string(),
        files,
    };
    write_json(&snapshot_manifest_path(root, run_id), &manifest)
}

fn load_snapshot_manifest(root: &Path, run_id: &str) -> Result<SnapshotManifest, String> {
    let path = snapshot_manifest_path(root, run_id);
    let content = fs::read_to_string(&path).map_err(|err| {
        format!(
            "failed to read snapshot manifest {}: {err}",
            path.to_string_lossy()
        )
    })?;
    serde_json::from_str(&content).map_err(|err| format!("invalid snapshot manifest: {err}"))
}

fn normalize_codex_allowed_files(
    root: &Path,
    allowed_files: Option<&Vec<String>>,
) -> Result<Option<BTreeSet<String>>, String> {
    let Some(files) = allowed_files else {
        return Ok(None);
    };
    if files.is_empty() {
        return Ok(None);
    }

    let mut normalized = BTreeSet::new();
    for file in files {
        let path = Path::new(file.trim());
        reject_reserved_project_path(path)?;
        let relative = normalize_relative_path(path);
        if relative.is_empty() {
            return Err("Codex 允许修改的文件路径不能为空。".to_string());
        }
        if root.join(&relative).exists() {
            resolve_project_file_existing(root, Path::new(&relative))?;
        } else {
            resolve_project_file_for_write(root, Path::new(&relative))?;
        }
        normalized.insert(relative);
    }

    if normalized.is_empty() {
        Ok(None)
    } else {
        Ok(Some(normalized))
    }
}

fn enforce_codex_allowed_file_scope(
    root: &Path,
    run_id: &str,
    summary: DiffSummary,
    allowed_files: Option<&BTreeSet<String>>,
) -> Result<DiffSummary, String> {
    let Some(allowed_files) = allowed_files else {
        return Ok(summary);
    };
    if summary.changed_files.is_empty() {
        return Ok(summary);
    }

    let mut reverted_files = Vec::new();
    for relative in summary.changed_files {
        if allowed_files.contains(&relative) {
            continue;
        }
        restore_snapshot_file_state(root, run_id, &relative)?;
        reverted_files.push(relative);
    }

    let mut next_summary = diff_snapshot(root, run_id)?;
    next_summary.scope_reverted_files = reverted_files;
    Ok(next_summary)
}

fn diff_snapshot(root: &Path, run_id: &str) -> Result<DiffSummary, String> {
    let manifest = load_snapshot_manifest(root, run_id)?;
    let before_files = manifest.files.into_iter().collect::<BTreeSet<_>>();
    let after_files = collect_project_files(root)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    diff_file_sets(
        root,
        &snapshot_root(root, run_id),
        before_files,
        after_files,
        run_id,
    )
}

fn diff_file_sets(
    root: &Path,
    before_root: &Path,
    before_files: BTreeSet<String>,
    after_files: BTreeSet<String>,
    run_id: &str,
) -> Result<DiffSummary, String> {
    let all_files = before_files
        .union(&after_files)
        .cloned()
        .collect::<Vec<_>>();
    let mut changed_files = Vec::new();
    let mut unified_diff = String::new();

    for relative in all_files {
        let before_path = before_root.join(&relative);
        let after_path = root.join(&relative);
        let before_exists = before_path.exists();
        let after_exists = after_path.exists();

        let changed = match (before_exists, after_exists) {
            (true, true) => {
                let before = fs::read(&before_path)
                    .map_err(|err| format!("failed to read snapshot file: {err}"))?;
                let after = fs::read(&after_path)
                    .map_err(|err| format!("failed to read project file: {err}"))?;
                before != after
            }
            (true, false) | (false, true) => true,
            (false, false) => false,
        };

        if !changed {
            continue;
        }

        changed_files.push(relative.clone());
        match (
            fs::read_to_string(&before_path).ok(),
            fs::read_to_string(&after_path).ok(),
            before_exists,
            after_exists,
        ) {
            (Some(before), Some(after), _, _) => {
                let diff = TextDiff::from_lines(&before, &after);
                unified_diff.push_str(
                    &diff
                        .unified_diff()
                        .header(&format!("a/{relative}"), &format!("b/{relative}"))
                        .to_string(),
                );
            }
            (None, Some(after), false, true) => {
                let diff = TextDiff::from_lines("", &after);
                unified_diff.push_str(
                    &diff
                        .unified_diff()
                        .header("/dev/null", &format!("b/{relative}"))
                        .to_string(),
                );
            }
            (Some(before), None, true, false) => {
                let after = String::new();
                let diff = TextDiff::from_lines(&before, &after);
                unified_diff.push_str(
                    &diff
                        .unified_diff()
                        .header(&format!("a/{relative}"), "/dev/null")
                        .to_string(),
                );
            }
            _ => {
                unified_diff.push_str(&format!("二进制或非 UTF-8 文件发生变化：{relative}\n"));
            }
        }
    }

    let can_revert = !changed_files.is_empty();
    Ok(DiffSummary {
        run_id: run_id.to_string(),
        changed_files,
        unified_diff,
        can_revert,
        scope_reverted_files: Vec::new(),
        prompt_preview: None,
        final_message: None,
    })
}

fn save_diff_summary(root: &Path, summary: &DiffSummary) -> Result<(), String> {
    let path = diff_summary_path(root, &summary.run_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create Codex diff directory: {err}"))?;
    }
    write_json(&path, summary)
}

fn create_project_history_snapshot_in_root(
    root: &Path,
    label: &str,
) -> Result<ProjectHistoryItem, String> {
    let snapshot_id = Uuid::new_v4().to_string();
    let files = collect_project_files(root)?;
    let snapshot_root = project_history_root(root, &snapshot_id);
    fs::create_dir_all(&snapshot_root)
        .map_err(|err| format!("failed to create project history snapshot: {err}"))?;
    for relative in &files {
        let source = resolve_project_file_existing(root, Path::new(relative))?;
        let target = snapshot_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create history snapshot directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("failed to snapshot {}: {err}", relative))?;
    }
    let label = normalize_history_label(label);
    let created_at = unix_timestamp();
    let manifest = ProjectHistoryManifest {
        snapshot_id: snapshot_id.clone(),
        label: label.clone(),
        created_at,
        files,
    };
    write_json(
        &project_history_manifest_path(root, &snapshot_id),
        &manifest,
    )?;
    Ok(ProjectHistoryItem {
        snapshot_id,
        label,
        created_at,
        file_count: manifest.files.len(),
    })
}

fn normalize_history_label(label: &str) -> String {
    let label = label.trim();
    if label.is_empty() {
        "手动版本".to_string()
    } else {
        label.chars().take(80).collect()
    }
}

fn validate_history_snapshot_id(snapshot_id: &str) -> Result<(), String> {
    if snapshot_id.is_empty()
        || snapshot_id.len() > 80
        || !snapshot_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        return Err("历史版本 ID 不安全。".to_string());
    }
    Ok(())
}

fn load_project_history_manifest(
    root: &Path,
    snapshot_id: &str,
) -> Result<ProjectHistoryManifest, String> {
    validate_history_snapshot_id(snapshot_id)?;
    let path = project_history_manifest_path(root, snapshot_id);
    let content = fs::read_to_string(&path).map_err(|err| {
        format!(
            "failed to read project history manifest {}: {err}",
            path.to_string_lossy()
        )
    })?;
    serde_json::from_str(&content).map_err(|err| format!("invalid project history manifest: {err}"))
}

fn list_project_history_items(root: &Path) -> Result<Vec<ProjectHistoryItem>, String> {
    let dir = project_history_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in sorted_read_dir(&dir)? {
        let snapshot_id = entry.file_name().to_string_lossy().to_string();
        let Ok(manifest) = load_project_history_manifest(root, &snapshot_id) else {
            continue;
        };
        items.push(ProjectHistoryItem {
            snapshot_id: manifest.snapshot_id,
            label: manifest.label,
            created_at: manifest.created_at,
            file_count: manifest.files.len(),
        });
    }
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.snapshot_id.cmp(&left.snapshot_id))
    });
    items.truncate(50);
    Ok(items)
}

fn diff_project_history_snapshot(root: &Path, snapshot_id: &str) -> Result<DiffSummary, String> {
    let manifest = load_project_history_manifest(root, snapshot_id)?;
    let before_files = manifest.files.into_iter().collect::<BTreeSet<_>>();
    let current_files = collect_project_files(root)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    diff_file_sets(
        root,
        &project_history_root(root, snapshot_id),
        before_files,
        current_files,
        snapshot_id,
    )
}

fn restore_project_history_snapshot_in_root(root: &Path, snapshot_id: &str) -> Result<(), String> {
    let manifest = load_project_history_manifest(root, snapshot_id)?;
    let before_files = manifest.files.into_iter().collect::<BTreeSet<_>>();
    let current_files = collect_project_files(root)?
        .into_iter()
        .collect::<BTreeSet<_>>();

    for relative in current_files.difference(&before_files) {
        let target = resolve_project_file_existing(root, Path::new(relative))?;
        fs::remove_file(&target)
            .map_err(|err| format!("failed to remove new file {}: {err}", relative))?;
    }

    let snapshot_root = project_history_root(root, snapshot_id);
    for relative in &before_files {
        let source = snapshot_root.join(relative);
        let target = resolve_project_file_for_write(root, Path::new(relative))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create project directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("failed to restore {}: {err}", relative))?;
    }
    Ok(())
}

fn list_codex_history_items(root: &Path) -> Result<Vec<CodexHistoryItem>, String> {
    let dir = project_meta_dir(root).join("codex");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in sorted_read_dir(&dir)? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(summary) = serde_json::from_str::<DiffSummary>(&content) else {
            continue;
        };
        let created_at = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        items.push(CodexHistoryItem {
            run_id: summary.run_id,
            changed_files: summary.changed_files,
            can_revert: summary.can_revert,
            created_at,
            prompt_preview: summary.prompt_preview,
            final_message: summary.final_message,
        });
    }
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    items.truncate(30);
    Ok(items)
}

fn revert_snapshot(root: &Path, run_id: &str) -> Result<(), String> {
    let manifest = load_snapshot_manifest(root, run_id)?;
    let before_files = manifest.files.into_iter().collect::<BTreeSet<_>>();
    let current_files = collect_project_files(root)?
        .into_iter()
        .collect::<BTreeSet<_>>();

    for relative in current_files.difference(&before_files) {
        let target = resolve_project_file_existing(root, Path::new(relative))?;
        fs::remove_file(&target)
            .map_err(|err| format!("failed to remove new file {}: {err}", relative))?;
    }

    let snapshot_root = snapshot_root(root, run_id);
    for relative in &before_files {
        let source = snapshot_root.join(relative);
        let target = resolve_project_file_for_write(root, Path::new(relative))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create project directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("failed to restore {}: {err}", relative))?;
    }

    Ok(())
}

fn restore_snapshot_file_state(root: &Path, run_id: &str, relative: &str) -> Result<(), String> {
    let relative_path = Path::new(relative);
    reject_reserved_project_path(relative_path)?;
    let normalized = normalize_relative_path(relative_path);
    if normalized.is_empty() {
        return Err("要撤回的文件路径不能为空。".to_string());
    }

    let manifest = load_snapshot_manifest(root, run_id)?;
    let before_files = manifest.files.into_iter().collect::<BTreeSet<_>>();
    let snapshot_root = snapshot_root(root, run_id);
    if before_files.contains(&normalized) {
        let source = snapshot_root.join(&normalized);
        let target = resolve_project_file_for_write(root, Path::new(&normalized))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create project directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("failed to restore {normalized}: {err}"))?;
    } else {
        let target = resolve_project_file_existing(root, Path::new(&normalized))?;
        fs::remove_file(&target)
            .map_err(|err| format!("failed to remove new file {normalized}: {err}"))?;
    }

    Ok(())
}

fn revert_snapshot_file(root: &Path, run_id: &str, path: &str) -> Result<DiffSummary, String> {
    let relative_path = Path::new(path);
    reject_reserved_project_path(relative_path)?;
    let relative = normalize_relative_path(relative_path);
    if relative.is_empty() {
        return Err("要撤回的文件路径不能为空。".to_string());
    }

    let saved_summary = load_saved_diff_summary(root, run_id);
    let prompt_preview = saved_summary
        .as_ref()
        .and_then(|summary| summary.prompt_preview.clone());
    let final_message = saved_summary.and_then(|summary| summary.final_message);
    let scope_reverted_files = load_saved_diff_summary(root, run_id)
        .map(|summary| summary.scope_reverted_files)
        .unwrap_or_default();
    let current_summary = diff_snapshot(root, run_id)?;
    if !current_summary.changed_files.contains(&relative) {
        return Err(format!("{relative} 没有可撤回的 Codex 修改。"));
    }

    restore_snapshot_file_state(root, run_id, &relative)?;

    let mut next_summary = diff_snapshot(root, run_id)?;
    next_summary.prompt_preview = prompt_preview;
    next_summary.final_message = final_message;
    next_summary.scope_reverted_files = scope_reverted_files;
    if next_summary.changed_files.is_empty() {
        let path = diff_summary_path(root, run_id);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|err| format!("failed to remove Codex diff summary: {err}"))?;
        }
    } else {
        save_diff_summary(root, &next_summary)?;
    }
    Ok(next_summary)
}

fn load_saved_diff_summary(root: &Path, run_id: &str) -> Option<DiffSummary> {
    let content = fs::read_to_string(diff_summary_path(root, run_id)).ok()?;
    serde_json::from_str(&content).ok()
}

fn ensure_main_window_visible<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let Ok(window) =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("LaTeX Desktop Studio")
            .inner_size(1440.0, 920.0)
            .min_inner_size(1100.0, 720.0)
            .build()
    else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            create_project,
            open_project,
            get_project_settings,
            update_project_settings,
            list_recent_projects,
            import_project_zip,
            import_project_files,
            list_project_files,
            search_project_files,
            replace_project_text,
            count_project_words,
            list_project_outline,
            list_project_overview,
            list_project_document_files,
            list_project_symbols,
            list_project_todos,
            list_project_reference_issues,
            list_project_file_usages,
            list_project_dependencies,
            read_file,
            read_project_asset_file,
            read_pdf_file,
            get_existing_pdf_output,
            synctex_forward_search,
            synctex_reverse_search,
            open_pdf_file,
            reveal_pdf_file,
            export_pdf_file,
            export_project_zip,
            save_file,
            create_project_entry,
            rename_project_entry,
            delete_project_entry,
            compile_project,
            clean_project_build,
            cancel_compile,
            run_codex_edit,
            run_codex_ask,
            cancel_codex_run,
            get_codex_diff,
            list_codex_history,
            create_project_history_snapshot,
            list_project_history,
            get_project_history_diff,
            restore_project_history_snapshot,
            revert_codex_run,
            revert_codex_file
        ])
        .setup(|app| {
            ensure_main_window_visible(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building LaTeX Desktop Studio");

    app.run(|app, event| {
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                ensure_main_window_visible(app);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_executable(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    #[test]
    fn parses_file_line_errors_and_warnings() {
        let log = "./main.tex:12: Undefined control sequence.\nLaTeX Warning: Citation `x' undefined on input line 8.\n";
        let diagnostics = parse_latex_diagnostics(log);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].severity, DiagnosticSeverity::Error);
        assert_eq!(diagnostics[0].file.as_deref(), Some("main.tex"));
        assert_eq!(diagnostics[0].line, Some(12));
        assert_eq!(diagnostics[1].severity, DiagnosticSeverity::Warning);
        assert_eq!(diagnostics[1].line, Some(8));
    }

    #[test]
    fn attaches_bang_errors_to_current_file_and_source_line() {
        let log = "**main.tex\n(./main.tex\n! LaTeX Error: File `xeCJK.sty' not found.\nl.4 \\usepackage{xeCJK}\n";
        let diagnostics = parse_latex_diagnostics(log);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].severity, DiagnosticSeverity::Error);
        assert_eq!(diagnostics[0].file.as_deref(), Some("main.tex"));
        assert_eq!(diagnostics[0].line, Some(4));
        assert!(diagnostics[0].message.contains("xeCJK.sty"));
        assert!(diagnostics[0]
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("中文排版"));
    }

    #[test]
    fn suggests_actions_for_missing_latex_packages_and_templates() {
        let package =
            friendly_latex_diagnostic_text("LaTeX Error: File `algorithm2e.sty' not found.");
        assert_eq!(
            package.message,
            "LaTeX Error: File `algorithm2e.sty' not found."
        );
        assert!(package
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("tlmgr install algorithm2e"));

        let template =
            friendly_latex_diagnostic_text("LaTeX Error: File `neurips_2026.sty' not found.");
        assert!(template
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("tlmgr install neurips_2026"));

        let class_file =
            friendly_latex_diagnostic_text("LaTeX Error: File `custom.cls' not found.");
        assert!(class_file
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("加入当前项目"));
    }

    #[test]
    fn rejects_paths_that_escape_project_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        assert!(resolve_project_file_for_write(&root, Path::new("../outside.tex")).is_err());
        assert!(resolve_project_file_for_write(&root, Path::new("/tmp/outside.tex")).is_err());
    }

    #[test]
    fn create_project_path_accepts_empty_or_short_names() {
        let default_root = default_projects_dir().unwrap();
        let empty_path = project_path_for_create("").unwrap();
        let named_path = project_path_for_create("draft-paper").unwrap();

        assert!(empty_path.starts_with(&default_root));
        assert!(empty_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap()
            .starts_with("paper-"));
        assert_eq!(named_path, default_root.join("draft-paper"));
    }

    #[test]
    fn creates_projects_from_templates() {
        let temp = tempfile::tempdir().unwrap();
        let blank_root = temp.path().join("blank-template");
        create_project(
            blank_root.to_string_lossy().to_string(),
            Some("Blank".to_string()),
            Some("blank".to_string()),
        )
        .unwrap();
        let blank_main = fs::read_to_string(blank_root.join("main.tex")).unwrap();
        assert!(blank_main.contains("Start writing here."));
        assert!(!blank_root.join("references.bib").exists());

        let preprint_root = temp.path().join("preprint-template");
        create_project(
            preprint_root.to_string_lossy().to_string(),
            Some("Preprint".to_string()),
            Some("preprint".to_string()),
        )
        .unwrap();
        let preprint_main = fs::read_to_string(preprint_root.join("main.tex")).unwrap();
        assert!(preprint_main.contains("\\begin{abstract}"));
        assert!(preprint_main.contains("\\toprule"));
        assert!(preprint_root.join("references.bib").exists());

        let multi_root = temp.path().join("multi-template");
        create_project(
            multi_root.to_string_lossy().to_string(),
            Some("Multi".to_string()),
            Some("multifile".to_string()),
        )
        .unwrap();
        let multi_main = fs::read_to_string(multi_root.join("main.tex")).unwrap();
        assert!(multi_main.contains("\\input{sections/intro}"));
        assert!(multi_root.join("sections/intro.tex").exists());
        assert!(multi_root.join("sections/method.tex").exists());
        assert!(multi_root.join("references.bib").exists());

        let chinese_root = temp.path().join("chinese-template");
        create_project(
            chinese_root.to_string_lossy().to_string(),
            Some("中文论文".to_string()),
            Some("chinese".to_string()),
        )
        .unwrap();
        let chinese_main = fs::read_to_string(chinese_root.join("main.tex")).unwrap();
        assert!(chinese_main.contains("\\documentclass[UTF8,zihao=-4]{ctexart}"));
        assert!(chinese_main.contains("\\section{引言}"));

        let chinese_multi_root = temp.path().join("chinese-multi-template");
        create_project(
            chinese_multi_root.to_string_lossy().to_string(),
            Some("中文多文件".to_string()),
            Some("chinese-multifile".to_string()),
        )
        .unwrap();
        let chinese_multi_main = fs::read_to_string(chinese_multi_root.join("main.tex")).unwrap();
        assert!(chinese_multi_main.contains("\\input{sections/experiments}"));
        assert!(chinese_multi_root.join("sections/intro.tex").exists());
        assert!(chinese_multi_root.join("sections/method.tex").exists());
        assert!(chinese_multi_root.join("sections/experiments.tex").exists());

        let beamer_root = temp.path().join("beamer-template");
        create_project(
            beamer_root.to_string_lossy().to_string(),
            Some("Slides".to_string()),
            Some("beamer".to_string()),
        )
        .unwrap();
        let beamer_main = fs::read_to_string(beamer_root.join("main.tex")).unwrap();
        assert!(beamer_main.contains("\\documentclass[aspectratio=169]{beamer}"));
        assert!(beamer_main.contains("\\titlepage"));
        assert!(!beamer_root.join("references.bib").exists());

        assert!(normalized_project_template(Some("unknown")).is_err());
    }

    #[test]
    fn open_project_detects_existing_root_tex_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(
            root.join("neurips_2026.tex"),
            "\\documentclass{article}\n\\begin{document}\nPaper\n\\end{document}\n",
        )
        .unwrap();

        let summary = open_project(root.to_string_lossy().to_string()).unwrap();
        let settings = load_settings(&root).unwrap();

        assert_eq!(summary.main_file, "neurips_2026.tex");
        assert_eq!(settings.main_file, "neurips_2026.tex");
        assert!(!root.join("main.tex").exists());
        assert!(root.join(".latex-studio/build").is_dir());
    }

    #[test]
    fn open_project_uses_tex_magic_comments_on_first_open() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nWrong entry\n\\end{document}\n",
        )
        .unwrap();
        fs::write(
            root.join("paper.tex"),
            "\\documentclass{article}\n\\begin{document}\nReal entry\n\\input{sections/intro}\n\\end{document}\n",
        )
        .unwrap();
        fs::write(
            root.join("sections/intro.tex"),
            "% !TEX root = ../paper.tex\n% !TEX program = lualatex\n\\section{Intro}\n",
        )
        .unwrap();

        let summary = open_project(root.to_string_lossy().to_string()).unwrap();
        let settings = load_settings(&root).unwrap();

        assert_eq!(summary.main_file, "paper.tex");
        assert_eq!(settings.main_file, "paper.tex");
        assert_eq!(settings.engine, "lualatex");
    }

    #[test]
    fn open_project_preserves_saved_settings_over_tex_magic_comments() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nSaved entry\n\\end{document}\n",
        )
        .unwrap();
        fs::write(
            root.join("paper.tex"),
            "% !TEX program = lualatex\n\\documentclass{article}\n\\begin{document}\nMagic entry\n\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings {
                display_name: None,
                main_file: "main.tex".to_string(),
                engine: "pdflatex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: Vec::new(),
            },
        )
        .unwrap();

        let summary = open_project(root.to_string_lossy().to_string()).unwrap();
        let settings = load_settings(&root).unwrap();

        assert_eq!(summary.main_file, "main.tex");
        assert_eq!(settings.main_file, "main.tex");
        assert_eq!(settings.engine, "pdflatex");
    }

    #[test]
    fn open_project_repairs_missing_configured_main_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("paper.tex"),
            "\\documentclass{article}\n\\begin{document}\nPaper\n\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings {
                display_name: None,
                main_file: "missing.tex".to_string(),
                engine: "badtex".to_string(),
                build_dir: ".".to_string(),
                compile_args: Vec::new(),
            },
        )
        .unwrap();

        let summary = open_project(root.to_string_lossy().to_string()).unwrap();
        let settings = load_settings(&root).unwrap();

        assert_eq!(summary.main_file, "paper.tex");
        assert_eq!(settings.main_file, "paper.tex");
        assert_eq!(settings.engine, "xelatex");
        assert_eq!(settings.build_dir, ".latex-studio/build");
    }

    #[test]
    fn creates_renames_and_deletes_project_entries_safely() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        let settings = ProjectSettings {
            compile_args: vec!["-bibtex".to_string(), "-silent".to_string()],
            ..ProjectSettings::default()
        };
        write_json(&root.join(".latex-studio.json"), &settings).unwrap();
        let project_root = root.to_string_lossy().to_string();

        create_project_entry(
            project_root.clone(),
            "sections".to_string(),
            FileKind::Directory,
        )
        .unwrap();
        create_project_entry(
            project_root.clone(),
            "sections/intro.tex".to_string(),
            FileKind::File,
        )
        .unwrap();
        assert!(root.join("sections/intro.tex").exists());

        rename_project_entry(
            project_root.clone(),
            "sections/intro.tex".to_string(),
            "sections/background.tex".to_string(),
        )
        .unwrap();
        assert!(!root.join("sections/intro.tex").exists());
        assert!(root.join("sections/background.tex").exists());

        delete_project_entry(project_root.clone(), "sections/background.tex".to_string()).unwrap();
        assert!(!root.join("sections/background.tex").exists());

        assert!(create_project_entry(
            project_root.clone(),
            "../escape.tex".to_string(),
            FileKind::File,
        )
        .is_err());
        assert!(create_project_entry(
            project_root.clone(),
            ".latex-studio/run.json".to_string(),
            FileKind::File,
        )
        .is_err());
        rename_project_entry(
            project_root.clone(),
            "main.tex".to_string(),
            "paper.tex".to_string(),
        )
        .unwrap();
        assert!(!root.join("main.tex").exists());
        assert!(root.join("paper.tex").exists());
        assert_eq!(load_settings(&root).unwrap().main_file, "paper.tex");
        assert!(rename_project_entry(
            project_root.clone(),
            "paper.tex".to_string(),
            "paper.md".to_string(),
        )
        .is_err());
        assert!(delete_project_entry(project_root, "paper.tex".to_string()).is_err());

        let nested = tempfile::tempdir().unwrap();
        let nested_root = fs::canonicalize(nested.path()).unwrap();
        fs::create_dir_all(nested_root.join("sections")).unwrap();
        fs::write(nested_root.join("sections/main.tex"), "main\n").unwrap();
        write_json(
            &nested_root.join(".latex-studio.json"),
            &ProjectSettings {
                main_file: "sections/main.tex".to_string(),
                ..ProjectSettings::default()
            },
        )
        .unwrap();
        let nested_root_string = nested_root.to_string_lossy().to_string();
        assert!(delete_project_entry(nested_root_string.clone(), "sections".to_string()).is_err());
        rename_project_entry(
            nested_root_string.clone(),
            "sections".to_string(),
            "chapters".to_string(),
        )
        .unwrap();
        assert_eq!(
            load_settings(&nested_root).unwrap().main_file,
            "chapters/main.tex"
        );
        assert!(delete_project_entry(nested_root_string, "chapters".to_string()).is_err());
    }

    #[test]
    fn renaming_project_files_updates_latex_file_references() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::create_dir_all(root.join("fig")).unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(root.join("fig/plot.pdf"), b"%PDF-1.4 fake").unwrap();
        fs::write(root.join("references.bib"), "@article{x}\n").unwrap();
        fs::write(root.join("other.bib"), "@article{y}\n").unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\
\\begin{document}\n\
\\input{sections/intro}\n\
\\include{sections/intro.tex}\n\
\\includegraphics[width=0.8\\linewidth]{fig/plot}\n\
\\bibliography{references, other}\n\
\\addbibresource{references.bib}\n\
% \\input{sections/intro}\n\
\\input{\\jobname-extra}\n\
\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();
        let project_root = root.to_string_lossy().to_string();

        let tex_result = rename_project_entry(
            project_root.clone(),
            "sections/intro.tex".to_string(),
            "sections/background.tex".to_string(),
        )
        .unwrap();
        assert_eq!(tex_result.updated_references, 2);
        assert_eq!(tex_result.updated_reference_files, vec!["main.tex"]);

        let graphics_result = rename_project_entry(
            project_root.clone(),
            "fig/plot.pdf".to_string(),
            "fig/main-plot.pdf".to_string(),
        )
        .unwrap();
        assert_eq!(graphics_result.updated_references, 1);

        let bib_result = rename_project_entry(
            project_root,
            "references.bib".to_string(),
            "bib/paper.bib".to_string(),
        )
        .unwrap();
        assert_eq!(bib_result.updated_references, 2);

        let main = fs::read_to_string(root.join("main.tex")).unwrap();
        assert!(main.contains("\\input{sections/background}"));
        assert!(main.contains("\\include{sections/background.tex}"));
        assert!(main.contains("\\includegraphics[width=0.8\\linewidth]{fig/main-plot}"));
        assert!(main.contains("\\bibliography{bib/paper, other}"));
        assert!(main.contains("\\addbibresource{bib/paper.bib}"));
        assert!(main.contains("% \\input{sections/intro}"));
        assert!(main.contains("\\input{\\jobname-extra}"));
    }

    #[test]
    fn lists_project_file_usages_before_deleting_referenced_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::create_dir_all(root.join("fig")).unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(root.join("sections/method.tex"), "\\section{Method}\n").unwrap();
        fs::write(root.join("fig/plot.pdf"), b"%PDF-1.4 fake").unwrap();
        fs::write(root.join("references.bib"), "@article{x}\n").unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\
\\begin{document}\n\
\\input{sections/intro}\n\
\\include{sections/method.tex}\n\
\\includegraphics[width=0.8\\linewidth]{fig/plot}\n\
\\bibliography{references}\n\
% \\input{sections/intro}\n\
\\input{\\jobname-extra}\n\
\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();
        let project_root = root.to_string_lossy().to_string();

        let intro =
            list_project_file_usages(project_root.clone(), "sections/intro.tex".to_string())
                .unwrap();
        assert_eq!(intro.len(), 1);
        assert_eq!(intro[0].file, "main.tex");
        assert_eq!(intro[0].command, "input");
        assert_eq!(intro[0].path, "sections/intro");

        let figure =
            list_project_file_usages(project_root.clone(), "fig/plot.pdf".to_string()).unwrap();
        assert_eq!(figure.len(), 1);
        assert_eq!(figure[0].command, "includegraphics");

        let bibliography =
            list_project_file_usages(project_root.clone(), "references.bib".to_string()).unwrap();
        assert_eq!(bibliography.len(), 1);
        assert_eq!(bibliography[0].command, "bibliography");

        let sections = list_project_file_usages(project_root, "sections".to_string()).unwrap();
        assert_eq!(sections.len(), 2);
        assert!(sections.iter().any(|usage| usage.path == "sections/intro"));
        assert!(sections
            .iter()
            .any(|usage| usage.path == "sections/method.tex"));
    }

    #[test]
    fn lists_project_dependencies_for_codex_context() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::create_dir_all(root.join("fig")).unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(root.join("fig/plot.png"), b"fake png").unwrap();
        fs::write(root.join("references.bib"), "@article{x}\n").unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\
\\begin{document}\n\
\\input{sections/intro}\n\
\\includegraphics{fig/plot}\n\
\\bibliography{references,missing_refs}\n\
% \\input{hidden}\n\
\\input{\\jobname-extra}\n\
\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let dependencies = list_project_dependencies(root.to_string_lossy().to_string()).unwrap();

        assert!(dependencies.iter().any(|dependency| {
            dependency.command == "input"
                && dependency.target == "sections/intro"
                && dependency.resolved_path.as_deref() == Some("sections/intro.tex")
        }));
        assert!(dependencies.iter().any(|dependency| {
            dependency.command == "includegraphics"
                && dependency.target == "fig/plot"
                && dependency.resolved_path.as_deref() == Some("fig/plot.png")
        }));
        assert!(dependencies.iter().any(|dependency| {
            dependency.command == "bibliography"
                && dependency.target == "references"
                && dependency.resolved_path.as_deref() == Some("references.bib")
        }));
        assert!(dependencies.iter().any(|dependency| {
            dependency.command == "bibliography"
                && dependency.target == "missing_refs"
                && dependency.resolved_path.is_none()
        }));
        assert!(!dependencies
            .iter()
            .any(|dependency| dependency.target == "hidden"));
        assert!(!dependencies
            .iter()
            .any(|dependency| dependency.target.contains("\\jobname")));
    }

    #[test]
    fn imports_files_into_project_with_collision_suffixes() {
        let project = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(project.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let sources = tempfile::tempdir().unwrap();
        let first = sources.path().join("plot.pdf");
        let second = sources.path().join("notes.bib");
        fs::write(&first, b"%PDF-1.4").unwrap();
        fs::write(&second, b"@article{x}\n").unwrap();

        let project_root = root.to_string_lossy().to_string();
        let imported = import_project_files(
            project_root.clone(),
            "figures".to_string(),
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        assert_eq!(
            imported,
            vec![
                "figures/notes.bib".to_string(),
                "figures/plot.pdf".to_string()
            ]
        );
        assert!(root.join("figures/plot.pdf").exists());

        let imported_again = import_project_files(
            project_root.clone(),
            "figures".to_string(),
            vec![first.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(imported_again, vec!["figures/plot-1.pdf".to_string()]);
        assert!(root.join("figures/plot-1.pdf").exists());

        assert!(import_project_files(
            project_root,
            ".latex-studio".to_string(),
            vec![first.to_string_lossy().to_string()],
        )
        .is_err());
    }

    #[test]
    fn list_project_files_sorts_directories_first_and_hides_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("appendix")).unwrap();
        fs::create_dir_all(root.join("fig")).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::create_dir_all(root.join(".latex-studio")).unwrap();
        fs::write(root.join("arxiv.sty"), "style\n").unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        fs::write(root.join(".latex-studio.json"), "{}").unwrap();
        fs::write(root.join(".latex-studio/state.json"), "{}").unwrap();

        let nodes = list_project_files(root.to_string_lossy().to_string()).unwrap();
        let names = nodes
            .iter()
            .map(|node| node.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec!["appendix", "fig", "sections", "arxiv.sty", "main.tex"]
        );
        assert!(matches!(&nodes[0].kind, FileKind::Directory));
        assert!(matches!(&nodes[3].kind, FileKind::File));

        let project_files = collect_project_files(&root).unwrap();
        assert!(project_files
            .iter()
            .any(|path| path == ".latex-studio.json"));
        assert!(!project_files
            .iter()
            .any(|path| path.starts_with(".latex-studio/")));
    }

    #[test]
    fn validates_zip_entry_paths_before_import() {
        assert!(validate_zip_entry_path("paper/main.tex").is_ok());
        assert!(validate_zip_entry_path("paper\\sections\\intro.tex").is_ok());
        assert!(validate_zip_entry_path("../evil.tex").is_err());
        assert!(validate_zip_entry_path("paper/../../evil.tex").is_err());
        assert!(validate_zip_entry_path("/tmp/evil.tex").is_err());
    }

    #[test]
    fn copies_imported_project_sources_without_internal_metadata() {
        let source = tempfile::tempdir().unwrap();
        let source_root = source.path().join("paper-root");
        fs::create_dir_all(source_root.join("sections")).unwrap();
        fs::create_dir_all(source_root.join(".git")).unwrap();
        fs::create_dir_all(source_root.join(".latex-studio")).unwrap();
        fs::write(
            source_root.join("paper.tex"),
            "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        fs::write(source_root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(source_root.join(".git/config"), "git").unwrap();
        fs::write(source_root.join(".latex-studio.json"), "{}").unwrap();
        fs::write(source_root.join(".latex-studio/state.json"), "{}").unwrap();
        fs::write(source_root.join(".DS_Store"), "mac").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink("/tmp", source_root.join("tmp-link")).unwrap();
        }

        let staging = tempfile::tempdir().unwrap();
        let content_root = detect_import_content_root(source.path()).unwrap();
        assert_eq!(content_root, source_root);

        copy_imported_project_sources(&content_root, staging.path()).unwrap();

        assert!(staging.path().join("paper.tex").exists());
        assert!(staging.path().join("sections/intro.tex").exists());
        assert!(!staging.path().join(".git/config").exists());
        assert!(!staging.path().join(".latex-studio.json").exists());
        assert!(!staging.path().join(".latex-studio/state.json").exists());
        assert!(!staging.path().join(".DS_Store").exists());
        assert!(!staging.path().join("tmp-link").exists());
    }

    #[test]
    fn searches_project_text_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\section{Intro}\nA Label appears here.\n",
        )
        .unwrap();
        fs::write(root.join("sections/method.tex"), "another label line\n").unwrap();
        fs::write(root.join("figure.png"), b"label").unwrap();
        fs::create_dir_all(root.join(".latex-studio")).unwrap();
        fs::write(root.join(".latex-studio/hidden.tex"), "label\n").unwrap();
        fs::write(root.join(".latex-studio.json"), "{\"label\":\"hidden\"}\n").unwrap();

        let results =
            search_project_files(root.to_string_lossy().to_string(), "label".to_string()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].file, "main.tex");
        assert_eq!(results[0].line, 2);
        assert_eq!(results[0].column, 3);
        assert_eq!(results[1].file, "sections/method.tex");
    }

    #[test]
    fn replaces_project_text_across_searchable_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(root.join("main.tex"), "alpha beta alpha\n").unwrap();
        fs::write(root.join("sections/method.tex"), "alpha method\n").unwrap();
        fs::write(root.join("figure.png"), b"alpha").unwrap();
        fs::create_dir_all(root.join(".latex-studio")).unwrap();
        fs::write(root.join(".latex-studio/hidden.tex"), "alpha\n").unwrap();
        fs::write(root.join(".latex-studio.json"), "{\"needle\":\"alpha\"}\n").unwrap();

        let result = replace_project_text(
            root.to_string_lossy().to_string(),
            "alpha".to_string(),
            "gamma".to_string(),
        )
        .unwrap();

        assert_eq!(result.replacements, 3);
        assert_eq!(result.files.len(), 2);
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "gamma beta gamma\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("sections/method.tex")).unwrap(),
            "gamma method\n"
        );
        assert_eq!(fs::read(root.join("figure.png")).unwrap(), b"alpha");
        assert_eq!(
            fs::read_to_string(root.join(".latex-studio/hidden.tex")).unwrap(),
            "alpha\n"
        );
        assert_eq!(
            fs::read_to_string(root.join(".latex-studio.json")).unwrap(),
            "{\"needle\":\"alpha\"}\n"
        );
        assert!(replace_project_text(
            root.to_string_lossy().to_string(),
            String::new(),
            "x".to_string()
        )
        .is_err());
    }

    #[test]
    fn counts_words_across_tex_project_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n% hidden words here\n\\begin{document}\nHello world from \\textbf{LaTeX}.\n中文测试。\n\\end{document}\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("sections/method.tex"),
            "\\section{Method}\nWe evaluate three models and 42 samples.\n",
        )
        .unwrap();
        fs::write(root.join("references.bib"), "@article{x}\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let result = count_project_words(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(result.files.len(), 2);
        assert!(result.words >= 17);
        assert!(result.characters >= 30);
        assert!(result.files.iter().any(|file| file.file == "main.tex"));
        assert!(result.files.iter().all(|file| !file.file.ends_with(".bib")));
    }

    #[test]
    fn strips_comments_and_latex_commands_for_word_count() {
        let (words, characters) = count_latex_words(
            "\\section{Intro Title}\nVisible words only % hidden words\n\\cite{ignored} 中文\n",
        );

        assert_eq!(words, 7);
        assert!(characters >= 20);
    }

    #[test]
    fn parses_project_outline_from_tex_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "% \\section{Hidden}\n\\section*{Intro \\& Motivation}\nText with \\label{sec:intro}\n",
        )
        .unwrap();
        fs::write(
            root.join("sections/method.tex"),
            "\\subsection[Short]{Method Details}\\label{sec:method}\n\\sectionmark{Ignore}\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".latex-studio")).unwrap();
        fs::write(root.join(".latex-studio/hidden.tex"), "\\section{Hidden}\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let outline = list_project_outline(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(outline.len(), 4);
        assert_eq!(outline[0].kind, "section");
        assert_eq!(outline[0].title, "Intro & Motivation");
        assert_eq!(outline[0].file, "main.tex");
        assert_eq!(outline[0].line, 2);
        assert_eq!(outline[1].kind, "label");
        assert_eq!(outline[1].title, "sec:intro");
        assert_eq!(outline[2].kind, "subsection");
        assert_eq!(outline[2].title, "Method Details");
        assert_eq!(outline[2].file, "sections/method.tex");
        assert_eq!(outline[3].title, "sec:method");
    }

    #[test]
    fn project_outline_follows_main_document_order() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\
\\begin{document}\n\
\\input{sections/method}\n\
\\input{sections/intro}\n\
\\end{document}\n",
        )
        .unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(root.join("sections/method.tex"), "\\section{Method}\n").unwrap();
        fs::write(root.join("sections/appendix.tex"), "\\section{Appendix}\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let outline = list_project_outline(root.to_string_lossy().to_string()).unwrap();
        let headings = outline
            .iter()
            .filter(|item| item.kind == "section")
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>();

        assert_eq!(headings, vec!["Method", "Intro", "Appendix"]);
    }

    #[test]
    fn lists_project_document_files_in_main_order() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\
\\begin{document}\n\
\\input{sections/method}\n\
\\input{sections/intro}\n\
\\end{document}\n",
        )
        .unwrap();
        fs::write(root.join("sections/intro.tex"), "\\section{Intro}\n").unwrap();
        fs::write(root.join("sections/method.tex"), "\\section{Method}\n").unwrap();
        fs::write(root.join("sections/appendix.tex"), "\\section{Appendix}\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let files = list_project_document_files(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(
            files,
            vec![
                "main.tex",
                "sections/method.tex",
                "sections/intro.tex",
                "sections/appendix.tex"
            ]
        );
    }

    #[test]
    fn parses_project_overview_for_codex_context() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\title{Local \\LaTeX{} Studio \\& Codex}\n\\author{Alice Example \\\\ Bob Example}\n\\date{2026}\n\\keywords{LaTeX, Codex; local editing}\n\\begin{document}\n\\begin{abstract}\nWe build a local Overleaf-style editor with natural-language edits. % hidden\nIt keeps project files private and recompiles automatically.\n\\end{abstract}\n\\input{sections/intro}\n\\end{document}\n",
        )
        .unwrap();
        fs::write(
            root.join("sections/intro.tex"),
            "\\title{Wrong Title}\n\\begin{abstract}Secondary abstract should not replace the main one.\\end{abstract}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let overview = list_project_overview(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(
            overview.title.as_deref(),
            Some("Local \\LaTeX{} Studio & Codex")
        );
        assert_eq!(overview.date.as_deref(), Some("2026"));
        assert!(overview
            .abstract_text
            .as_deref()
            .unwrap()
            .contains("natural-language edits"));
        assert!(!overview
            .abstract_text
            .as_deref()
            .unwrap()
            .contains("hidden"));
        assert!(overview.keywords.contains(&"Codex".to_string()));
        assert!(overview.keywords.contains(&"local editing".to_string()));
    }

    #[test]
    fn indexes_project_symbols_for_refs_and_cites() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\section{Intro}\\label{sec:intro}\n% \\label{hidden}\n\\label{fig:one}\\label{tab:one}\n",
        )
        .unwrap();
        fs::write(
            root.join("refs.bib"),
            "@article{smith2026latex,\n  author={Smith, Alice and Chen, Bob and Kumar, Dev},\n  title={Local {LaTeX} Studio with Codex},\n  year={2026}\n}\n@string{ignored = {x}}\n@inproceedings(other2025, author={Ada Lovelace}, title={Other}, year={2025})\n",
        )
        .unwrap();

        let symbols = list_project_symbols(root.to_string_lossy().to_string()).unwrap();
        let labels = symbols
            .iter()
            .filter(|symbol| symbol.kind == "label")
            .map(|symbol| symbol.key.as_str())
            .collect::<Vec<_>>();
        let citations = symbols
            .iter()
            .filter(|symbol| symbol.kind == "citation")
            .map(|symbol| symbol.key.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["fig:one", "sec:intro", "tab:one"]);
        assert_eq!(citations, vec!["other2025", "smith2026latex"]);
        let citation_details = symbols
            .iter()
            .filter(|symbol| symbol.kind == "citation")
            .map(|symbol| (symbol.key.as_str(), symbol.detail.as_deref().unwrap_or("")))
            .collect::<HashMap<_, _>>();
        assert_eq!(
            citation_details.get("smith2026latex").copied(),
            Some("article · Smith et al. · 2026 · Local LaTeX Studio with Codex")
        );
        assert_eq!(
            citation_details.get("other2025").copied(),
            Some("inproceedings · Lovelace · 2025 · Other")
        );
        assert!(symbols.iter().all(|symbol| symbol.key != "hidden"));
        assert!(symbols.iter().all(|symbol| symbol.key != "ignored"));
    }

    #[test]
    fn parses_bibtex_metadata_with_library_features_and_graceful_fallback() {
        let content = r#"
@string{conf = {NeurIPS}}

@inproceedings{chen2026toc,
  author = {Junzhe Chen and Siyuan Meng and Yuxi Chen and Man Zhao},
  title = {{TOC}-{Bench}: Evaluating {Temporal} Object Consistency},
  date = {2026-01},
  booktitle = conf,
}

@article{zhao2025quoted,
  author = "Zhao, Man and Gui, Wenyao",
  title = "Nested {Video-LLM} Reasoning",
  year = 2025,
}
"#;

        let symbols = parse_bib_symbols("refs.bib", content);
        let details = symbols
            .iter()
            .map(|symbol| (symbol.key.as_str(), symbol.detail.as_deref().unwrap_or("")))
            .collect::<HashMap<_, _>>();

        assert_eq!(symbols[0].line, 4);
        assert_eq!(
            details.get("chen2026toc").copied(),
            Some(
                "inproceedings · Chen et al. · 2026 · TOC-Bench: Evaluating Temporal Object Consistency",
            )
        );
        assert_eq!(
            details.get("zhao2025quoted").copied(),
            Some("article · Zhao & Gui · 2025 · Nested Video-LLM Reasoning")
        );

        let malformed = "@article{kept2026,\n  title={Still indexed}\n\n@article{next2027,\n";
        let fallback = parse_bib_symbols("broken.bib", malformed);
        assert_eq!(
            fallback
                .iter()
                .map(|symbol| (symbol.key.as_str(), symbol.detail.as_deref().unwrap_or("")))
                .collect::<Vec<_>>(),
            vec![("kept2026", "article"), ("next2027", "article")]
        );
    }

    #[test]
    fn indexes_unresolved_project_references() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\section{Intro}\\label{sec:intro}\nKnown \\ref{sec:intro} and missing \\ref{sec:missing}.\nCites \\cite{smith2026latex, missing2026}. % \\cite{hidden2026}\n\\nocite{*}\n",
        )
        .unwrap();
        fs::write(
            root.join("refs.bib"),
            "@article{smith2026latex,\n  title={Local LaTeX}\n}\n",
        )
        .unwrap();

        let issues = list_project_reference_issues(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].kind, "label");
        assert_eq!(issues[0].key, "sec:missing");
        assert_eq!(issues[0].file, "main.tex");
        assert_eq!(issues[0].line, 2);
        assert_eq!(issues[1].kind, "citation");
        assert_eq!(issues[1].key, "missing2026");
        assert_eq!(issues[1].line, 3);
        assert!(issues.iter().all(|issue| issue.key != "hidden2026"));
        assert!(issues.iter().all(|issue| issue.key != "*"));
    }

    #[test]
    fn indexes_project_todo_comments() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\section{Intro} % TODO: tighten motivation\nEscaped \\% TODO: not a comment\n% FIXME - repair citation\n% REVIEW: check claim\nClaim text.\n% REVIEW-END\n",
        )
        .unwrap();
        fs::write(
            root.join("sections/method.tex"),
            "Text % note: check notation\nMore text % 待办：补实验设置\n% RESOLVED TODO: old issue\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".latex-studio")).unwrap();
        fs::write(root.join(".latex-studio/hidden.tex"), "% TODO: hidden\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let todos = list_project_todos(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(todos.len(), 6);
        assert_eq!(todos[0].kind, "TODO");
        assert_eq!(todos[0].message, "tighten motivation");
        assert_eq!(todos[0].file, "main.tex");
        assert_eq!(todos[0].line, 1);
        assert!(!todos[0].resolved);
        assert_eq!(todos[1].kind, "FIXME");
        assert!(todos.iter().any(|item| item.kind == "NOTE"));
        assert!(todos
            .iter()
            .any(|item| item.kind == "REVIEW" && item.message == "check claim"));
        assert!(todos.iter().all(|item| item.message != "END"));
        assert!(todos.iter().any(|item| item.message == "补实验设置"));
        assert!(todos
            .iter()
            .any(|item| item.message == "old issue" && item.resolved));
        assert!(todos
            .iter()
            .all(|item| !item.file.contains(".latex-studio")));
    }

    #[test]
    fn validates_and_updates_project_settings() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        fs::write(root.join("paper.tex"), "paper\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let summary = update_project_settings(
            root.to_string_lossy().to_string(),
            ProjectSettings {
                display_name: Some("Paper Project".to_string()),
                main_file: "paper.tex".to_string(),
                engine: "lualatex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: vec!["-bibtex".to_string(), "-silent".to_string()],
            },
        )
        .unwrap();
        assert_eq!(summary.name, "Paper Project");
        assert_eq!(summary.main_file, "paper.tex");
        let settings = get_project_settings(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(settings.engine, "lualatex");
        assert_eq!(settings.compile_args, vec!["-bibtex", "-silent"]);

        assert!(update_project_settings(
            root.to_string_lossy().to_string(),
            ProjectSettings {
                display_name: None,
                main_file: "../outside.tex".to_string(),
                engine: "xelatex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: Vec::new(),
            },
        )
        .is_err());
        assert!(update_project_settings(
            root.to_string_lossy().to_string(),
            ProjectSettings {
                display_name: None,
                main_file: "paper.tex".to_string(),
                engine: "unknowntex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: Vec::new(),
            },
        )
        .is_err());
        assert!(update_project_settings(
            root.to_string_lossy().to_string(),
            ProjectSettings {
                display_name: None,
                main_file: "paper.tex".to_string(),
                engine: "xelatex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: vec!["-shell-escape".to_string()],
            },
        )
        .is_err());
        assert!(update_project_settings(
            root.to_string_lossy().to_string(),
            ProjectSettings {
                display_name: None,
                main_file: "paper.tex".to_string(),
                engine: "xelatex".to_string(),
                build_dir: ".latex-studio/build".to_string(),
                compile_args: vec!["paper.tex".to_string()],
            },
        )
        .is_err());
    }

    #[test]
    fn reads_only_project_pdf_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let pdf = root.join("main.pdf");
        let text = root.join("notes.txt");
        fs::write(&pdf, b"%PDF-1.4 fake").unwrap();
        fs::write(&text, "not a pdf").unwrap();

        let bytes = read_pdf_file(
            root.to_string_lossy().to_string(),
            pdf.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(bytes, b"%PDF-1.4 fake");
        assert!(read_pdf_file(
            root.to_string_lossy().to_string(),
            text.to_string_lossy().to_string()
        )
        .is_err());
    }

    #[test]
    fn reads_only_supported_project_asset_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("figures")).unwrap();
        fs::write(root.join("figures/plot.png"), b"fake png").unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();

        let asset = read_project_asset_file(
            root.to_string_lossy().to_string(),
            "figures/plot.png".to_string(),
        )
        .unwrap();

        assert_eq!(asset.path, "figures/plot.png");
        assert_eq!(asset.mime_type, "image/png");
        assert_eq!(asset.bytes, b"fake png");
        assert!(read_project_asset_file(
            root.to_string_lossy().to_string(),
            "main.tex".to_string()
        )
        .is_err());
        assert!(read_project_asset_file(
            root.to_string_lossy().to_string(),
            "../plot.png".to_string()
        )
        .is_err());
    }

    #[test]
    fn detects_existing_project_pdf_output() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        assert_eq!(
            get_existing_pdf_output(root.to_string_lossy().to_string()).unwrap(),
            None
        );

        fs::create_dir_all(root.join(".latex-studio/build")).unwrap();
        let pdf = root.join(".latex-studio/build/main.pdf");
        fs::write(&pdf, b"%PDF-1.4 fake").unwrap();

        assert_eq!(
            get_existing_pdf_output(root.to_string_lossy().to_string()).unwrap(),
            Some(pdf.to_string_lossy().to_string())
        );
    }

    #[test]
    fn parses_synctex_forward_result() {
        let output = r#"
This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:build/main.pdf
Page:2
x:133.768356
y:134.764618
h:133.768356
v:134.764618
W:343.711060
H:9.962625
before:
offset:-1
middle:
after:
SyncTeX result end
"#;

        let location = parse_synctex_forward_output(output).unwrap();

        assert_eq!(location.page, 2);
        assert!((location.x - 133.768356).abs() < 0.0001);
        assert!((location.y - 134.764618).abs() < 0.0001);
        assert!((location.width - 343.711060).abs() < 0.0001);
        assert!((location.height - 9.962625).abs() < 0.0001);
    }

    #[test]
    fn rejects_synctex_forward_source_escape() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();

        assert!(synctex_forward_search(
            root.to_string_lossy().to_string(),
            "../main.tex".to_string(),
            1,
            Some(1),
            None,
        )
        .is_err());
    }

    #[test]
    fn parses_synctex_reverse_result() {
        let output = r#"
This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:build/main.pdf
Input:/private/tmp/example/./sections/method.tex
Line:42
Column:-1
Offset:0
Context:
SyncTeX result end
"#;

        let location = parse_synctex_reverse_output(output).unwrap();

        assert_eq!(location.file, "/private/tmp/example/./sections/method.tex");
        assert_eq!(location.line, 42);
        assert_eq!(location.column, None);
    }

    #[test]
    fn rejects_synctex_reverse_source_escape() {
        let root_temp = tempfile::tempdir().unwrap();
        let outside_temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root_temp.path()).unwrap();
        let outside = fs::canonicalize(outside_temp.path()).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        let outside_source = outside.join("outside.tex");
        fs::write(&outside_source, "outside\n").unwrap();

        assert!(canonicalize_synctex_input(&root, &outside_source.to_string_lossy()).is_err());
    }

    #[test]
    fn copies_pdf_export_to_target() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("main.pdf");
        let target = temp.path().join("exports").join("paper.pdf");
        fs::write(&source, b"%PDF-1.4 fake").unwrap();

        copy_pdf_export(&source, &target).unwrap();

        assert_eq!(fs::read(target).unwrap(), b"%PDF-1.4 fake");
    }

    #[test]
    fn exports_and_imports_project_zip_without_external_commands() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("paper sample");
        fs::create_dir_all(root.join("figures")).unwrap();
        fs::create_dir_all(root.join(".latex-studio/build")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("main.tex"), "main\n").unwrap();
        fs::write(root.join("references.bib"), "@article{x}\n").unwrap();
        fs::write(root.join("figures/diagram.pdf"), b"%PDF figure").unwrap();
        fs::write(root.join("main.log"), "generated").unwrap();
        fs::write(root.join("main.pdf"), "compiled").unwrap();
        fs::write(root.join(".latex-studio/build/main.pdf"), b"%PDF build").unwrap();
        fs::write(root.join(".git/config"), "git").unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let export_path = temp.path().join("paper-export.zip");
        export_project_zip_to_path(&root, &ProjectSettings::default(), &export_path).unwrap();
        validate_zip_archive_entries(&export_path).unwrap();

        let mut archive = open_zip_archive(&export_path).unwrap();
        let mut names = Vec::new();
        for index in 0..archive.len() {
            names.push(archive.by_index(index).unwrap().name().to_string());
        }
        names.sort();
        assert!(names.contains(&"paper-sample/main.tex".to_string()));
        assert!(names.contains(&"paper-sample/references.bib".to_string()));
        assert!(names.contains(&"paper-sample/figures/diagram.pdf".to_string()));
        assert!(!names.iter().any(|name| name.contains(".latex-studio")));
        assert!(!names.iter().any(|name| name.contains(".git")));
        assert!(!names.iter().any(|name| name.ends_with("main.log")));
        assert!(!names.iter().any(|name| name.ends_with("main.pdf")));
        drop(archive);

        let import_root = temp.path().join("imported paper");
        import_project_zip_to_root(&export_path, &import_root).unwrap();
        assert_eq!(
            fs::read_to_string(import_root.join("main.tex")).unwrap(),
            "main\n"
        );
        assert!(import_root.join("references.bib").exists());
        assert!(import_root.join("figures/diagram.pdf").exists());
        assert!(!import_root.join(".latex-studio.json").exists());
        assert!(!import_root.join(".git/config").exists());
        assert!(!import_root.join("main.log").exists());
        assert!(!import_root.join("main.pdf").exists());
    }

    #[test]
    fn rejects_unsafe_zip_archive_entries_before_import() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("unsafe.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("../evil.tex", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();

        assert!(validate_zip_archive_entries(&zip_path).is_err());
        let import_root = temp.path().join("imported");
        assert!(import_project_zip_to_root(&zip_path, &import_root).is_err());
        assert!(!import_root.exists());
    }

    #[test]
    fn resolves_only_project_pdf_outputs() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let pdf = root.join("main.pdf");
        let text = root.join("notes.txt");
        fs::write(&pdf, b"%PDF-1.4 fake").unwrap();
        fs::write(&text, "not a pdf").unwrap();

        let resolved = resolve_project_pdf_existing(&root, &pdf.to_string_lossy()).unwrap();
        assert_eq!(resolved, pdf);
        assert!(resolve_project_pdf_existing(&root, &text.to_string_lossy()).is_err());

        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), b"%PDF-1.4 fake").unwrap();
        assert!(resolve_project_pdf_existing(&root, &outside.path().to_string_lossy()).is_err());
    }

    #[test]
    fn snapshots_diffs_and_reverts_project_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "before\n").unwrap();

        create_snapshot(&root, "run-1").unwrap();
        fs::write(root.join("main.tex"), "after\n").unwrap();
        fs::write(root.join("extra.tex"), "new\n").unwrap();

        let diff = diff_snapshot(&root, "run-1").unwrap();
        assert!(diff.changed_files.contains(&"main.tex".to_string()));
        assert!(diff.changed_files.contains(&"extra.tex".to_string()));
        assert!(diff.unified_diff.contains("-before"));
        assert!(diff.unified_diff.contains("+after"));
        let mut saved_diff = diff.clone();
        saved_diff.prompt_preview = Some("Update draft".to_string());
        saved_diff.final_message = Some("Updated main and added extra notes.".to_string());
        save_diff_summary(&root, &saved_diff).unwrap();

        let partial = revert_snapshot_file(&root, "run-1", "main.tex").unwrap();
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "before\n"
        );
        assert_eq!(fs::read_to_string(root.join("extra.tex")).unwrap(), "new\n");
        assert!(!partial.changed_files.contains(&"main.tex".to_string()));
        assert!(partial.changed_files.contains(&"extra.tex".to_string()));
        assert_eq!(partial.prompt_preview.as_deref(), Some("Update draft"));
        assert_eq!(
            partial.final_message.as_deref(),
            Some("Updated main and added extra notes.")
        );
        assert!(diff_summary_path(&root, "run-1").exists());

        let empty = revert_snapshot_file(&root, "run-1", "extra.tex").unwrap();
        assert!(empty.changed_files.is_empty());
        assert!(!empty.can_revert);
        assert!(!root.join("extra.tex").exists());
        assert!(!diff_summary_path(&root, "run-1").exists());

        revert_snapshot(&root, "run-1").unwrap();
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "before\n"
        );
        assert!(!root.join("extra.tex").exists());
    }

    #[test]
    fn project_history_snapshots_list_and_restore_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "version one\n").unwrap();
        fs::write(root.join("notes.txt"), "keep me\n").unwrap();

        let item = create_project_history_snapshot_in_root(&root, "Before rewrite").unwrap();
        assert_eq!(item.label, "Before rewrite");
        assert_eq!(item.file_count, 2);

        fs::write(root.join("main.tex"), "version two\n").unwrap();
        fs::write(root.join("extra.tex"), "new file\n").unwrap();

        let diff = diff_project_history_snapshot(&root, &item.snapshot_id).unwrap();
        assert!(diff.changed_files.contains(&"main.tex".to_string()));
        assert!(diff.changed_files.contains(&"extra.tex".to_string()));
        assert!(diff.unified_diff.contains("-version one"));
        assert!(diff.unified_diff.contains("+version two"));
        assert!(diff.can_revert);

        restore_project_history_snapshot_in_root(&root, &item.snapshot_id).unwrap();

        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "version one\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("notes.txt")).unwrap(),
            "keep me\n"
        );
        assert!(!root.join("extra.tex").exists());

        let history = list_project_history_items(&root).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].snapshot_id, item.snapshot_id);
        assert!(restore_project_history_snapshot_in_root(&root, "../bad").is_err());
    }

    #[test]
    fn lists_saved_codex_history_items() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let first = DiffSummary {
            run_id: "run-a".to_string(),
            changed_files: vec!["main.tex".to_string()],
            unified_diff: "diff a".to_string(),
            can_revert: true,
            scope_reverted_files: Vec::new(),
            prompt_preview: Some("Polish the introduction".to_string()),
            final_message: Some("Polished the opening paragraph.".to_string()),
        };
        let second = DiffSummary {
            run_id: "run-b".to_string(),
            changed_files: vec!["sections/intro.tex".to_string()],
            unified_diff: "diff b".to_string(),
            can_revert: true,
            scope_reverted_files: Vec::new(),
            prompt_preview: None,
            final_message: None,
        };
        save_diff_summary(&root, &first).unwrap();
        save_diff_summary(&root, &second).unwrap();

        let history = list_codex_history(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(history.len(), 2);
        assert!(history.iter().any(|item| {
            item.run_id == "run-a"
                && item.changed_files == vec!["main.tex".to_string()]
                && item.prompt_preview.as_deref() == Some("Polish the introduction")
                && item.final_message.as_deref() == Some("Polished the opening paragraph.")
        }));
        assert!(history.iter().any(|item| item.run_id == "run-b"));
    }

    #[test]
    fn codex_prompt_preview_omits_studio_context_and_truncates() {
        let prompt =
            "Polish this paragraph.\n\nProject context from LaTeX Studio:\n- Main file: main.tex";
        assert_eq!(
            codex_prompt_preview(prompt).as_deref(),
            Some("Polish this paragraph.")
        );

        let long_prompt = "重写".repeat(120);
        let preview = codex_prompt_preview(&long_prompt).unwrap();
        assert!(preview.ends_with('…'));
        assert!(preview.chars().count() <= 181);
    }

    #[test]
    fn builds_codex_workspace_write_command() {
        let root = PathBuf::from("/tmp/example");
        let last_message = PathBuf::from("/tmp/last-message.txt");
        let args = build_codex_args(&root, "make the abstract shorter", &last_message);
        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--skip-git-repo-check".to_string()));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(args.windows(2).any(|pair| pair == ["--cd", "/tmp/example"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output-last-message", "/tmp/last-message.txt"]));
    }

    #[test]
    fn builds_codex_read_only_ask_command() {
        let root = PathBuf::from("/tmp/example");
        let last_message = PathBuf::from("/tmp/ask-last-message.txt");
        let args = build_codex_ask_args(&root, "explain the selected theorem", &last_message);
        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--skip-git-repo-check".to_string()));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args.windows(2).any(|pair| pair == ["--cd", "/tmp/example"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output-last-message", "/tmp/ask-last-message.txt"]));
    }

    #[test]
    fn codex_ask_flow_returns_plain_text_without_diff() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("main.tex"), "\\section{Intro}\n").unwrap();

        let fake_codex = root.join("codex-ask-fake.sh");
        let mut codex_file = fs::File::create(&fake_codex).unwrap();
        write!(
            codex_file,
            "{}",
            r#"#!/bin/sh
last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
if [ -z "$last_message" ]; then
  echo "missing --output-last-message" >&2
  exit 42
fi
printf '%s\n' '{"type":"thread.started"}'
printf '%s\n' 'This stdout fallback should not win.'
printf '%s\n' 'This section introduces the paper via last-message.' > "$last_message"
"#
        )
        .unwrap();
        make_executable(&fake_codex);

        let result = run_codex_ask_blocking_with_tool(
            None,
            CodexAskRequest {
                project_root: root.to_string_lossy().to_string(),
                prompt: "Explain this".to_string(),
            },
            Some(fake_codex),
        )
        .unwrap();

        assert!(result.response.contains("via last-message"));
        assert!(!result.response.contains("fallback should not win"));
        assert!(result
            .command
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(result
            .command
            .windows(2)
            .any(|pair| pair[0] == "--output-last-message"));
        assert!(!project_meta_dir(&root).join("codex").exists());
    }

    #[test]
    fn codex_wait_timeout_kills_child_and_clears_active_run() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let key = format!("timeout-{}", Uuid::new_v4());
        active_codex_runs()
            .lock()
            .unwrap()
            .insert(key.clone(), child.id());

        let result = wait_for_codex_child_with_timeout(
            &mut child,
            &key,
            None,
            "timeout-test",
            Duration::from_millis(50),
        )
        .unwrap();

        assert!(matches!(result, CodexWaitResult::TimedOut));
        assert!(!active_codex_runs().lock().unwrap().contains_key(&key));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn codex_flow_edits_diffs_autocompiles_and_reverts_with_fake_cli() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}\n",
        )
        .unwrap();
        let settings = ProjectSettings {
            compile_args: vec!["-bibtex".to_string(), "-silent".to_string()],
            ..ProjectSettings::default()
        };
        write_json(&root.join(".latex-studio.json"), &settings).unwrap();

        let fake_codex = root.join("codex-fake.sh");
        let mut codex_file = fs::File::create(&fake_codex).unwrap();
        write!(
            codex_file,
            "{}",
            r#"#!/bin/sh
last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
if [ -z "$last_message" ]; then
  echo "missing --output-last-message" >&2
  exit 42
fi
printf '%s\n' '{"type":"thread.started"}'
printf '%s\n' '{"type":"turn.started"}'
tmp="main.tex.tmp"
while IFS= read -r line; do
  if [ "$line" = '\end{document}' ]; then
    printf '%s\n' '\section{QA Notes}' 'Added by fake Codex.'
  fi
  printf '%s\n' "$line"
done < main.tex > "$tmp"
mv "$tmp" main.tex
printf '%s\n' 'Added a QA Notes section and kept the document valid.' > "$last_message"
printf '%s\n' '{"type":"turn.completed"}'
"#
        )
        .unwrap();
        make_executable(&fake_codex);

        let fake_latexmk = root.join("latexmk-fake.sh");
        let mut latexmk_file = fs::File::create(&fake_latexmk).unwrap();
        write!(
            latexmk_file,
            "{}",
            r#"#!/bin/sh
outdir=""
main="main.tex"
for arg in "$@"; do
  case "$arg" in
    -outdir=*) outdir="${arg#-outdir=}" ;;
    *.tex) main="$arg" ;;
  esac
done
mkdir -p "$outdir"
stem="${main%.tex}"
printf '%s\n' '%PDF-1.4 fake' > "$outdir/$stem.pdf"
echo 'fake latexmk ok'
"#
        )
        .unwrap();
        make_executable(&fake_latexmk);

        let summary = run_codex_edit_blocking_with_tools(
            None,
            CodexRunRequest {
                project_root: root.to_string_lossy().to_string(),
                prompt: "Add a QA notes section.".to_string(),
                auto_compile: Some(true),
                allowed_files: None,
            },
            Some(fake_codex),
            Some(fake_latexmk),
        )
        .unwrap();

        assert!(summary.changed_files.contains(&"main.tex".to_string()));
        assert_eq!(
            summary.final_message.as_deref(),
            Some("Added a QA Notes section and kept the document valid.")
        );
        assert!(summary.can_revert);
        assert!(summary.unified_diff.contains("+\\section{QA Notes}"));
        assert!(diff_summary_path(&root, &summary.run_id).exists());
        assert!(fs::read_to_string(root.join("main.tex"))
            .unwrap()
            .contains("\\section{QA Notes}"));
        assert!(root.join(".latex-studio/build/main.pdf").exists());

        revert_snapshot(&root, &summary.run_id).unwrap();
        let reverted = fs::read_to_string(root.join("main.tex")).unwrap();
        assert!(reverted.contains("Original"));
        assert!(!reverted.contains("QA Notes"));
    }

    #[test]
    fn codex_allowed_file_scope_reverts_out_of_scope_changes_before_compile() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir_all(root.join("sections")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}\n",
        )
        .unwrap();
        fs::write(
            root.join("sections/method.tex"),
            "Method stays unchanged.\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let fake_codex = root.join("codex-scope.sh");
        let mut codex_file = fs::File::create(&fake_codex).unwrap();
        write!(
            codex_file,
            "{}",
            r#"#!/bin/sh
last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
if [ -z "$last_message" ]; then
  echo "missing --output-last-message" >&2
  exit 42
fi
printf '%s\n' '{"type":"thread.started"}'
printf '%s\n' '{"type":"turn.started"}'
tmp="main.tex.tmp"
while IFS= read -r line; do
  if [ "$line" = '\end{document}' ]; then
    printf '%s\n' '\section{Allowed Scope}' 'Only this file should remain changed.'
  fi
  printf '%s\n' "$line"
done < main.tex > "$tmp"
mv "$tmp" main.tex
printf '%s\n' 'OUT OF SCOPE' > sections/method.tex
printf '%s\n' 'OUT OF SCOPE NEW FILE' > extra.tex
printf '%s\n' 'Changed one allowed file and one disallowed file.' > "$last_message"
printf '%s\n' '{"type":"turn.completed"}'
"#
        )
        .unwrap();
        make_executable(&fake_codex);

        let fake_latexmk = root.join("latexmk-scope.sh");
        let mut latexmk_file = fs::File::create(&fake_latexmk).unwrap();
        write!(
            latexmk_file,
            "{}",
            r#"#!/bin/sh
if grep -q 'OUT OF SCOPE' sections/method.tex; then
  echo "scope enforcement did not run before compile" >&2
  exit 44
fi
outdir=""
main="main.tex"
for arg in "$@"; do
  case "$arg" in
    -outdir=*) outdir="${arg#-outdir=}" ;;
    *.tex) main="$arg" ;;
  esac
done
mkdir -p "$outdir"
stem="${main%.tex}"
printf '%s\n' '%PDF-1.4 fake' > "$outdir/$stem.pdf"
echo 'fake latexmk ok'
"#
        )
        .unwrap();
        make_executable(&fake_latexmk);

        let summary = run_codex_edit_blocking_with_tools(
            None,
            CodexRunRequest {
                project_root: root.to_string_lossy().to_string(),
                prompt: "Only update main.tex.".to_string(),
                auto_compile: Some(true),
                allowed_files: Some(vec!["main.tex".to_string()]),
            },
            Some(fake_codex),
            Some(fake_latexmk),
        )
        .unwrap();

        assert_eq!(summary.changed_files, vec!["main.tex".to_string()]);
        assert_eq!(
            summary.scope_reverted_files,
            vec!["extra.tex".to_string(), "sections/method.tex".to_string()]
        );
        assert!(summary.unified_diff.contains("+\\section{Allowed Scope}"));
        assert!(fs::read_to_string(root.join("main.tex"))
            .unwrap()
            .contains("\\section{Allowed Scope}"));
        assert_eq!(
            fs::read_to_string(root.join("sections/method.tex")).unwrap(),
            "Method stays unchanged.\n"
        );
        assert!(!root.join("extra.tex").exists());
        assert!(root.join(".latex-studio/build/main.pdf").exists());

        let saved = load_saved_diff_summary(&root, &summary.run_id).unwrap();
        assert_eq!(saved.scope_reverted_files, summary.scope_reverted_files);
    }

    #[test]
    fn codex_no_change_flow_does_not_create_diff_or_autocompile() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let fake_codex = root.join("codex-no-change.sh");
        let mut codex_file = fs::File::create(&fake_codex).unwrap();
        write!(
            codex_file,
            "{}",
            r#"#!/bin/sh
last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
if [ -z "$last_message" ]; then
  echo "missing --output-last-message" >&2
  exit 42
fi
printf '%s\n' '{"type":"thread.started"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' 'No source changes were needed.' > "$last_message"
printf '%s\n' '{"type":"turn.completed"}'
"#
        )
        .unwrap();
        make_executable(&fake_codex);

        let fake_latexmk = root.join("latexmk-should-not-run.sh");
        let mut latexmk_file = fs::File::create(&fake_latexmk).unwrap();
        write!(
            latexmk_file,
            "{}",
            r#"#!/bin/sh
printf '%s\n' ran > latexmk-was-run.txt
"#
        )
        .unwrap();
        make_executable(&fake_latexmk);

        let summary = run_codex_edit_blocking_with_tools(
            None,
            CodexRunRequest {
                project_root: root.to_string_lossy().to_string(),
                prompt: "Do not change anything.".to_string(),
                auto_compile: Some(true),
                allowed_files: None,
            },
            Some(fake_codex),
            Some(fake_latexmk),
        )
        .unwrap();

        assert!(summary.changed_files.is_empty());
        assert!(!summary.can_revert);
        assert!(summary.unified_diff.is_empty());
        assert!(!diff_summary_path(&root, &summary.run_id).exists());
        assert!(!root.join("latexmk-was-run.txt").exists());
        assert!(list_codex_history_items(&root).unwrap().is_empty());
    }

    #[test]
    fn compile_flow_works_with_fake_latexmk() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        let settings = ProjectSettings {
            compile_args: vec!["-bibtex".to_string(), "-silent".to_string()],
            ..ProjectSettings::default()
        };
        write_json(&root.join(".latex-studio.json"), &settings).unwrap();

        let fake = root.join("latexmk-fake.sh");
        let mut file = fs::File::create(&fake).unwrap();
        writeln!(
            file,
            "#!/bin/sh\noutdir=\"\"\necho \"args:$*\"\nfor arg in \"$@\"; do\n  case \"$arg\" in -outdir=*) outdir=\"${{arg#-outdir=}}\" ;;\n  esac\ndone\nmkdir -p \"$outdir\"\nprintf '%s\\n' '%PDF-1.4 fake' > \"$outdir/main.pdf\"\necho 'fake latexmk ok'\n"
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&fake).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&fake, permissions).unwrap();
        }

        let result = run_latex_compile(
            None,
            CompileRequest {
                project_root: root.to_string_lossy().to_string(),
                main_file: None,
            },
            Some(fake),
        )
        .unwrap();

        assert!(result.success);
        assert!(result.pdf_path.unwrap().ends_with("main.pdf"));
        assert!(result.log.contains("fake latexmk ok"));
        assert!(result.log.contains("-bibtex"));
        assert!(result.log.contains("-silent"));
        assert!(result.command.contains(&"-bibtex".to_string()));
        assert!(result.command.contains(&"-silent".to_string()));
    }

    #[test]
    fn successful_compile_discards_stale_error_diagnostics() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}Fixed\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let fake = root.join("latexmk-fake-stale-log.sh");
        let mut file = fs::File::create(&fake).unwrap();
        writeln!(
            file,
            "#!/bin/sh\noutdir=\"\"\nfor arg in \"$@\"; do\n  case \"$arg\" in -outdir=*) outdir=\"${{arg#-outdir=}}\" ;;\n  esac\ndone\nmkdir -p \"$outdir\"\nprintf '%s\\n' './main.tex:11: Undefined control sequence.' 'l.11 \\\\nput' 'Output written on .latex-studio/build/main.xdv (1 page).' > \"$outdir/main.log\"\nprintf '%s\\n' '%PDF-1.4 fake' > \"$outdir/main.pdf\"\necho 'fake latexmk recovered'\n"
        )
        .unwrap();
        make_executable(&fake);

        let result = run_latex_compile(
            None,
            CompileRequest {
                project_root: root.to_string_lossy().to_string(),
                main_file: None,
            },
            Some(fake),
        )
        .unwrap();

        assert!(result.success);
        assert!(result.log.contains("Undefined control sequence"));
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn compile_flow_cleans_stale_latexmk_failure_and_retries() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}Recovered\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let fake = root.join("latexmk-fake-stale-cache.sh");
        let mut file = fs::File::create(&fake).unwrap();
        writeln!(
            file,
            r#"#!/bin/sh
outdir=""
for arg in "$@"; do
  case "$arg" in -outdir=*) outdir="${{arg#-outdir=}}" ;;
  esac
done
mkdir -p "$outdir"
if [ ! -f latexmk-attempted-once.txt ]; then
  touch latexmk-attempted-once.txt
  printf '%s\n' stale > "$outdir/stale-cache.txt"
  printf '%s\n' "Latexmk: applying rule 'bibtex .latex-studio/build/main'..." \
    "I found no \\bibdata command---while reading file main.aux" \
    "Collected error summary (may duplicate other messages):" \
    "  xelatex: gave an error in previous invocation of latexmk." >&2
  exit 12
fi
if [ -f "$outdir/stale-cache.txt" ]; then
  echo "stale cache was not cleaned" >&2
  exit 13
fi
printf '%s\n' '%PDF-1.4 fake' > "$outdir/main.pdf"
printf '%s\n' 'fake retry ok'
"#
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&fake).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&fake, permissions).unwrap();
        }

        let result = run_latex_compile(
            None,
            CompileRequest {
                project_root: root.to_string_lossy().to_string(),
                main_file: None,
            },
            Some(fake),
        )
        .unwrap();

        assert!(result.success);
        assert!(result.log.contains("--- LaTeX Studio clean retry ---"));
        assert!(result.log.contains("fake retry ok"));
        assert!(!root.join(".latex-studio/build/stale-cache.txt").exists());
    }

    #[test]
    fn clean_project_build_removes_cached_files_safely() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();
        fs::create_dir_all(root.join(".latex-studio/build/nested")).unwrap();
        fs::write(root.join(".latex-studio/build/main.aux"), "stale").unwrap();
        fs::write(root.join(".latex-studio/build/nested/cache.txt"), "stale").unwrap();

        clean_project_build(root.to_string_lossy().to_string()).unwrap();

        assert!(root.join(".latex-studio/build").is_dir());
        assert!(!root.join(".latex-studio/build/main.aux").exists());
        assert!(!root.join(".latex-studio/build/nested/cache.txt").exists());
    }

    #[test]
    fn clean_project_build_refuses_project_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        let mut settings = ProjectSettings::default();
        settings.build_dir = ".".to_string();
        write_json(&root.join(".latex-studio.json"), &settings).unwrap();

        let err = clean_project_build(root.to_string_lossy().to_string()).unwrap_err();

        assert!(err.contains("项目根目录"));
        assert!(root.join("main.tex").exists());
    }

    #[test]
    fn compile_flow_reads_build_log_for_diagnostics() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}\\badcommand\\end{document}\n",
        )
        .unwrap();
        write_json(
            &root.join(".latex-studio.json"),
            &ProjectSettings::default(),
        )
        .unwrap();

        let fake = root.join("latexmk-fake-error.sh");
        let mut file = fs::File::create(&fake).unwrap();
        writeln!(
            file,
            "#!/bin/sh\noutdir=\"\"\nfor arg in \"$@\"; do\n  case \"$arg\" in -outdir=*) outdir=\"${{arg#-outdir=}}\" ;;\n  esac\ndone\nmkdir -p \"$outdir\"\nprintf '%s\\n' './main.tex:4: Undefined control sequence.' 'l.4 \\\\badcommand' > \"$outdir/main.log\"\necho 'fake latexmk failed'\nexit 12\n"
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&fake).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&fake, permissions).unwrap();
        }

        let result = run_latex_compile(
            None,
            CompileRequest {
                project_root: root.to_string_lossy().to_string(),
                main_file: None,
            },
            Some(fake),
        )
        .unwrap();

        assert!(!result.success);
        assert!(result.log.contains("--- LaTeX .log ---"));
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].file.as_deref(), Some("main.tex"));
        assert_eq!(result.diagnostics[0].line, Some(4));
    }

    #[test]
    fn humanizes_codex_jsonl_progress() {
        let event = humanize_codex_output_line(r#"{"type":"turn.started"}"#, false).unwrap();
        assert_eq!(event.0, "progress");
        assert_eq!(event.1, "Codex 正在分析项目并准备修改。");
        let message_event = humanize_codex_output_line(
            r#"{"type":"item.completed","item":{"type":"message","content":[{"type":"output_text","text":"我已经修改了摘要。"}]}}"#,
            false,
        )
        .unwrap();
        assert_eq!(message_event.0, "assistant");
        assert_eq!(message_event.1, "我已经修改了摘要。");
        let agent_message_event = humanize_codex_output_line(
            r#"{"type":"agent_message","message":"已补充 evaluate 和 conclusion 两节。"}"#,
            false,
        )
        .unwrap();
        assert_eq!(agent_message_event.0, "assistant");
        assert_eq!(
            agent_message_event.1,
            "已补充 evaluate 和 conclusion 两节。"
        );
        assert!(humanize_codex_output_line(r#"{"type":"unknown.event"}"#, false).is_none());
    }
}
