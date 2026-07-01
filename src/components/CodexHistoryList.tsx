import { Pencil } from "lucide-react";
import type { CodexHistoryItem } from "../types";

type CodexHistoryListProps = {
  items: CodexHistoryItem[];
  onOpen: (item: CodexHistoryItem) => void;
  onReusePrompt: (item: CodexHistoryItem) => void;
};

export function CodexHistoryList({ items, onOpen, onReusePrompt }: CodexHistoryListProps) {
  return (
    <div className="codex-history">
      <div className="codex-history-title">历史修改</div>
      {items.slice(0, 4).map((item) => (
        <div className="codex-history-item" key={item.runId}>
          <button
            type="button"
            className="codex-history-main"
            onClick={() => onOpen(item)}
            title={item.promptPreview ? `${item.promptPreview}\n${item.runId}` : `打开 ${item.runId}`}
          >
            <span>{formatCodexHistoryTime(item.createdAt)}</span>
            <strong>{item.changedFiles.length} 个文件</strong>
            <small className="codex-history-prompt">{item.promptPreview || "未记录指令"}</small>
            {item.finalMessage && <small className="codex-history-message">{item.finalMessage}</small>}
            <small className="codex-history-files">
              {item.changedFiles.slice(0, 2).join(", ") || item.runId}
            </small>
          </button>
          <button
            type="button"
            className="codex-history-reuse"
            onClick={() => onReusePrompt(item)}
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
  );
}

function formatCodexHistoryTime(createdAt: number) {
  if (!createdAt) return "未知时间";
  return new Date(createdAt * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    minute: "2-digit",
    hour: "2-digit",
  });
}
