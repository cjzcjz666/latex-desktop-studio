import { Code2, FileText, LocateFixed, Tags, XCircle } from "lucide-react";
import {
  codexContextKindLabel,
  formatCodexContextHint,
} from "../lib/codexContext";
import type { CodexEditorContext, ProjectSymbol } from "../types";

export type CodexPreflightItem = {
  key: string;
  label: string;
  detail: string;
  tone?: "scope" | "safe" | "warn";
};

type CodexContextStripProps = {
  pinnedContext: CodexEditorContext | null;
  referencedFiles: string[];
  referencedSymbols: ProjectSymbol[];
  showDiffContext: boolean;
  diffFileCount: number;
  showContextScope: boolean;
  scopeFileCount: number;
  preflightItems: CodexPreflightItem[];
  showPreflight: boolean;
  onOpenPinnedContext: (context: CodexEditorContext) => void;
  onClearPinnedContext: () => void;
  onOpenFile: (path: string) => void;
  onOpenSymbol: (symbol: ProjectSymbol) => void;
  onRemoveMention: (trigger: "@" | "#", value: string) => void;
};

export function CodexContextStrip({
  pinnedContext,
  referencedFiles,
  referencedSymbols,
  showDiffContext,
  diffFileCount,
  showContextScope,
  scopeFileCount,
  preflightItems,
  showPreflight,
  onOpenPinnedContext,
  onClearPinnedContext,
  onOpenFile,
  onOpenSymbol,
  onRemoveMention,
}: CodexContextStripProps) {
  const hasVisibleContext = Boolean(
    pinnedContext ||
      referencedFiles.length ||
      referencedSymbols.length ||
      showDiffContext ||
      showContextScope,
  );

  return (
    <>
      {hasVisibleContext && (
        <div className="codex-context-strip" aria-label="Codex 已选上下文">
          <span className="codex-context-strip-label">上下文</span>
          {pinnedContext && (
            <span className="codex-context-chip codex-context-chip-pinned">
              <button
                type="button"
                className="codex-context-chip-main"
                onClick={() => onOpenPinnedContext(pinnedContext)}
                title={formatCodexContextHint(pinnedContext)}
              >
                <LocateFixed size={12} />
                <span>{codexContextKindLabel(pinnedContext)}</span>
                <small>
                  {shortFileName(pinnedContext.file)}:{pinnedContext.cursorLine}
                </small>
              </button>
              <button
                type="button"
                className="codex-context-chip-remove"
                onClick={onClearPinnedContext}
                title="清除锁定上下文"
                aria-label="清除锁定上下文"
              >
                <XCircle size={12} />
              </button>
            </span>
          )}
          {referencedFiles.map((path) => (
            <span className="codex-context-chip codex-context-chip-file" key={`file:${path}`}>
              <button
                type="button"
                className="codex-context-chip-main"
                onClick={() => onOpenFile(path)}
                title={`@${path}`}
              >
                <FileText size={12} />
                <span>@{shortFileName(path)}</span>
              </button>
              <button
                type="button"
                className="codex-context-chip-remove"
                onClick={() => onRemoveMention("@", path)}
                title={`移除 @${path}`}
                aria-label={`移除 @${path}`}
              >
                <XCircle size={12} />
              </button>
            </span>
          ))}
          {referencedSymbols.map((symbol) => (
            <span
              className={`codex-context-chip codex-context-chip-${symbol.kind}`}
              key={`${symbol.kind}:${symbol.key}`}
            >
              <button
                type="button"
                className="codex-context-chip-main"
                onClick={() => onOpenSymbol(symbol)}
                title={`#${symbol.key} · ${symbol.file}:${symbol.line}`}
              >
                <Tags size={12} />
                <span>#{symbol.key}</span>
              </button>
              <button
                type="button"
                className="codex-context-chip-remove"
                onClick={() => onRemoveMention("#", symbol.key)}
                title={`移除 #${symbol.key}`}
                aria-label={`移除 #${symbol.key}`}
              >
                <XCircle size={12} />
              </button>
            </span>
          ))}
          {showDiffContext && (
            <span className="codex-context-chip codex-context-chip-diff">
              <span className="codex-context-chip-static">
                <Code2 size={12} />
                <span>当前 diff</span>
                <small>{diffFileCount} 文件</small>
              </span>
            </span>
          )}
          {showContextScope && (
            <span className="codex-context-chip codex-context-chip-scope">
              <span className="codex-context-chip-static">
                <LocateFixed size={12} />
                <span>仅改上下文</span>
                <small>{scopeFileCount} 文件</small>
              </span>
            </span>
          )}
        </div>
      )}
      {showPreflight && (
        <div className="codex-preflight-strip" aria-label="Codex 运行前预检">
          <span className="codex-preflight-label">预检</span>
          {preflightItems.map((item) => (
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
    </>
  );
}

function shortFileName(path: string) {
  return path.split("/").pop() || path;
}
