import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ToolStatus } from "../types";

export function ToolPill({ tool }: { tool: ToolStatus }) {
  return (
    <div className={`tool-pill ${tool.found ? "tool-found" : "tool-missing"}`} title={tool.path ?? tool.installHint}>
      {tool.found ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      <span>{tool.name}</span>
      <small>{tool.found ? "可用" : "缺失"}</small>
    </div>
  );
}
