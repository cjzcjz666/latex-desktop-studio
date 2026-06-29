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

try {
  const logic = await import(pathToFileURL(modulePath).href);

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
