import { Braces, Copy, FileText, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectAsset } from "../types";

export function AssetPreview({
  asset,
  onInsertSnippet,
  onStatus,
}: {
  asset: ProjectAsset;
  onInsertSnippet?: (snippet: string) => boolean;
  onStatus?: (message: string) => void;
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const isImage = asset.mimeType.startsWith("image/");
  const isPdf = asset.mimeType === "application/pdf";
  const canUseAsGraphic = isImage || isPdf;

  useEffect(() => {
    const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType });
    const nextUrl = URL.createObjectURL(blob);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [asset]);

  async function copyAssetPath() {
    await copyText(asset.path, `已复制资源路径：${asset.path}`);
  }

  async function copyIncludeGraphics() {
    await useSnippet(
      `\\includegraphics[width=0.9\\linewidth]{${asset.path}}`,
      "已复制 includegraphics 代码。",
    );
  }

  async function copyFigureEnvironment() {
    await useSnippet(buildFigureSnippet(asset.path), "已复制 figure 环境代码。");
  }

  async function useSnippet(snippet: string, fallbackCopyMessage: string) {
    if (onInsertSnippet?.(snippet)) {
      return;
    }
    await copyText(snippet, fallbackCopyMessage);
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      onStatus?.(successMessage);
    } catch (error) {
      onStatus?.(`复制失败：${String(error)}`);
    }
  }

  return (
    <section className="asset-preview">
      <div className="asset-preview-toolbar">
        <div className="asset-preview-title">
          {isImage ? <ImageIcon size={16} /> : <FileText size={16} />}
          <div>
            <strong>{shortFileName(asset.path)}</strong>
            <span>
              {asset.path} · {formatBytes(asset.size)}
            </span>
          </div>
        </div>
        <div className="asset-preview-actions">
          <button type="button" onClick={() => void copyAssetPath()} title="复制 LaTeX 引用路径">
            <Copy size={15} />
            <span>路径</span>
          </button>
          {canUseAsGraphic && (
            <>
              <button
                type="button"
                onClick={() => void copyIncludeGraphics()}
                title={onInsertSnippet ? "插入 includegraphics" : "复制 includegraphics"}
              >
                <ImageIcon size={15} />
                <span>插图</span>
              </button>
              <button
                type="button"
                onClick={() => void copyFigureEnvironment()}
                title={onInsertSnippet ? "插入 figure 环境" : "复制 figure 环境"}
              >
                <Braces size={15} />
                <span>Figure</span>
              </button>
            </>
          )}
        </div>
      </div>
      <div className="asset-preview-stage">
        {objectUrl && isImage && <img src={objectUrl} alt={asset.path} />}
        {objectUrl && isPdf && (
          <object data={objectUrl} type="application/pdf" title={asset.path}>
            <span>当前系统无法在内置区域预览这个 PDF。</span>
          </object>
        )}
      </div>
    </section>
  );
}

function shortFileName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function buildFigureSnippet(path: string) {
  return [
    "\\begin{figure}[t]",
    "  \\centering",
    `  \\includegraphics[width=0.9\\linewidth]{${path}}`,
    "  \\caption{TODO: Add caption.}",
    `  \\label{${figureLabel(path)}}`,
    "\\end{figure}",
  ].join("\n");
}

function figureLabel(path: string) {
  const fileName = shortFileName(path);
  const stem = fileName.replace(/\.[^.]+$/, "");
  const cleaned = stem
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `fig:${cleaned || "figure"}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
