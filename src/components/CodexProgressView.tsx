import { AlertTriangle, Bot, FileText, RefreshCcw, XCircle } from "lucide-react";
import type { CodexRunEvent } from "../types";

type CodexRunMode = "edit" | "ask";

type CodexProgressViewProps = {
  events: CodexRunEvent[];
  prompt?: string;
  changedFiles?: string[];
  isRunning: boolean;
  isCancelling: boolean;
  mode: CodexRunMode;
  onCancel?: () => void;
  onRetry?: () => void;
};

export function CodexProgressView({
  events,
  prompt,
  changedFiles = [],
  isRunning,
  isCancelling,
  mode,
  onCancel,
  onRetry,
}: CodexProgressViewProps) {
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
