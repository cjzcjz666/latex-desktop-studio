# LaTeX Desktop Studio

LaTeX Desktop Studio is a local-first desktop LaTeX editor inspired by Overleaf, with Codex built directly into the writing workflow. It is designed for people who write multi-file papers locally but still want a focused editor, PDF preview, compile diagnostics, and natural-language editing without switching to a general-purpose IDE.

The app is built with Tauri, React, Vite, TypeScript, Monaco Editor, PDF.js, and Rust. LaTeX compilation and Codex runs happen on the local machine.

## What It Is

LaTeX Desktop Studio aims to feel like a local single-user Overleaf:

- a project file tree for `.tex`, `.bib`, figures, style files, and class files
- tabbed Monaco editing with LaTeX syntax highlighting
- PDF preview with page navigation, search, zoom, export, and SyncTeX source/PDF navigation
- compile diagnostics shown in the preview area when compilation fails
- review comments and TODO-style notes that can be handed to Codex
- a left-side Codex panel that can edit only the active LaTeX project
- diff review, accept, revert, and history after Codex edits
- save-based project history for manual and automatic saves

The distinguishing idea is that Codex is not a generic chat box next to a folder. The editor indexes the current LaTeX project and gives Codex structured context: current section, selected source, nearby labels/citations, `.bib` metadata, local `.sty/.cls` files, project-defined macros, document order, dependency graph, unresolved references, compile diagnostics, and review comments.

## Why Not Just VS Code + LaTeX Workshop + Codex?

VS Code is powerful, but it is intentionally general. This project optimizes for a narrower writing flow:

- The first screen is the paper workspace, not an IDE.
- Compile errors appear directly in the PDF preview space, where a LaTeX writer is already looking.
- Codex understands LaTeX project structure, not only the currently opened file.
- The app can constrain Codex to the active project and optionally to selected context files.
- Codex changes are shown as LaTeX-aware diffs and highlighted inside the editor.
- Review comments, unresolved references, compile diagnostics, and document structure can be sent to Codex with one click.
- Local-only project storage keeps source files under the user's chosen project root.

The goal is not to replace every IDE feature. It is to make the common paper-writing loop faster and calmer.

## Current Features

### Project Workspace

- Create, open, rename, import, and export LaTeX projects.
- Multi-file project model with `main.tex`, sections, bibliographies, figures, `.sty`, `.cls`, and related assets.
- Per-project `.latex-studio.json` settings for main file, build directory, engine preferences, and safe extra `latexmk` arguments.
- File tree with inline create, rename, delete, import, and main-file controls.
- Quick open, project-wide search, grouped search results, and project-wide replace with rollback snapshots.
- Project templates for article drafts, preprints, multi-file papers, Chinese documents, Beamer slides, and blank projects.

### Editor

- Monaco-based LaTeX editor with a white writing theme.
- Command, comment, string, delimiter, and operator highlighting.
- Tabs with dirty-state tracking, save/discard close confirmation, and session restore.
- Native current-file find and replace.
- Configurable shortcuts.
- Line comment toggle.
- Insert helpers for common LaTeX snippets.
- Word wrap and persisted editor font size.
- Hover and completion support for project file references, labels, citations, and BibTeX metadata.

### Compile And Preview

- Default compile pipeline is `latexmk` with `xelatex`.
- Compile arguments include `-interaction=nonstopmode`, `-file-line-error`, `-synctex=1`, and `-halt-on-error`.
- Hidden build output under the project metadata directory.
- Successful compile refreshes the PDF preview.
- Failed compile shows a diagnostic view in the PDF preview area instead of opening a noisy log panel.
- Clickable diagnostics jump to source lines.
- Missing-package hints can expose copyable install commands.
- Manual "compile from scratch" clears stale build artifacts before retrying.
- PDF preview supports page jump, search, zoom, export, reveal/open output, high-DPI rendering, and SyncTeX navigation.

### Codex Editing

- Uses the local Codex CLI from `PATH` or `/Applications/Codex.app/Contents/Resources/codex`.
- No separate OpenAI API key is required by the app.
- Runs Codex with the active LaTeX project as the working directory.
- Streams progress events into a chat-like transcript.
- Captures final Codex output for ask-only runs.
- Creates pre-run snapshots and unified diffs for edit runs.
- Shows changed files and per-file diffs.
- Highlights additions and removals in the editor.
- Supports accepting changes, reverting an entire Codex run, or reverting one changed file.
- Can auto-recompile after Codex edits.
- Can retry failed Codex runs with fresh context.
- Can use `@file` and `#label` / `#citation` mentions inside the prompt.
- Can add outline items, review comments, document-order entries, and file dependencies to Codex context with one click.
- Can optionally include the current diff as context for follow-up edits.
- Can lock Codex to selected editor context or context files.

### Review And History

- Review mode with configurable shortcuts.
- `% TODO:`, `% FIXME:`, `% NOTE:`, and `% REVIEW:` comments are indexed in the sidebar.
- `% REVIEW:` blocks can highlight reviewed source ranges until `% REVIEW-END`.
- Review comments can be marked resolved or restored.
- Codex can fix one comment or batch-process unresolved comments.
- Project history is created from actual manual saves or automatic saves when content changes.
- Structural operations such as rename, delete, replace, and restore create rollback snapshots.
- History diff preview and restore are available from the top bar.

### Safety Model

- Backend file operations normalize paths under the project root.
- `../` escapes and symlink escapes are rejected.
- Project build/cache files are hidden under `.latex-studio/`.
- File listing hides internal metadata and build artifacts.
- Codex is run against the active LaTeX project, not this app's source tree.
- Codex snapshots and project history support rollback.
- Project ZIP export excludes build output and internal metadata.

## Requirements

### Required For Development

- macOS
- Node.js
- pnpm
- Rust and Cargo
- Tauri CLI, installed through the project dev dependency

### Required For LaTeX Compilation

Install a TeX distribution that provides:

- `latexmk`
- `xelatex`
- optionally `pdflatex` and `lualatex`

On macOS, MacTeX or BasicTeX are typical choices. If no TeX tools are found, the app still works for editing and Codex, but compile and PDF preview show setup guidance.

### Required For Codex Editing

Install and sign in to Codex locally. The app checks:

- `codex` on `PATH`
- `/Applications/Codex.app/Contents/Resources/codex`

The app does not ask for an OpenAI API key.

## Install And Run From Source

```bash
pnpm install
pnpm tauri dev
```

For UI-only development:

```bash
pnpm dev
```

The Vite dev server uses:

```text
http://127.0.0.1:1420/
```

The full desktop application runs through Tauri.

## Build

```bash
pnpm tauri build
```

The macOS app bundle is generated under:

```text
src-tauri/target/release/bundle/macos/LaTeX Desktop Studio.app
```

## Test

Run frontend and backend checks:

```bash
pnpm exec tsc --noEmit
node scripts/verify-ui-regressions.mjs
node scripts/test-editor-logic.mjs
cd src-tauri && cargo test
```

The Rust test suite includes fake `latexmk` and fake `codex` integration flows so the main compile/edit pipeline can be tested without requiring a full TeX Live installation in CI.

## Typical Workflow

1. Create or open a LaTeX project.
2. Edit `main.tex`, section files, bibliography files, or local style files.
3. Compile with the top-right compile button or the configured shortcut.
4. If compilation fails, inspect the diagnostics in the preview area and optionally ask Codex to explain or fix the error.
5. Use the PDF preview for reading, searching, and source/PDF navigation.
6. Add review comments while reading or editing.
7. Use Codex to revise selected text, fix comments, repair citations, or edit a specific project dependency.
8. Review the Codex diff, accept it, or revert all or part of it.
9. Use save history to inspect or restore earlier saved versions.
10. Export the PDF or the project source ZIP when ready.

## Repository Layout

```text
.
├── src/                    # React, TypeScript, Monaco, PDF.js UI
├── src/components/         # UI components
├── src/lib/                # Shared frontend logic
├── src-tauri/              # Rust backend and Tauri configuration
├── scripts/                # Local regression and editor-logic checks
├── package.json            # Frontend scripts and dependencies
├── pnpm-lock.yaml          # pnpm lockfile
└── README.md
```

## Privacy Notes

This repository is intended to contain application source code only. It should not contain:

- user LaTeX projects
- `.latex-studio/` project metadata
- compiled PDFs or build directories
- local Codex conversation state outside project metadata
- API keys, tokens, private keys, or `.env` files
- `node_modules`, pnpm store, Vite build output, or Rust target output

Before publishing, the repository should be checked with a secret scan and file-size scan. The included `.gitignore` excludes common local and build artifacts.

## Limitations

- v1 is local-only and single-user.
- There is no cloud sync, comments collaboration, accounts, or realtime co-editing.
- The app expects local TeX tooling for real compilation.
- Codex behavior depends on the installed local Codex CLI and its login state.
- The UI currently focuses on macOS desktop packaging.

## Roadmap Ideas

- More complete Overleaf-style project history.
- Richer PDF/source SyncTeX interactions.
- Better large-project performance profiling.
- Optional templates marketplace or local template library.
- More granular Codex edit scopes and preflight review.
- Visual diff overlays directly in the editor gutter.
- Optional automated release packaging.
