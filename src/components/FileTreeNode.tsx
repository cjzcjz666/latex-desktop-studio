import {
  BookOpen,
  ChevronRight,
  CheckCircle2,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { FileNode } from "../types";

type EntryKind = "file" | "directory";

export function FileTreeNode({
  node,
  activePath,
  mainFile,
  onSelect,
  isRoot = false,
  onRootMenu,
  onCreateEntry,
  onImportFiles,
  onSetMainFile,
  onRenameEntry,
  onDeleteEntry,
}: {
  node: FileNode;
  activePath: string;
  mainFile?: string;
  onSelect: (node: FileNode) => void;
  isRoot?: boolean;
  onRootMenu?: () => void;
  onCreateEntry?: (kind: EntryKind, parentPath: string) => void;
  onImportFiles?: (parentPath: string) => void;
  onSetMainFile?: (node: FileNode) => void;
  onRenameEntry?: (node: FileNode) => void;
  onDeleteEntry?: (node: FileNode) => void;
}) {
  const [isOpen, setIsOpen] = useState(isRoot);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLSpanElement | null>(null);
  const isMainFile = node.kind === "file" && node.path === mainFile;
  const canSetMainFile = node.kind === "file" && isTexFile(node.name) && !isMainFile;
  const isActiveWithin =
    node.kind === "directory" &&
    Boolean(activePath) &&
    (isRoot || activePath === node.path || activePath.startsWith(`${node.path}/`));

  useEffect(() => {
    if (isActiveWithin) {
      setIsOpen(true);
    }
  }, [isActiveWithin]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuWrapRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [isMenuOpen]);

  function toggleMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsMenuOpen((value) => !value);
  }

  function keepMenuClickInsideRow(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function openContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsMenuOpen(true);
  }

  function runMenuAction(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  const menu =
    isRoot || node.kind === "directory" ? (
      <div className="tree-node-menu" role="menu">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runMenuAction(() => onCreateEntry?.("file", node.path));
          }}
        >
          <FilePlus2 size={14} />
          <span>新建文件</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runMenuAction(() => onCreateEntry?.("directory", node.path));
          }}
        >
          <FolderPlus size={14} />
          <span>新建文件夹</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runMenuAction(() => onImportFiles?.(node.path));
          }}
        >
          <Upload size={14} />
          <span>导入文件</span>
        </button>
        {isRoot && onRootMenu && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              runMenuAction(onRootMenu);
            }}
          >
            <FolderOpen size={14} />
            <span>打开项目</span>
          </button>
        )}
        {!isRoot && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runMenuAction(() => onRenameEntry?.(node));
              }}
            >
              <Pencil size={14} />
              <span>重命名</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runMenuAction(() => onDeleteEntry?.(node));
              }}
            >
              <Trash2 size={14} />
              <span>删除</span>
            </button>
          </>
        )}
      </div>
    ) : (
      <div className="tree-node-menu" role="menu">
        {canSetMainFile && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              runMenuAction(() => onSetMainFile?.(node));
            }}
          >
            <CheckCircle2 size={14} />
            <span>设为主文件</span>
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runMenuAction(() => onRenameEntry?.(node));
          }}
        >
          <Pencil size={14} />
          <span>重命名</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runMenuAction(() => onDeleteEntry?.(node));
          }}
        >
          <Trash2 size={14} />
          <span>删除</span>
        </button>
      </div>
    );

  if (node.kind === "directory") {
    return (
      <details
        open={isOpen}
        className={[
          "tree-directory",
          isRoot ? "tree-root" : "",
          isActiveWithin && !isRoot ? "tree-directory-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
      >
        <summary className="tree-row" onContextMenu={openContextMenu}>
          <ChevronRight className="tree-chevron" size={18} />
          <span>{node.name}</span>
          {isRoot && onRootMenu && !onCreateEntry ? (
            <button
              type="button"
              className="tree-menu-button"
              title="项目操作"
              aria-label="项目操作"
              onMouseDown={keepMenuClickInsideRow}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                onRootMenu();
              }}
            >
              <MoreVertical size={18} />
            </button>
          ) : (
            <span className="tree-menu-wrap" ref={menuWrapRef}>
              <button
                type="button"
                className="tree-menu-button"
                title={isRoot ? "项目操作" : "文件夹操作"}
                aria-label={isRoot ? "项目操作" : "文件夹操作"}
                onMouseDown={keepMenuClickInsideRow}
                onClick={toggleMenu}
              >
                <MoreVertical size={18} />
              </button>
              {isMenuOpen && menu}
            </span>
          )}
        </summary>
        <div className="tree-children">
          {(node.children ?? []).map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              activePath={activePath}
              mainFile={mainFile}
              onSelect={onSelect}
              onCreateEntry={onCreateEntry}
              onImportFiles={onImportFiles}
              onSetMainFile={onSetMainFile}
              onRenameEntry={onRenameEntry}
              onDeleteEntry={onDeleteEntry}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div
      className={`tree-file-row ${node.path === activePath ? "tree-active" : ""}`}
      onContextMenu={openContextMenu}
    >
      <button type="button" className="tree-file" onClick={() => onSelect(node)} title={node.path}>
        {fileIcon(node.name)}
        <span className="tree-file-name">{node.name}</span>
        {isMainFile && <span className="tree-main-badge">主</span>}
      </button>
      <span className="tree-menu-wrap" ref={menuWrapRef}>
        <button
          type="button"
          className="tree-menu-button"
          title="文件操作"
          aria-label="文件操作"
          onMouseDown={keepMenuClickInsideRow}
          onClick={toggleMenu}
        >
          <MoreVertical size={18} />
        </button>
        {isMenuOpen && menu}
      </span>
    </div>
  );
}

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".bib")) return <BookOpen size={18} />;
  if (/\.(png|jpe?g|gif|webp|pdf)$/.test(lower)) return <FileImage size={18} />;
  return <FileText size={18} />;
}

function isTexFile(name: string) {
  return name.toLowerCase().endsWith(".tex");
}
