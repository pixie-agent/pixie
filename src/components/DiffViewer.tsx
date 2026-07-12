import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { memo, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { DiffFile, DiffFileStatus, DiffLineType, DiffViewMode } from "../types";
import { parseGitDiff } from "../lib/diffParser";
import { languageOfPath } from "../lib/languages";
import { useTranslation } from "../hooks/useTranslation";

interface DiffViewerProps {
  /** Raw `git diff` unified output. */
  diff: string;
  viewMode: DiffViewMode;
  /** Called when user wants to reveal a diff file in the OS file manager. */
  onRevealPath?: (relativePath: string) => void;
}

const MAX_LINES_PER_FILE = 2000;

// Status badge → {label, color}.
const STATUS_META: Record<DiffFileStatus, { label: string; color: string }> = {
  added: { label: "A", color: "#3fb950" },
  modified: { label: "M", color: "#d29922" },
  deleted: { label: "D", color: "#f85149" },
  renamed: { label: "R", color: "#58a6ff" },
};

const SIGN: Record<DiffLineType, string> = { add: "+", delete: "-", context: " " };

function currentDiffTheme(): "light" | "dark" {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "light" || theme === "paper-mint" ? "light" : "dark";
}

function toDiffMode(viewMode: DiffViewMode): DiffModeEnum {
  return viewMode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified;
}

function buildDiffData(file: DiffFile): {
  diffList: string[];
  oldContent: string;
  newContent: string;
  cap: number;
  totalLines: number;
} {
  const hunks: string[] = [];
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let used = 0;
  let totalLines = 0;

  for (const hunk of file.hunks) {
    const hunkLineCount = hunk.lines.length;
    totalLines += hunkLineCount;
    if (used >= MAX_LINES_PER_FILE) continue;
    if (used > 0 && used + hunkLineCount > MAX_LINES_PER_FILE) continue;

    const lines = [hunk.header];
    for (const line of hunk.lines) {
      lines.push(`${SIGN[line.type]}${line.text}`);
      used += 1;
      if (line.noNewline) lines.push("\\ No newline at end of file");

      if (line.oldNumber !== undefined) oldLines[line.oldNumber - 1] = line.text;
      if (line.newNumber !== undefined) newLines[line.newNumber - 1] = line.text;
    }
    hunks.push(lines.join("\n"));
  }

  const oldPath = file.oldPath ?? file.path;
  const oldMarker = file.status === "added" ? "/dev/null" : `a/${oldPath}`;
  const newMarker = file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
  const diffHeader = [`diff --git a/${oldPath} b/${file.path}`, `--- ${oldMarker}`, `+++ ${newMarker}`].join("\n");

  return {
    diffList: hunks.length > 0 ? [`${diffHeader}\n${hunks.join("\n")}`] : [],
    oldContent: oldLines.map((line) => line ?? "").join("\n"),
    newContent: newLines.map((line) => line ?? "").join("\n"),
    cap: used,
    totalLines,
  };
}

function DiffFileCard({
  file,
  viewMode,
  onRevealPath,
}: {
  file: DiffFile;
  viewMode: DiffViewMode;
  onRevealPath?: (relativePath: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const meta = STATUS_META[file.status];

  const diffData = useMemo(() => {
    const oldPath = file.oldPath ?? file.path;
    const { diffList, oldContent, newContent, cap, totalLines } = buildDiffData(file);
    return {
      cap,
      totalLines,
      data: {
        oldFile: {
          fileName: oldPath,
          fileLang: languageOfPath(oldPath),
          content: oldContent,
        },
        newFile: {
          fileName: file.path,
          fileLang: languageOfPath(file.path),
          content: newContent,
        },
        hunks: diffList,
      },
    };
  }, [file]);

  const renderBody = (): ReactElement => {
    if (file.binary) {
      return (
        <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)] italic">{t("diffViewer.binaryChanged")}</div>
      );
    }
    if (file.hunks.length === 0) {
      return (
        <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)] italic">
          {file.status === "renamed" ? t("diffViewer.renamedNoChanges") : t("diffViewer.noTextualChanges")}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <DiffView
          className="pixie-git-diff-view min-w-full"
          data={diffData.data}
          diffViewFontSize={11}
          diffViewHighlight={false}
          diffViewMode={toDiffMode(viewMode)}
          diffViewTheme={currentDiffTheme()}
          diffViewWrap={false}
        />
        {diffData.totalLines > diffData.cap && (
          <div className="px-3 py-1.5 text-[10px] text-[var(--text-secondary)] italic">
            {t("diffViewer.showingLines", { cap: diffData.cap, total: diffData.totalLines })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border-b border-[var(--border-color)] last:border-b-0">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <span
          className="text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded shrink-0"
          style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
          title={t(`diffViewer.fileStatus.${file.status}`)}
        >
          {meta.label}
        </span>
        <span
          className="text-[10px] text-[var(--text-secondary)] shrink-0"
          style={{ transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "none" }}
        >
          ▾
        </span>
        <span className="text-[11px] text-[var(--text-primary)] truncate flex-1 font-mono">
          {file.path}
        </span>
        {onRevealPath && (
          <span
            role="button"
            tabIndex={0}
            title={t("rightPanel.revealInFileManager")}
            aria-label={t("rightPanel.revealInFileManager")}
            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onRevealPath(file.path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRevealPath(file.path);
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </span>
        )}
        {file.status === "renamed" && file.oldPath && (
          <span className="text-[10px] text-[var(--text-secondary)] truncate shrink-0">← {file.oldPath}</span>
        )}
        {file.additions > 0 && (
          <span className="text-[10px] font-mono shrink-0" style={{ color: "#3fb950" }}>
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-[10px] font-mono shrink-0" style={{ color: "#f85149" }}>
            −{file.deletions}
          </span>
        )}
      </button>
      {!collapsed && renderBody()}
    </div>
  );
}

const DiffFileCardMemo = memo(DiffFileCard);

function DiffViewerImpl({ diff, viewMode, onRevealPath }: DiffViewerProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseGitDiff(diff), [diff]);

  if (parsed.empty) {
    return (
      <div className="px-3 py-6 text-center text-xs text-[var(--text-secondary)]">{t("diffViewer.noChanges")}</div>
    );
  }

  return (
    <div className="flex flex-col">
      {parsed.files.map((file, i) => (
        <DiffFileCardMemo key={`${i}:${file.path}`} file={file} viewMode={viewMode} onRevealPath={onRevealPath} />
      ))}
    </div>
  );
}

const DiffViewer = memo(DiffViewerImpl);
export default DiffViewer;
