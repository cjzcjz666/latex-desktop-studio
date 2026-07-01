import { AlertTriangle, XCircle } from "lucide-react";

export type SafetyConfirmDialogRequest =
  | {
      kind: "discard-unsaved";
      action: string;
      dirtyCount: number;
    }
  | {
      kind: "close-app";
      blockers: string[];
    };

type SafetyConfirmDialogProps = {
  request: SafetyConfirmDialogRequest | null;
  isConfirming: boolean;
  onCancel: () => void;
  onDiscardAndConfirm: () => void;
  onSaveAndConfirm?: () => void;
};

export function SafetyConfirmDialog({
  request,
  isConfirming,
  onCancel,
  onDiscardAndConfirm,
  onSaveAndConfirm,
}: SafetyConfirmDialogProps) {
  if (!request) return null;

  const isCloseApp = request.kind === "close-app";
  const title = isCloseApp ? "关闭 LaTeX Studio？" : `${request.action}前确认`;
  const discardLabel = isCloseApp ? "仍然关闭" : `丢弃并${request.action}`;
  const saveLabel = isCloseApp ? "保存并关闭" : `保存并${request.action}`;
  const canSaveFirst = Boolean(onSaveAndConfirm);

  return (
    <div
      className="safety-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isConfirming) {
          onCancel();
        }
      }}
    >
      <div className="safety-confirm-dialog">
        <div className="safety-confirm-heading">
          <AlertTriangle size={18} />
          <div>
            <strong>{title}</strong>
            <span>{isCloseApp ? "当前工作区还有未完成事项。" : "当前项目中还有未保存修改。"}</span>
          </div>
        </div>
        {isCloseApp ? (
          <ul className="safety-confirm-list">
            {request.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>
            还有 <strong>{request.dirtyCount}</strong> 个文件未保存。可以先保存再继续，或丢弃这些修改。
          </p>
        )}
        <div className="safety-confirm-actions">
          <button type="button" onClick={onCancel} disabled={isConfirming}>
            <XCircle size={14} />
            <span>取消</span>
          </button>
          <button
            type="button"
            className="safety-confirm-discard"
            onClick={onDiscardAndConfirm}
            disabled={isConfirming}
          >
            <span>{isConfirming ? "正在处理..." : discardLabel}</span>
          </button>
          {canSaveFirst && (
            <button
              type="button"
              className="safety-confirm-primary"
              onClick={onSaveAndConfirm}
              disabled={isConfirming}
            >
              <span>{isConfirming ? "正在保存..." : saveLabel}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
