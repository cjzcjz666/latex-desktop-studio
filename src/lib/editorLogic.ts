import type { ProjectTodo } from "../types";

export type ParsedDiffLine = {
  kind: "meta" | "add" | "remove" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
};

export type ParsedDiffFile = {
  file: string;
  lines: ParsedDiffLine[];
};

export function normalizeShortcutInput(value: string) {
  const tokens = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/\+/g, "")
    .replace(/command|cmd|meta/gi, "⌘")
    .replace(/control|ctrl/gi, "⌃")
    .replace(/option|alt/gi, "⌥")
    .replace(/shift/gi, "⇧")
    .replace(/enter|return/gi, "↵")
    .replace(/escape|esc/gi, "Esc");
  if (!tokens) return "";
  const hasMeta = tokens.includes("⌘");
  const hasCtrl = tokens.includes("⌃");
  const hasAlt = tokens.includes("⌥");
  const hasShift = tokens.includes("⇧");
  const key = tokens
    .replace(/[⌘⌃⌥⇧]/g, "")
    .replace(/^key/i, "")
    .toUpperCase();
  if (!key) return "";
  return `${hasMeta ? "⌘" : ""}${hasCtrl ? "⌃" : ""}${hasAlt ? "⌥" : ""}${hasShift ? "⇧" : ""}${
    key === "↵" ? "↵" : key
  }`;
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  const key = keyLabelFromEvent(event);
  if (!key) return "";
  return `${event.metaKey ? "⌘" : ""}${event.ctrlKey ? "⌃" : ""}${event.altKey ? "⌥" : ""}${event.shiftKey ? "⇧" : ""}${key}`;
}

export function keyLabelFromEvent(event: Pick<KeyboardEvent, "key">) {
  if (event.key === "Meta" || event.key === "Control" || event.key === "Alt" || event.key === "Shift") {
    return "";
  }
  if (event.key === "Enter") return "↵";
  if (event.key === "Escape") return "Esc";
  if (event.key === " ") return "Space";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key.replace(/^Arrow/, "");
}

export function eventMatchesShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: string,
) {
  const normalized = normalizeShortcutInput(shortcut);
  if (!normalized) return false;
  const expected = parseShortcut(normalized);
  if (!expected.key) return false;
  return (
    event.metaKey === expected.meta &&
    event.ctrlKey === expected.ctrl &&
    event.altKey === expected.alt &&
    event.shiftKey === expected.shift &&
    eventKeyMatches(event, expected.key)
  );
}

export function parseShortcut(shortcut: string) {
  const normalized = normalizeShortcutInput(shortcut);
  return {
    meta: normalized.includes("⌘"),
    ctrl: normalized.includes("⌃"),
    alt: normalized.includes("⌥"),
    shift: normalized.includes("⇧"),
    key: normalized.replace(/[⌘⌃⌥⇧]/g, ""),
  };
}

export function eventKeyMatches(event: Pick<KeyboardEvent, "key">, key: string) {
  if (key === "↵") return event.key === "Enter";
  if (key === "ESC") return event.key === "Escape";
  if (key === "SPACE") return event.key === " ";
  return event.key.toUpperCase() === key.toUpperCase();
}

export function latexCommentStartIndex(line: string) {
  let slashCount = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\") {
      slashCount += 1;
      continue;
    }
    if (character === "%" && slashCount % 2 === 0) {
      return index;
    }
    slashCount = 0;
  }
  return -1;
}

export function stripLatexLineComment(line: string) {
  const commentStart = latexCommentStartIndex(line);
  return commentStart < 0 ? line : line.slice(0, commentStart);
}

export function isTodoCommentText(comment: string) {
  return Boolean(parseLatexTodoCommentText(comment));
}

export function parseLatexTodoCommentText(comment: string): {
  kind: ProjectTodo["kind"];
  message: string;
  resolved: boolean;
} | null {
  let trimmed = comment.trim();
  if (!trimmed) return null;
  let resolved = false;
  while (trimmed) {
    const lower = trimmed.toLowerCase();
    let next = "";
    if (lower.startsWith("resolved")) {
      next = trimmed.slice("resolved".length);
    } else if (trimmed.startsWith("已解决")) {
      next = trimmed.slice("已解决".length);
    } else if (trimmed.startsWith("完成")) {
      next = trimmed.slice("完成".length);
    } else {
      break;
    }
    const normalizedNext = next.replace(/^[:：\-—\s]+/, "").trim();
    if (!normalizedNext || normalizedNext === trimmed) break;
    trimmed = normalizedNext;
    resolved = true;
  }

  if (isReviewEndCommentText(trimmed)) return null;

  const markers: Array<[string, ProjectTodo["kind"]]> = [
    ["todo", "TODO"],
    ["fixme", "FIXME"],
    ["review", "REVIEW"],
    ["note", "NOTE"],
    ["待办", "TODO"],
    ["修复", "FIXME"],
    ["注意", "NOTE"],
    ["批注", "NOTE"],
  ];
  const lower = trimmed.toLowerCase();
  for (const [marker, kind] of markers) {
    const matches = /^[a-z]+$/.test(marker) ? lower.startsWith(marker) : trimmed.startsWith(marker);
    if (!matches) continue;
    const rest = trimmed
      .slice(marker.length)
      .replace(/^[:：\-—\s]+/, "")
      .trim();
    return {
      kind,
      message: rest || trimmed,
      resolved,
    };
  }
  return null;
}

export function isReviewEndCommentText(comment: string) {
  const normalized = comment.trim().toLowerCase();
  return normalized === "review-end" || normalized === "end-review" || normalized.startsWith("review-end ");
}

export function isReviewEndCommentLine(line: string) {
  const commentStart = latexCommentStartIndex(line);
  return commentStart >= 0 && isReviewEndCommentText(line.slice(commentStart + 1));
}

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;
  let nextOldLine = 0;
  let nextNewLine = 0;
  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("--- ")) {
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      const file = rawLine.replace(/^\+\+\+\s+/, "").replace(/^b\//, "");
      current = { file, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("@@")) {
      nextOldLine = parseHunkStart(rawLine, "-");
      nextNewLine = parseNewHunkStart(rawLine);
      current.lines.push({ kind: "meta", content: rawLine });
    } else if (rawLine.startsWith("+")) {
      current.lines.push({ kind: "add", content: rawLine.slice(1), newLine: nextNewLine || undefined });
      if (nextNewLine) nextNewLine += 1;
    } else if (rawLine.startsWith("-")) {
      current.lines.push({
        kind: "remove",
        content: rawLine.slice(1),
        oldLine: nextOldLine || undefined,
        newLine: nextNewLine || undefined,
      });
      if (nextOldLine) nextOldLine += 1;
    } else {
      current.lines.push({
        kind: "context",
        content: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
        oldLine: nextOldLine || undefined,
        newLine: nextNewLine || undefined,
      });
      if (nextOldLine) nextOldLine += 1;
      if (nextNewLine) nextNewLine += 1;
    }
  }
  return files.filter((file) => file.lines.length > 0);
}

export function formatParsedDiffFile(file: ParsedDiffFile) {
  return [
    `--- a/${file.file}`,
    `+++ b/${file.file}`,
    ...file.lines.map(formatParsedDiffLineForCopy),
  ].join("\n");
}

export function formatParsedDiffLineForCopy(line: ParsedDiffLine) {
  if (line.kind === "add") return `+${line.content}`;
  if (line.kind === "remove") return `-${line.content}`;
  if (line.kind === "context") return ` ${line.content}`;
  return line.content;
}

export function resolveCodexFileMentionPaths(prompt: string, projectFiles: string[], maxFiles = 6) {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const textFiles = projectFiles.filter(Boolean);
  for (const token of codexFileMentionTokens(prompt)) {
    const path = resolveCodexFileMentionPath(token, textFiles);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    resolved.push(path);
    if (resolved.length >= maxFiles) break;
  }
  return resolved;
}

export function codexFileMentionTokens(prompt: string) {
  const tokens: string[] = [];
  const mentionPattern = /(^|[\s([{:，、])@([^\s,;，。；：!?！？)）\]}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(prompt))) {
    const token = normalizeCodexFileMentionToken(match[2]);
    if (token) tokens.push(token);
  }
  return tokens;
}

export function codexSymbolMentionTokens(prompt: string) {
  const tokens: string[] = [];
  const mentionPattern = /(^|[\s([{:，、])#([^\s,;，。；：!?！？)）\]}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(prompt))) {
    const token = normalizeCodexSymbolMentionToken(match[2]);
    if (token) tokens.push(token);
  }
  return tokens;
}

export function normalizeCodexFileMentionToken(token: string) {
  return token
    .trim()
    .replace(/^["'`<({\[]+/, "")
    .replace(/["'`>)}\].,;:!?，。；：！？、]+$/, "")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

export function normalizeCodexSymbolMentionToken(token: string) {
  return token
    .trim()
    .replace(/^["'`<({\[]+/, "")
    .replace(/["'`>)}\].,;!?，。；！？、]+$/, "");
}

function resolveCodexFileMentionPath(token: string, projectFiles: string[]) {
  const normalizedToken = normalizeCodexFileMentionToken(token);
  if (!normalizedToken || normalizedToken.includes("..") || normalizedToken.includes("\\")) return null;
  const lowerToken = normalizedToken.toLowerCase();
  const hasDirectory = lowerToken.includes("/");
  const hasExtension = /\.[^/.]+$/.test(lowerToken);

  const matches = projectFiles.filter((file) => {
    const lowerFile = file.toLowerCase();
    const lowerShort = lowerFile.split("/").pop() ?? lowerFile;
    const lowerFileNoExtension = lowerFile.replace(/\.[^/.]+$/, "");
    const lowerShortNoExtension = lowerShort.replace(/\.[^/.]+$/, "");
    const tokenWithTex = hasExtension ? lowerToken : `${lowerToken}.tex`;

    if (lowerFile === lowerToken || lowerFile === tokenWithTex) return true;
    if (lowerFileNoExtension === lowerToken) return true;
    if (hasDirectory) {
      return lowerFile.endsWith(`/${lowerToken}`) || lowerFile.endsWith(`/${tokenWithTex}`);
    }
    return lowerShort === lowerToken || lowerShort === tokenWithTex || lowerShortNoExtension === lowerToken;
  });

  const uniqueMatches = Array.from(new Set(matches));
  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

export function parseNewHunkStart(line: string) {
  return parseHunkStart(line, "+");
}

export function parseHunkStart(line: string, sign: "+" | "-") {
  const escapedSign = sign === "+" ? "\\+" : "-";
  const match = line.match(new RegExp(`${escapedSign}(\\d+)(?:,\\d+)?`));
  return match ? Number.parseInt(match[1], 10) : 0;
}
