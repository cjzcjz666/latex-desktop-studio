import { normalizeShortcutInput } from "./editorLogic";

export type ViewMode = "editor" | "split" | "preview";

export type ShortcutActionId =
  | "save"
  | "compile"
  | "codex"
  | "codexContext"
  | "togglePreview"
  | "quickOpen"
  | "projectSearch"
  | "findInFile"
  | "replaceInFile"
  | "goToLine"
  | "toggleComment"
  | "reviewMode"
  | "insertReviewComment"
  | "syncPdf"
  | "exportPdf"
  | "cleanBuild";

export type ShortcutMap = Record<ShortcutActionId, string>;

const SHORTCUT_PREF_KEY = "latex-studio:shortcuts";

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  save: "⌘S",
  compile: "⌘↵",
  codex: "⌘K",
  codexContext: "⌘⇧K",
  togglePreview: "⌘P",
  quickOpen: "⌘O",
  projectSearch: "⌘⇧F",
  findInFile: "⌘F",
  replaceInFile: "⌘⌥F",
  goToLine: "⌘G",
  toggleComment: "⌘/",
  reviewMode: "⌘⇧M",
  insertReviewComment: "⌘⇧A",
  syncPdf: "⌘⌥P",
  exportPdf: "⌘⇧E",
  cleanBuild: "⌘⇧↵",
};

export const SHORTCUT_DEFINITIONS: Array<{
  id: ShortcutActionId;
  label: string;
  hint: string;
}> = [
  { id: "compile", label: "编译", hint: "保存脏文件并编译当前项目" },
  { id: "codex", label: "AI 修改", hint: "聚焦底部 Codex 命令条" },
  { id: "codexContext", label: "锁定上下文", hint: "把当前选区或光标附近内容交给 Codex" },
  { id: "togglePreview", label: "切换预览", hint: "在分屏和纯预览之间切换" },
  { id: "save", label: "保存", hint: "保存当前打开的修改" },
  { id: "quickOpen", label: "快速打开", hint: "按文件名跳转" },
  { id: "projectSearch", label: "项目搜索", hint: "搜索整个 LaTeX 项目" },
  { id: "findInFile", label: "当前文件查找", hint: "打开 Monaco 查找" },
  { id: "replaceInFile", label: "当前文件替换", hint: "打开 Monaco 替换" },
  { id: "goToLine", label: "跳转行号", hint: "跳到当前文件行号" },
  { id: "toggleComment", label: "行注释", hint: "注释或取消注释选中行" },
  { id: "reviewMode", label: "Review 批注", hint: "进入/退出批注模式，并高亮 REVIEW 内容" },
  { id: "insertReviewComment", label: "添加批注", hint: "在 Review 模式下为当前行或选中内容添加批注" },
  { id: "syncPdf", label: "定位 PDF", hint: "从当前源码光标跳到 PDF 对应位置" },
  { id: "exportPdf", label: "导出 PDF", hint: "导出最近一次编译的 PDF" },
  { id: "cleanBuild", label: "清理编译", hint: "清理构建缓存" },
];

export function loadBooleanPreference(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

export function saveBooleanPreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

export function loadNumberPreference(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
    if (Number.isFinite(value)) {
      return Math.min(max, Math.max(min, value));
    }
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

export function saveNumberPreference(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

export function loadViewModePreference(key: string, fallback: ViewMode) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "editor" || value === "split" || value === "preview") {
      return value;
    }
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
  return fallback;
}

export function saveViewModePreference(key: string, value: ViewMode) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

export function loadShortcutPreferences(): ShortcutMap {
  try {
    const value = window.localStorage.getItem(SHORTCUT_PREF_KEY);
    if (value) {
      const parsed = JSON.parse(value) as Partial<ShortcutMap>;
      return normalizeShortcutMap({ ...DEFAULT_SHORTCUTS, ...parsed });
    }
  } catch {
    // Shortcut customization is optional; defaults keep the editor usable.
  }
  return DEFAULT_SHORTCUTS;
}

export function saveShortcutPreferences(value: ShortcutMap) {
  try {
    window.localStorage.setItem(SHORTCUT_PREF_KEY, JSON.stringify(normalizeShortcutMap(value)));
  } catch {
    // Preference persistence is helpful but not required for editing.
  }
}

export function normalizeShortcutMap(value: Partial<ShortcutMap>): ShortcutMap {
  return SHORTCUT_DEFINITIONS.reduce((accumulator, definition) => {
    accumulator[definition.id] =
      normalizeShortcutInput(value[definition.id] ?? DEFAULT_SHORTCUTS[definition.id]) ||
      DEFAULT_SHORTCUTS[definition.id];
    return accumulator;
  }, {} as ShortcutMap);
}
