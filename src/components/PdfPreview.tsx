import {
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderSearch,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
  Util,
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { exportPdfFile, openPdfFile, readPdfFile, revealPdfFile } from "../tauri";
import type { PdfSyncTarget } from "../types";

GlobalWorkerOptions.workerSrc = pdfWorker;

type ZoomMode = "fit-width" | "fit-page" | "actual-size" | "custom";
type PdfSearchMatch = {
  page: number;
  excerpt: string;
  rect?: PdfSearchRect;
};
type PdfSearchRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

const MAX_PDF_SEARCH_MATCHES = 100;
const DEFAULT_PDF_SCALE = 1.1;

export function PdfPreview({
  projectRoot,
  pdfPath,
  revision = 0,
  syncTarget,
  onSourceSync,
  onStatus,
}: {
  projectRoot?: string;
  pdfPath?: string;
  revision?: number;
  syncTarget?: PdfSyncTarget | null;
  onSourceSync?: (page: number, x: number, y: number) => void;
  onStatus?: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageShellRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(DEFAULT_PDF_SCALE);
  const [renderedScale, setRenderedScale] = useState(DEFAULT_PDF_SCALE);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [activeSyncTarget, setActiveSyncTarget] = useState<PdfSyncTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<PdfSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(1);
    setPageInput("1");
    setScale(DEFAULT_PDF_SCALE);
    setRenderedScale(DEFAULT_PDF_SCALE);
    setZoomMode("fit-width");
    setActiveSyncTarget(null);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveSearchIndex(-1);
    setError("");
  }, [projectRoot, pdfPath]);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPageCount(0);
    setError("");

    if (!projectRoot || !pdfPath) {
      return;
    }

    let loadingTask: ReturnType<typeof getDocument> | null = null;
    readPdfFile(projectRoot, pdfPath)
      .then((bytes) => {
        if (cancelled) return null;
        loadingTask = getDocument({ data: new Uint8Array(bytes) });
        return loadingTask.promise;
      })
      .then((document) => {
        if (!document) return;
        if (cancelled) {
          document.destroy();
          return;
        }
        setPdf(document);
        setPageCount(document.numPages);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [projectRoot, pdfPath, revision]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    renderTaskRef.current?.cancel();
    pdf
      .getPage(page)
      .then((pdfPage) => {
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const container = containerRef.current;
        const containerRect = container?.getBoundingClientRect();
        const availableWidth = Math.max(160, (viewportSize.width || containerRect?.width || 0) - 40);
        const availableHeight = Math.max(160, (viewportSize.height || containerRect?.height || 0) - 40);
        let nextScale = scale;
        if (zoomMode === "fit-width") {
          nextScale = availableWidth / baseViewport.width;
        } else if (zoomMode === "fit-page") {
          nextScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
        } else if (zoomMode === "actual-size") {
          nextScale = 1;
        }
        nextScale = clamp(nextScale, 0.45, 3);
        setRenderedScale(nextScale);
        const viewport = pdfPage.getViewport({ scale: nextScale });
        const context = canvas.getContext("2d");
        if (!context) return;
        const outputScale = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTaskRef.current = pdfPage.render({
          canvasContext: context,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          viewport,
        });
        return renderTaskRef.current.promise;
      })
      .catch((reason) => {
        if (!cancelled && !String(reason).includes("RenderingCancelledException")) {
          setError(String(reason));
        }
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdf, page, scale, zoomMode, viewportSize]);

  useEffect(() => {
    if (!syncTarget) return;
    setActiveSyncTarget(syncTarget);
    setPage(clamp(syncTarget.page, 1, pageCount || syncTarget.page));
    const timer = window.setTimeout(() => {
      setActiveSyncTarget((current) => (current?.nonce === syncTarget.nonce ? null : current));
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [syncTarget, pageCount]);

  useEffect(() => {
    if (!activeSyncTarget || activeSyncTarget.page !== page) return;
    const container = containerRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      const left = activeSyncTarget.h * renderedScale - container.clientWidth / 2;
      const top = activeSyncTarget.v * renderedScale - container.clientHeight / 2;
      container.scrollTo({
        left: Math.max(0, left),
        top: Math.max(0, top),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSyncTarget, page, renderedScale]);

  useEffect(() => {
    const currentMatch =
      activeSearchIndex >= 0 && activeSearchIndex < searchMatches.length
        ? searchMatches[activeSearchIndex]
        : null;
    if (!currentMatch?.rect || currentMatch.page !== page) return;
    const container = containerRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      const left = currentMatch.rect!.left * renderedScale - container.clientWidth / 2;
      const top = currentMatch.rect!.top * renderedScale - container.clientHeight / 2;
      container.scrollTo({
        left: Math.max(0, left),
        top: Math.max(0, top),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchIndex, searchMatches, page, renderedScale]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (pageCount && page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  function changeCustomScale(delta: number) {
    setZoomMode("custom");
    setScale((value) => clamp((zoomMode === "custom" ? value : renderedScale) + delta, 0.5, 2.4));
  }

  async function runPdfAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function handleExportPdf() {
    if (!projectRoot || !pdfPath) return;
    try {
      const target = await exportPdfFile(projectRoot, pdfPath);
      if (target) {
        onStatus?.(`PDF 已导出：${target}`);
      } else {
        onStatus?.("已取消导出 PDF。");
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function handlePdfSearch(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!pdf) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      return;
    }

    setIsSearching(true);
    setError("");
    try {
      const normalizedQuery = query.toLowerCase();
      const nextMatches: PdfSearchMatch[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pdfPage = await pdf.getPage(pageNumber);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const textContent = await pdfPage.getTextContent();
        const pageTextParts: string[] = [];
        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          const textItem = item as PdfTextItem;
          const itemText = textItem.str.replace(/\s+/g, " ");
          if (!itemText.trim()) continue;
          pageTextParts.push(itemText);
          let matchIndex = itemText.toLowerCase().indexOf(normalizedQuery);
          while (matchIndex >= 0 && nextMatches.length < MAX_PDF_SEARCH_MATCHES) {
            nextMatches.push({
              page: pageNumber,
              excerpt: formatPdfSearchExcerpt(itemText, matchIndex, query.length),
              rect: pdfTextItemSearchRect(viewport.transform, textItem, matchIndex, query.length),
            });
            matchIndex = itemText.toLowerCase().indexOf(normalizedQuery, matchIndex + query.length);
          }
          if (nextMatches.length >= MAX_PDF_SEARCH_MATCHES) break;
        }
        if (!pageTextParts.length) continue;
        if (nextMatches.length >= MAX_PDF_SEARCH_MATCHES) break;
      }
      setSearchMatches(nextMatches);
      if (nextMatches.length) {
        setActiveSearchIndex(0);
        setPage(nextMatches[0].page);
        onStatus?.(`PDF 中找到 ${nextMatches.length} 处匹配。`);
      } else {
        setActiveSearchIndex(-1);
        onStatus?.("PDF 中没有找到匹配内容。");
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsSearching(false);
    }
  }

  function goToSearchMatch(delta: number) {
    if (!searchMatches.length) return;
    const nextIndex =
      activeSearchIndex < 0
        ? 0
        : (activeSearchIndex + delta + searchMatches.length) % searchMatches.length;
    setActiveSearchIndex(nextIndex);
    setPage(searchMatches[nextIndex].page);
  }

  function handlePageSubmit(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const parsed = Number.parseInt(pageInput.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(page));
      return;
    }
    const nextPage = clamp(parsed, 1, pageCount || 1);
    setPage(nextPage);
    setPageInput(String(nextPage));
  }

  function handlePageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onSourceSync || !pdf || error) return;
    if (!event.metaKey && !event.ctrlKey) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    onSourceSync(page, x / renderedScale, y / renderedScale);
  }

  const syncBox =
    activeSyncTarget && activeSyncTarget.page === page
      ? {
          left: `${Math.max(0, activeSyncTarget.h * renderedScale - 3)}px`,
          top: `${Math.max(0, activeSyncTarget.v * renderedScale - 6)}px`,
          width: `${Math.max(34, activeSyncTarget.width * renderedScale + 8)}px`,
          height: `${Math.max(18, activeSyncTarget.height * renderedScale + 10)}px`,
        }
      : null;
  const activeSearchMatch =
    activeSearchIndex >= 0 && activeSearchIndex < searchMatches.length
      ? searchMatches[activeSearchIndex]
      : null;
  const searchBox =
    activeSearchMatch?.rect && activeSearchMatch.page === page
      ? {
          left: `${Math.max(0, activeSearchMatch.rect.left * renderedScale - 3)}px`,
          top: `${Math.max(0, activeSearchMatch.rect.top * renderedScale - 3)}px`,
          width: `${Math.max(18, activeSearchMatch.rect.width * renderedScale + 6)}px`,
          height: `${Math.max(16, activeSearchMatch.rect.height * renderedScale + 6)}px`,
        }
      : null;

  if (!pdfPath) {
    return (
      <div className="empty-preview">
        <strong>暂无 PDF</strong>
        <span>点击“编译”后会在这里预览生成的文档。</span>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-group pdf-page-group" aria-label="PDF 翻页">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            title="上一页"
            aria-label="上一页"
          >
            <ChevronLeft size={15} />
          </button>
          <form className="pdf-page-control" onSubmit={handlePageSubmit}>
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => handlePageSubmit()}
              onFocus={(event) => event.currentTarget.select()}
              disabled={!pageCount}
              inputMode="numeric"
              aria-label="PDF 页码"
              title="输入页码并回车跳转"
            />
            <span>/ {pageCount || 1}</span>
          </form>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(pageCount || 1, value + 1))}
            disabled={page >= pageCount}
            title="下一页"
            aria-label="下一页"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <form className="pdf-search-control" onSubmit={handlePdfSearch}>
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            disabled={!pdf || Boolean(error)}
            aria-label="PDF 搜索关键词"
            placeholder="搜索 PDF"
          />
          <button
            type="submit"
            disabled={!pdf || isSearching || !searchQuery.trim()}
            title="搜索 PDF 文本"
            aria-label="搜索 PDF 文本"
          >
            <Search size={14} />
          </button>
          {(isSearching || searchMatches.length > 0) && (
            <div className="pdf-search-results" aria-label="PDF 搜索结果导航">
              {searchMatches.length > 0 && (
                <button
                  type="button"
                  onClick={() => goToSearchMatch(-1)}
                  title="上一个搜索结果"
                  aria-label="上一个搜索结果"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
              <span>{isSearching ? "搜索中" : `${activeSearchIndex + 1}/${searchMatches.length}`}</span>
              {searchMatches.length > 0 && (
                <button
                  type="button"
                  onClick={() => goToSearchMatch(1)}
                  title="下一个搜索结果"
                  aria-label="下一个搜索结果"
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          )}
        </form>
        <div className="pdf-toolbar-group pdf-zoom-group" aria-label="PDF 缩放">
          <button
            type="button"
            className={zoomMode === "actual-size" ? "pdf-toolbar-active" : ""}
            onClick={() => setZoomMode("actual-size")}
            title="实际大小"
            aria-label="实际大小 100%"
          >
            <span>100%</span>
          </button>
          <button
            type="button"
            onClick={() => changeCustomScale(-0.1)}
            aria-label="缩小"
            title="缩小"
          >
            <ZoomOut size={15} />
          </button>
          <span>{Math.round(renderedScale * 100)}%</span>
          <button
            type="button"
            onClick={() => changeCustomScale(0.1)}
            aria-label="放大"
            title="放大"
          >
            <ZoomIn size={15} />
          </button>
        </div>
        <div className="pdf-toolbar-group pdf-file-group" aria-label="PDF 文件操作">
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={!projectRoot}
            aria-label="导出 PDF"
            title="导出 PDF"
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            onClick={() => void runPdfAction(() => openPdfFile(projectRoot ?? "", pdfPath))}
            disabled={!projectRoot}
            aria-label="用系统阅读器打开 PDF"
            title="用系统阅读器打开 PDF"
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            onClick={() => void runPdfAction(() => revealPdfFile(projectRoot ?? "", pdfPath))}
            disabled={!projectRoot}
            aria-label="在 Finder 中定位 PDF"
            title="在 Finder 中定位 PDF"
          >
            <FolderSearch size={15} />
          </button>
        </div>
      </div>
      <div className="pdf-canvas-scroll" ref={containerRef}>
        {error ? (
          <div className="preview-error">{error}</div>
        ) : (
          <div
            className={`pdf-page-shell ${onSourceSync ? "pdf-page-shell-clickable" : ""}`}
            ref={pageShellRef}
            onClick={handlePageClick}
          >
            <canvas ref={canvasRef} />
            {searchBox && <div className="pdf-search-highlight" style={searchBox} />}
            {syncBox && <div className="pdf-sync-highlight" style={syncBox} />}
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPdfSearchExcerpt(text: string, matchIndex: number, queryLength: number) {
  const start = Math.max(0, matchIndex - 42);
  const end = Math.min(text.length, matchIndex + queryLength + 42);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function pdfTextItemSearchRect(
  viewportTransform: number[],
  item: PdfTextItem,
  matchIndex: number,
  queryLength: number,
): PdfSearchRect {
  const transform = Util.transform(viewportTransform, item.transform);
  const textLength = Math.max(1, item.str.length);
  const itemWidth = Math.max(item.width, Math.abs(transform[0]));
  const itemHeight = Math.max(item.height, Math.abs(transform[3]), 8);
  const matchLeft = (matchIndex / textLength) * itemWidth;
  const matchWidth = Math.max(8, (queryLength / textLength) * itemWidth);
  const left = transform[4] + matchLeft;
  const top = transform[5] - itemHeight;
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: matchWidth,
    height: itemHeight,
  };
}
