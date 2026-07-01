import type { Diagnostic } from "../types";

export function formatDiagnosticLocation(diagnostic: Diagnostic) {
  if (!diagnostic.file) return "";
  return `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`;
}

export function formatDiagnosticText(diagnostic: Diagnostic) {
  return diagnostic.hint ? `${diagnostic.message} Hint: ${diagnostic.hint}` : diagnostic.message;
}

export function diagnosticInstallCommand(diagnostic: Diagnostic) {
  if (!diagnostic.hint) return "";
  const match = diagnostic.hint.match(/`(sudo\s+tlmgr\s+install\s+[^`]+)`/);
  return match?.[1]?.trim() ?? "";
}

export function diagnosticSeverityLabel(severity: Diagnostic["severity"]) {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "信息";
}

export function tailLog(log: string) {
  return log.split("\n").slice(-80).join("\n").trim() || "没有日志输出。";
}
