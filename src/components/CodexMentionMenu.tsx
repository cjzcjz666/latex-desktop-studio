export type CodexMentionSuggestion = {
  kind: "file" | "label" | "citation";
  value: string;
  title: string;
  detail: string;
};

type CodexMentionMenuProps = {
  trigger?: "@" | "#";
  suggestions: CodexMentionSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: CodexMentionSuggestion) => void;
};

export function CodexMentionMenu({
  trigger,
  suggestions,
  activeIndex,
  onSelect,
}: CodexMentionMenuProps) {
  if (!suggestions.length) return null;

  return (
    <div className="codex-mention-menu" role="listbox" aria-label="Codex 上下文引用建议">
      <div className="codex-mention-menu-title">{trigger === "@" ? "项目文件" : "标签 / 引用"}</div>
      {suggestions.map((suggestion, index) => (
        <button
          type="button"
          key={`${suggestion.kind}:${suggestion.value}`}
          className={[
            "codex-mention-item",
            index === activeIndex ? "codex-mention-item-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion);
          }}
          role="option"
          aria-selected={index === activeIndex}
        >
          <span className={`codex-mention-kind codex-mention-kind-${suggestion.kind}`}>
            {codexMentionKindLabel(suggestion.kind)}
          </span>
          <span className="codex-mention-copy">
            <strong>{suggestion.title}</strong>
            <small>{suggestion.detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function codexMentionKindLabel(kind: CodexMentionSuggestion["kind"]) {
  if (kind === "file") return "@";
  return kind === "citation" ? "cite" : "label";
}
