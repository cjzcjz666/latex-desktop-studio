import { Clipboard, MessageSquareText, Pencil } from "lucide-react";

type CodexAnswerViewProps = {
  answer: string;
  onCopy: () => void;
  onUseAsEditPrompt: () => void;
  onInsertAsReviewComment: () => void;
};

export function CodexAnswerView({
  answer,
  onCopy,
  onUseAsEditPrompt,
  onInsertAsReviewComment,
}: CodexAnswerViewProps) {
  return (
    <div className="codex-answer">
      <div className="codex-answer-header">
        <div className="codex-answer-title">Codex 输出</div>
        <div className="codex-answer-actions">
          <button type="button" onClick={onCopy} title="复制 Codex 回答" aria-label="复制 Codex 回答">
            <Clipboard size={13} />
            <span>复制</span>
          </button>
          <button
            type="button"
            onClick={onUseAsEditPrompt}
            title="把回答转成修改指令"
            aria-label="把回答转成修改指令"
          >
            <Pencil size={13} />
            <span>转为修改</span>
          </button>
          <button
            type="button"
            onClick={onInsertAsReviewComment}
            title="把回答插入为 REVIEW 批注"
            aria-label="把回答插入为 REVIEW 批注"
          >
            <MessageSquareText size={13} />
            <span>转为批注</span>
          </button>
        </div>
      </div>
      <pre>{answer}</pre>
    </div>
  );
}
