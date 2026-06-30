import { CheckCircle2, Clipboard, LocateFixed, Pencil, Undo2 } from "lucide-react";
import {
  codexDiffHunkKey,
  formatParsedDiffFile,
  formatParsedDiffHunk,
  parsedDiffHunks,
  parseUnifiedDiff,
  type ParsedDiffFile,
  type ParsedDiffHunk,
  type ParsedDiffLine,
} from "../lib/editorLogic";
import type { DiffSummary } from "../types";

type CodexDiffViewProps = {
  summary: DiffSummary;
  onOpenTarget: (file: string, line?: number) => void;
  onCopyDiff?: (text: string, label: string) => void;
  onRevertFile?: (file: string) => void;
  onRevertHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
  onAcceptHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
  onReviseHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
  onClearAcceptedHunks?: () => void;
  acceptedHunkKeys?: string[];
  summaryHint?: string;
  emptyText?: string;
};

export function CodexDiffView({
  summary,
  onOpenTarget,
  onCopyDiff,
  onRevertFile,
  onRevertHunk,
  onAcceptHunk,
  onReviseHunk,
  onClearAcceptedHunks,
  acceptedHunkKeys = [],
  summaryHint = "可用上方撤回按钮恢复本次修改。",
  emptyText = "没有文件变化。",
}: CodexDiffViewProps) {
  const files = parseUnifiedDiff(summary.unifiedDiff);
  const fullDiffText = summary.unifiedDiff || summary.changedFiles.join("\n");
  const scopeRevertedFiles = summary.scopeRevertedFiles ?? [];
  const acceptedHunkKeySet = new Set(acceptedHunkKeys);
  const diffFiles = files
    .map((file) => {
      const hunks = parsedDiffHunks(file).map((hunk, index) => ({
        hunk,
        index,
        key: codexDiffHunkKey(file.file, hunk),
      }));
      return {
        file,
        acceptedCount: hunks.filter((item) => acceptedHunkKeySet.has(item.key)).length,
        hunks: hunks.filter((item) => !acceptedHunkKeySet.has(item.key)),
      };
    })
    .filter((file) => file.hunks.length > 0);
  const firstTarget = firstNavigableDiffHunkTarget(diffFiles);
  const acceptedHunkCount = files.reduce(
    (count, file) =>
      count + parsedDiffHunks(file).filter((hunk) => acceptedHunkKeySet.has(codexDiffHunkKey(file.file, hunk))).length,
    0,
  );
  const visibleHunkCount = diffFiles.reduce((count, file) => count + file.hunks.length, 0);
  if (!summary.changedFiles.length) {
    if (!scopeRevertedFiles.length) {
      return <div className="empty-log">{emptyText}</div>;
    }
    return (
      <div className="codex-diff-view codex-diff-view-empty">
        <CodexScopeGuardNotice files={scopeRevertedFiles} />
        <div className="empty-log">没有保留的文件变化。</div>
      </div>
    );
  }
  if (!files.length) {
    return (
      <div className="codex-diff-view">
        <div className="codex-diff-summary">
          <div className="codex-diff-summary-main">
            <div>
              <strong>{summary.changedFiles.length} 个文件发生变化</strong>
              {summary.promptPreview && <span className="codex-diff-prompt">指令：{summary.promptPreview}</span>}
              {summary.finalMessage && <span className="codex-diff-message">Codex 说明：{summary.finalMessage}</span>}
              <span>这些文件可能是二进制或非 UTF-8 内容。</span>
            </div>
            {onCopyDiff && (
              <button
                type="button"
                className="codex-diff-copy"
                onClick={() => onCopyDiff(fullDiffText, "本次 diff")}
                title="复制本次 diff"
                aria-label="复制本次 diff"
              >
                <Clipboard size={13} />
                <span>复制 diff</span>
              </button>
            )}
          </div>
        </div>
        <CodexScopeGuardNotice files={scopeRevertedFiles} />
        <pre>{summary.unifiedDiff || summary.changedFiles.join("\n")}</pre>
      </div>
    );
  }
  return (
    <div className="codex-diff-view">
      <div className="codex-diff-summary">
        <div className="codex-diff-summary-main">
          <div>
            <strong>{summary.changedFiles.length} 个文件发生变化</strong>
            {summary.promptPreview && <span className="codex-diff-prompt">指令：{summary.promptPreview}</span>}
            {summary.finalMessage && <span className="codex-diff-message">Codex 说明：{summary.finalMessage}</span>}
            <span>{summaryHint}</span>
            {acceptedHunkCount > 0 && (
              <span className="codex-diff-reviewed-note">
                已保留 {acceptedHunkCount} 个片段，剩余 {visibleHunkCount} 个待审。
              </span>
            )}
          </div>
          <div className="codex-diff-summary-actions">
            {acceptedHunkCount > 0 && onClearAcceptedHunks && (
              <button
                type="button"
                className="codex-diff-copy codex-diff-show-reviewed"
                onClick={onClearAcceptedHunks}
                title="重新显示已保留的片段"
                aria-label="重新显示已保留的片段"
              >
                <span>显示全部</span>
              </button>
            )}
            {firstTarget && (
              <button
                type="button"
                className="codex-diff-copy codex-diff-open-first"
                onClick={() => onOpenTarget(firstTarget.file, firstTarget.line)}
                title="在编辑器中打开第一处 Codex 修改"
                aria-label="打开第一处 Codex 修改"
              >
                <LocateFixed size={13} />
                <span>定位首处</span>
              </button>
            )}
            {onCopyDiff && (
              <button
                type="button"
                className="codex-diff-copy"
                onClick={() => onCopyDiff(fullDiffText, "本次 diff")}
                title="复制本次 diff"
                aria-label="复制本次 diff"
              >
                <Clipboard size={13} />
                <span>复制 diff</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <CodexScopeGuardNotice files={scopeRevertedFiles} />
      {!visibleHunkCount && acceptedHunkCount > 0 && (
        <div className="codex-diff-all-reviewed">
          所有片段都已保留。点击“确认修改”即可收起本次 Codex diff。
        </div>
      )}
      {diffFiles.map(({ file, hunks }) => (
        <section className="codex-diff-file" key={file.file}>
          <div className="codex-diff-file-header">
            <button
              type="button"
              className="codex-diff-file-title"
              onClick={() => onOpenTarget(file.file)}
              title={`打开 ${file.file}`}
            >
              {file.file}
            </button>
            <div className="codex-diff-file-actions">
              {onCopyDiff && (
                <button
                  type="button"
                  className="codex-diff-copy codex-diff-file-copy"
                  onClick={() => onCopyDiff(formatParsedDiffFile(file), `${file.file} diff`)}
                  title={`复制 ${file.file} 的 diff`}
                  aria-label={`复制 ${file.file} 的 diff`}
                >
                  <Clipboard size={13} />
                  <span>复制</span>
                </button>
              )}
              {summary.canRevert && onRevertFile && (
                <button
                  type="button"
                  className="codex-diff-file-revert"
                  onClick={() => onRevertFile(file.file)}
                  title={`仅撤回 ${file.file} 的 Codex 修改`}
                  aria-label={`仅撤回 ${file.file} 的 Codex 修改`}
                >
                  <Undo2 size={13} />
                  <span>撤回此文件</span>
                </button>
              )}
            </div>
          </div>
          <div className="codex-diff-hunks">
            {hunks.map(({ hunk, index, key }) => (
              <CodexDiffHunkView
                key={key}
                file={file}
                hunk={hunk}
                hunkIndex={index}
                onOpenTarget={onOpenTarget}
                onCopyDiff={onCopyDiff}
                onRevertHunk={summary.canRevert ? onRevertHunk : undefined}
                onAcceptHunk={onAcceptHunk}
                onReviseHunk={onReviseHunk}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CodexDiffHunkView({
  file,
  hunk,
  hunkIndex,
  onOpenTarget,
  onCopyDiff,
  onRevertHunk,
  onAcceptHunk,
  onReviseHunk,
}: {
  file: ParsedDiffFile;
  hunk: ParsedDiffHunk;
  hunkIndex: number;
  onOpenTarget: (file: string, line?: number) => void;
  onCopyDiff?: (text: string, label: string) => void;
  onRevertHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
  onAcceptHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
  onReviseHunk?: (file: string, hunk: ParsedDiffHunk, hunkIndex: number) => void;
}) {
  const firstTargetLine = firstNavigableHunkLine(hunk);
  return (
    <div className="codex-diff-hunk">
      <div className="codex-diff-hunk-header">
        <button
          type="button"
          className="codex-diff-hunk-title"
          onClick={() => onOpenTarget(file.file, firstTargetLine)}
          disabled={!firstTargetLine}
          title={firstTargetLine ? `跳转到 ${file.file}:${firstTargetLine}` : file.file}
        >
          <span>片段 {hunkIndex + 1}</span>
          <small>{hunk.header}</small>
        </button>
        <div className="codex-diff-hunk-stats" aria-label="片段增删统计">
          {hunk.added > 0 && <span className="codex-diff-hunk-add">+{hunk.added}</span>}
          {hunk.removed > 0 && <span className="codex-diff-hunk-remove">-{hunk.removed}</span>}
        </div>
        <div className="codex-diff-hunk-actions">
          {firstTargetLine && (
            <button
              type="button"
              className="codex-diff-hunk-action"
              onClick={() => onOpenTarget(file.file, firstTargetLine)}
              title="定位这个修改片段"
              aria-label="定位这个修改片段"
            >
              <LocateFixed size={12} />
              <span>定位</span>
            </button>
          )}
          {onCopyDiff && (
            <button
              type="button"
              className="codex-diff-hunk-action"
              onClick={() => onCopyDiff(formatParsedDiffHunk(file, hunk), `${file.file} 片段 ${hunkIndex + 1} diff`)}
              title="复制这个修改片段"
              aria-label="复制这个修改片段"
            >
              <Clipboard size={12} />
              <span>复制片段</span>
            </button>
          )}
          {onReviseHunk && (
            <button
              type="button"
              className="codex-diff-hunk-action codex-diff-hunk-revise"
              onClick={() => onReviseHunk(file.file, hunk, hunkIndex)}
              title="把这个片段交给 Codex 继续修改"
              aria-label="继续修改这个片段"
            >
              <Pencil size={12} />
              <span>继续修改</span>
            </button>
          )}
          {onRevertHunk && (
            <button
              type="button"
              className="codex-diff-hunk-action codex-diff-hunk-revert"
              onClick={() => onRevertHunk(file.file, hunk, hunkIndex)}
              title="仅撤回这个修改片段"
              aria-label="仅撤回这个修改片段"
            >
              <Undo2 size={12} />
              <span>撤回片段</span>
            </button>
          )}
          {onAcceptHunk && (
            <button
              type="button"
              className="codex-diff-hunk-action codex-diff-hunk-accept"
              onClick={() => onAcceptHunk(file.file, hunk, hunkIndex)}
              title="保留这个修改片段并从待审列表隐藏"
              aria-label="保留这个修改片段"
            >
              <CheckCircle2 size={12} />
              <span>保留片段</span>
            </button>
          )}
        </div>
      </div>
      <div className="codex-diff-lines">
        {hunk.lines.map((line, index) => {
          const targetLine = diffTargetLine(line);
          return (
            <button
              type="button"
              className={`codex-diff-line codex-diff-${line.kind}`}
              key={`${file.file}-${hunkIndex}-${index}`}
              onClick={() => onOpenTarget(file.file, targetLine)}
              disabled={!targetLine}
              title={targetLine ? `跳转到 ${file.file}:${targetLine}` : `打开 ${file.file}`}
            >
              <span className="codex-diff-number codex-diff-old-line">{formatDiffLineNumber(line.oldLine)}</span>
              <span className="codex-diff-number codex-diff-new-line">{formatDiffLineNumber(line.newLine)}</span>
              <span className="codex-diff-prefix">{diffPrefix(line.kind)}</span>
              <code>{line.content || " "}</code>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CodexScopeGuardNotice({ files }: { files: string[] }) {
  if (!files.length) return null;
  const visibleFiles = files.slice(0, 6);
  const hiddenCount = files.length - visibleFiles.length;
  return (
    <div className="codex-scope-guard-notice" role="status" aria-label="Codex 范围护栏">
      <div className="codex-scope-guard-main">
        <strong>范围护栏已生效</strong>
        <span>已从运行前快照恢复 {files.length} 个上下文外文件，自动编译只基于保留的修改。</span>
      </div>
      <div className="codex-scope-guard-files" title={files.join("、")}>
        {visibleFiles.map((file) => (
          <code key={file}>{file}</code>
        ))}
        {hiddenCount > 0 && <span>另有 {hiddenCount} 个文件</span>}
      </div>
    </div>
  );
}

function firstNavigableDiffHunkTarget(
  files: Array<{ file: ParsedDiffFile; hunks: Array<{ hunk: ParsedDiffHunk }> }>,
) {
  for (const file of files) {
    for (const { hunk } of file.hunks) {
      const targetLine = firstNavigableHunkLine(hunk);
      if (targetLine) return { file: file.file.file, line: targetLine };
    }
  }
  return null;
}

function firstNavigableHunkLine(hunk: ParsedDiffHunk) {
  for (const line of hunk.lines) {
    const targetLine = diffTargetLine(line);
    if (targetLine) return targetLine;
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
