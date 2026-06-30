import type { OnMount } from "@monaco-editor/react";

export type MonacoApi = Parameters<OnMount>[1];

export const MONACO_LATEX_THEME = "latex-studio-light";

let isMonacoLatexConfigured = false;

export function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "bib") return "bibtex";
  if (extension === "json") return "json";
  if (extension === "md") return "markdown";
  return "latex";
}

export function configureMonacoLatexTheme(monacoApi: MonacoApi) {
  if (!isMonacoLatexConfigured) {
    if (!monacoApi.languages.getLanguages().some((language) => language.id === "latex")) {
      monacoApi.languages.register({ id: "latex" });
    }
    monacoApi.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%.*$/, "comment.latex"],
          [/\\[a-zA-Z@]+\*?/, "keyword.latex"],
          [/\\./, "keyword.latex"],
          [/\$[^$]*\$/, "string.latex"],
          [/[{}[\]()]/, "delimiter.latex"],
          [/[&_^#~]/, "operator.latex"],
        ],
      },
    });
    isMonacoLatexConfigured = true;
  }
  monacoApi.editor.defineTheme(MONACO_LATEX_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.latex", foreground: "1f6fb2", fontStyle: "bold" },
      { token: "comment.latex", foreground: "5f8b67", fontStyle: "italic" },
      { token: "string.latex", foreground: "9a5b00" },
      { token: "delimiter.latex", foreground: "7a4cb0" },
      { token: "operator.latex", foreground: "a33b3b" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#20262d",
      "editorLineNumber.foreground": "#8d98a5",
      "editorLineNumber.activeForeground": "#2c6f9f",
      "editor.selectionBackground": "#cfe8ff",
      "editor.inactiveSelectionBackground": "#e6f2fc",
      "editorCursor.foreground": "#1f6fb2",
      "editorGutter.background": "#ffffff",
    },
  });
}
