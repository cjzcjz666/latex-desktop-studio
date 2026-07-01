import { useEffect, useState } from "react";
import { AlertTriangle, Bot, ChevronLeft, ChevronRight, Clipboard, LocateFixed, Search } from "lucide-react";
import type { CompileResult, Diagnostic } from "../types";
import {
  diagnosticInstallCommand,
  diagnosticSeverityLabel,
  formatDiagnosticLocation,
  tailLog,
} from "../lib/diagnostics";

type CompileErrorPanelProps = {
  result: CompileResult;
  canRunCodex: boolean;
  onDiagnosticClick: (diagnostic: Diagnostic) => void;
  onCopyDiagnostic: (diagnostic: Diagnostic) => void;
  onCopyDiagnosticCommand: (diagnostic: Diagnostic) => void;
  onCopyCompileLog: () => void;
  onFixDiagnosticWithCodex: (diagnostic: Diagnostic) => void;
  onExplainDiagnosticWithCodex: (diagnostic: Diagnostic) => void;
  onFixWithCodex: () => void;
  onExplainWithCodex: () => void;
};

export function CompileErrorPanel({
  result,
  canRunCodex,
  onDiagnosticClick,
  onCopyDiagnostic,
  onCopyDiagnosticCommand,
  onCopyCompileLog,
  onFixDiagnosticWithCodex,
  onExplainDiagnosticWithCodex,
  onFixWithCodex,
  onExplainWithCodex,
}: CompileErrorPanelProps) {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const visibleDiagnostics = errors.length ? errors : result.diagnostics;
  const [activeDiagnosticIndex, setActiveDiagnosticIndex] = useState(0);
  const activeDiagnostic = visibleDiagnostics[activeDiagnosticIndex] ?? visibleDiagnostics[0];
  const activeInstallCommand = activeDiagnostic ? diagnosticInstallCommand(activeDiagnostic) : "";

  useEffect(() => {
    setActiveDiagnosticIndex(0);
  }, [result]);

  function jumpToDiagnostic(index: number) {
    if (!visibleDiagnostics.length) return;
    const nextIndex = (index + visibleDiagnostics.length) % visibleDiagnostics.length;
    setActiveDiagnosticIndex(nextIndex);
    onDiagnosticClick(visibleDiagnostics[nextIndex]);
  }

  return (
    <div className="compile-error-panel">
      <div className="compile-error-heading">
        <AlertTriangle size={20} />
        <div>
          <strong>编译失败</strong>
          <span>点击错误可跳转到对应源码位置。</span>
        </div>
        <div className="compile-heading-actions">
          <button
            type="button"
            className="compile-codex-explain-button"
            onClick={onExplainWithCodex}
            disabled={!canRunCodex}
            title={canRunCodex ? "让 Codex 解释这次编译失败，不修改文件" : "Codex 当前不可用"}
          >
            <Search size={15} />
            <span>Codex 解释</span>
          </button>
          <button
            type="button"
            className={`compile-codex-fix-button ${errors.length ? "compile-ai-fix-primary" : ""}`}
            onClick={onFixWithCodex}
            disabled={!canRunCodex}
            title={canRunCodex ? "让 Codex 根据错误日志修复项目" : "Codex 当前不可用"}
          >
            <Bot size={15} />
            <span>{errors.length ? "自动 AI 纠错" : "Codex 修复"}</span>
          </button>
        </div>
      </div>
      <div className="compile-diagnostic-nav" aria-label="编译诊断导航">
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex - 1)}
          disabled={!visibleDiagnostics.length}
          title="上一条诊断"
        >
          <ChevronLeft size={14} />
          <span>上一条</span>
        </button>
        <span>
          {visibleDiagnostics.length ? `${activeDiagnosticIndex + 1}/${visibleDiagnostics.length}` : "0"}
        </span>
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex + 1)}
          disabled={!visibleDiagnostics.length}
          title="下一条诊断"
        >
          <span>下一条</span>
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className="compile-diagnostic-fix-button"
          onClick={() => activeDiagnostic && onFixDiagnosticWithCodex(activeDiagnostic)}
          disabled={!canRunCodex || !activeDiagnostic}
          title={canRunCodex ? "让 Codex 只修复当前这条诊断" : "Codex 当前不可用"}
        >
          <Bot size={14} />
          <span>修当前</span>
        </button>
        <button
          type="button"
          className="compile-diagnostic-explain-button"
          onClick={() => activeDiagnostic && onExplainDiagnosticWithCodex(activeDiagnostic)}
          disabled={!canRunCodex || !activeDiagnostic}
          title={canRunCodex ? "让 Codex 解释当前这条诊断，不修改文件" : "Codex 当前不可用"}
        >
          <Search size={14} />
          <span>解释</span>
        </button>
        <button
          type="button"
          onClick={() => jumpToDiagnostic(activeDiagnosticIndex)}
          disabled={!activeDiagnostic?.file}
          title={activeDiagnostic?.file ? "跳转到当前诊断源码位置" : "当前诊断没有源码位置"}
        >
          <LocateFixed size={14} />
          <span>定位</span>
        </button>
      </div>
      {activeDiagnostic && (
        <div className="compile-active-diagnostic">
          <div className="compile-active-diagnostic-top">
            <span className={`compile-active-severity diagnostic-${activeDiagnostic.severity}`}>
              {diagnosticSeverityLabel(activeDiagnostic.severity)}
            </span>
            <strong>{formatDiagnosticLocation(activeDiagnostic) || "全局日志"}</strong>
            <div className="compile-active-actions">
              <button
                type="button"
                onClick={() => onCopyDiagnostic(activeDiagnostic)}
                title="复制当前诊断和修复建议"
              >
                <Clipboard size={14} />
                <span>复制</span>
              </button>
              {activeInstallCommand && (
                <button
                  type="button"
                  className="compile-active-command-button"
                  onClick={() => onCopyDiagnosticCommand(activeDiagnostic)}
                  title={activeInstallCommand}
                >
                  <Clipboard size={14} />
                  <span>复制安装命令</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDiagnosticClick(activeDiagnostic)}
                disabled={!activeDiagnostic.file}
                title={activeDiagnostic.file ? "跳转到源码位置" : "当前诊断没有源码位置"}
              >
                <LocateFixed size={14} />
                <span>定位</span>
              </button>
              <button
                type="button"
                className="compile-active-codex-button"
                onClick={() => onFixDiagnosticWithCodex(activeDiagnostic)}
                disabled={!canRunCodex}
                title={canRunCodex ? "让 Codex 修复当前错误" : "Codex 当前不可用"}
              >
                <Bot size={14} />
                <span>Codex 修当前</span>
              </button>
              <button
                type="button"
                className="compile-active-explain-button"
                onClick={() => onExplainDiagnosticWithCodex(activeDiagnostic)}
                disabled={!canRunCodex}
                title={canRunCodex ? "让 Codex 解释当前错误" : "Codex 当前不可用"}
              >
                <Search size={14} />
                <span>解释</span>
              </button>
            </div>
          </div>
          <p>{activeDiagnostic.message}</p>
          {activeDiagnostic.hint && (
            <div className="compile-active-hint">
              <AlertTriangle size={14} />
              <div>
                <strong>建议处理方式</strong>
                <span>{activeDiagnostic.hint}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="diagnostics-list">
        {visibleDiagnostics.length ? (
          visibleDiagnostics.map((diagnostic, index) => (
            <button
              key={`${diagnostic.file ?? "global"}-${diagnostic.line ?? index}-${index}`}
              type="button"
              className={[
                "diagnostic",
                `diagnostic-${diagnostic.severity}`,
                index === activeDiagnosticIndex ? "diagnostic-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                setActiveDiagnosticIndex(index);
                onDiagnosticClick(diagnostic);
              }}
            >
              <span>{diagnosticSeverityLabel(diagnostic.severity)}</span>
              <span>{formatDiagnosticLocation(diagnostic)}</span>
              <span className="diagnostic-copy">
                <span>{diagnostic.message}</span>
                {diagnostic.hint && <small>{diagnostic.hint}</small>}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-log">没有解析到具体行号，请查看原始日志。</div>
        )}
      </div>
      {warnings.length > 0 && errors.length > 0 && (
        <details className="compile-warning-details">
          <summary>{warnings.length} 条附带警告</summary>
          {warnings.map((diagnostic, index) => (
            <button
              key={`${diagnostic.message}-${index}`}
              type="button"
              className="diagnostic diagnostic-warning"
              onClick={() => onDiagnosticClick(diagnostic)}
            >
              <span>警告</span>
              <span>{formatDiagnosticLocation(diagnostic)}</span>
              <span className="diagnostic-copy">
                <span>{diagnostic.message}</span>
                {diagnostic.hint && <small>{diagnostic.hint}</small>}
              </span>
            </button>
          ))}
        </details>
      )}
      <details className="compile-log-details">
        <summary>
          <span>原始日志</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCopyCompileLog();
            }}
            title="复制原始编译日志"
            aria-label="复制原始编译日志"
          >
            <Clipboard size={14} />
            <span>复制日志</span>
          </button>
        </summary>
        <pre>{tailLog(result.log)}</pre>
      </details>
    </div>
  );
}
