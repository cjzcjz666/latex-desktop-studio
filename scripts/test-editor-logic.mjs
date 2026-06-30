import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourcePath = new URL("../src/lib/editorLogic.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: "editorLogic.ts",
});

const tempDir = mkdtempSync(join(tmpdir(), "latex-studio-editor-logic-"));
const modulePath = join(tempDir, "editorLogic.mjs");
writeFileSync(modulePath, compiled.outputText, "utf8");
const codexContextSourcePath = new URL("../src/lib/codexContext.ts", import.meta.url);
const codexContextSource = readFileSync(codexContextSourcePath, "utf8");
const compiledCodexContext = ts.transpileModule(codexContextSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: "codexContext.ts",
});
const codexContextModulePath = join(tempDir, "codexContext.mjs");
writeFileSync(codexContextModulePath, compiledCodexContext.outputText, "utf8");

try {
  const logic = await import(pathToFileURL(modulePath).href);
  const codexContext = await import(pathToFileURL(codexContextModulePath).href);

  assert.equal(logic.normalizeShortcutInput("Cmd + Shift + m"), "⌘⇧M");
  assert.equal(logic.normalizeShortcutInput("ctrl+enter"), "⌃↵");
  assert.equal(logic.normalizeShortcutInput("escape"), "ESC");
  assert.equal(
    logic.eventMatchesShortcut(
      { key: "m", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
      "⌘⇧M",
    ),
    true,
  );
  assert.equal(
    logic.eventMatchesShortcut(
      { key: "m", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
      "⌘⇧M",
    ),
    false,
  );

  assert.equal(logic.latexCommentStartIndex(String.raw`Escaped \% TODO: not a comment`), -1);
  assert.equal(logic.stripLatexLineComment(String.raw`\section{Intro} % TODO: tighten`), String.raw`\section{Intro} `);
  assert.deepEqual(logic.parseLatexTodoCommentText("RESOLVED REVIEW: clarify baseline"), {
    kind: "REVIEW",
    message: "clarify baseline",
    resolved: true,
  });
  assert.equal(logic.parseLatexTodoCommentText("REVIEW-END"), null);
  assert.equal(logic.isReviewEndCommentLine("% REVIEW-END"), true);
  assert.equal(logic.isReviewEndCommentLine(String.raw`Text \% REVIEW-END`), false);
  assert.equal(
    logic.formatCodexAnswerReviewComment("Add motivation.\nCheck citation.", "  ", "\\section{Intro}\n"),
    [
      "  % REVIEW: Codex 建议",
      "  % Add motivation.",
      "  % Check citation.",
      "\\section{Intro}",
      "  % REVIEW-END",
      "",
    ].join("\n"),
  );
  assert.equal(logic.formatCodexAnswerReviewComment("   "), "");

  const editorContext = {
    source: "editor",
    file: "sections/intro.tex",
    cursorLine: 12,
    cursorColumn: 4,
    activeSection: { kind: "section", title: "Introduction", line: 1, level: 2 },
    selectedText: "Selected paragraph.",
    selectedCharCount: 19,
    selectionStartLine: 10,
    selectionEndLine: 11,
    truncated: false,
    nearbyStartLine: 6,
    nearbyEndLine: 18,
    nearbyText: "Nearby source.",
    nearbyTruncated: false,
  };
  assert.equal(
    codexContext.formatCodexContextHint(editorContext),
    "sections/intro.tex:10-11 · 选区 19 字 · SEC Introduction",
  );
  assert.equal(codexContext.codexContextKindLabel(editorContext, true), "锁定选区");
  assert.deepEqual(codexContext.codexContextLineRange(editorContext), { startLine: 10, endLine: 11 });
  assert.deepEqual(codexContext.codexContextSource(editorContext), { text: "Selected paragraph.", startLine: 10 });

  const diffHunkContext = {
    ...editorContext,
    source: "diff-hunk",
    selectionStartLine: 20,
    selectionEndLine: 20,
    selectedText: "\\section{Revised}",
    selectedCharCount: 17,
  };
  assert.equal(
    codexContext.formatCodexContextHint(diffHunkContext),
    "sections/intro.tex:20 · Codex 片段 · SEC Introduction",
  );
  assert.equal(codexContext.codexContextKindLabel(diffHunkContext), "片段");
  assert.equal(codexContext.codexContextKindLabel(diffHunkContext, true), "锁定片段");

  const diff = [
    "--- a/main.tex",
    "+++ b/main.tex",
    "@@ -2,2 +2,3 @@",
    " context",
    "-old text",
    "+new text",
    "+extra line",
  ].join("\n");
  const files = logic.parseUnifiedDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, "main.tex");
  assert.deepEqual(
    files[0].lines.map((line) => [line.kind, line.oldLine ?? null, line.newLine ?? null, line.content]),
    [
      ["meta", null, null, "@@ -2,2 +2,3 @@"],
      ["context", 2, 2, "context"],
      ["remove", 3, 3, "old text"],
      ["add", null, 3, "new text"],
      ["add", null, 4, "extra line"],
    ],
  );
  assert.equal(logic.formatParsedDiffFile(files[0]), diff);
  const hunks = logic.parsedDiffHunks(files[0]);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    hunks.map((hunk) => [hunk.header, hunk.oldStart ?? null, hunk.newStart ?? null, hunk.added, hunk.removed]),
    [["@@ -2,2 +2,3 @@", 2, 2, 2, 1]],
  );
  assert.equal(logic.formatParsedDiffHunk(files[0], hunks[0]), diff);
  assert.equal(logic.codexDiffHunkKey(files[0].file, hunks[0]), logic.codexDiffHunkKey(files[0].file, hunks[0]));
  assert.notEqual(logic.codexDiffHunkKey(files[0].file, hunks[0]), logic.codexDiffHunkKey("other.tex", hunks[0]));
  assert.deepEqual(logic.codexDiffHunkReviewStats(diff), {
    totalHunks: 1,
    acceptedHunks: 0,
    pendingHunks: 1,
  });
  assert.deepEqual(logic.codexDiffHunkReviewStats(diff, [logic.codexDiffHunkKey(files[0].file, hunks[0])]), {
    totalHunks: 1,
    acceptedHunks: 1,
    pendingHunks: 0,
  });
  assert.equal(
    logic.revertParsedDiffHunkInContent("title\ncontext\nnew text\nextra line\nend\n", hunks[0]),
    "title\ncontext\nold text\nend\n",
  );
  assert.equal(
    logic.revertParsedDiffHunkInContent("title\r\ncontext\r\nnew text\r\nextra line\r\nend\r\n", hunks[0]),
    "title\r\ncontext\r\nold text\r\nend\r\n",
  );

  const deletionDiff = [
    "--- a/main.tex",
    "+++ b/main.tex",
    "@@ -1,4 +1,3 @@",
    " before",
    "-deleted",
    " after",
    " end",
  ].join("\n");
  const deletionHunk = logic.parsedDiffHunks(logic.parseUnifiedDiff(deletionDiff)[0])[0];
  assert.equal(
    logic.revertParsedDiffHunkInContent("before\nafter\nend\n", deletionHunk),
    "before\ndeleted\nafter\nend\n",
  );
  assert.throws(
    () => logic.revertParsedDiffHunkInContent("before\nchanged\nend\n", deletionHunk),
    /无法在当前文件中定位/,
  );

  assert.deepEqual(
    logic.resolveCodexFileMentionPaths(
      "请润色 @intro 并和 @sections/method.tex 保持一致，忽略 name@example.com",
      ["main.tex", "sections/intro.tex", "sections/method.tex", "appendix/intro.tex"],
    ),
    ["sections/method.tex"],
  );
  assert.deepEqual(
    logic.resolveCodexFileMentionPaths(
      "检查 @intro.tex 和 @refs.bib。",
      ["main.tex", "sections/intro.tex", "refs.bib"],
    ),
    ["sections/intro.tex", "refs.bib"],
  );
  assert.deepEqual(
    logic.codexSymbolMentionTokens("帮我检查 #sec:intro 和 (#smith2026latex)，不要把 C# 当成引用。"),
    ["sec:intro", "smith2026latex"],
  );
  assert.equal(logic.normalizeCodexSymbolMentionToken("`fig:one`,"), "fig:one");

  console.log("editor logic tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
