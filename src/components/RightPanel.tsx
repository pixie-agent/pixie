import { lazy, memo, Suspense, useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type ComponentPropsWithoutRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { FileEntry, PreviewTarget, DiffViewMode } from "../types";
import { getExtension, PREVIEW_EXTENSIONS, IMAGE_EXTENSIONS, basename } from "../preview";
import { languageFromExt } from "../lib/languages";
import { segmentColor, tokenizeSource, type TokenSegment } from "../lib/highlight";
import { useDragRegion } from "../hooks/useDragRegion";
import { useTranslation } from "../hooks/useTranslation";
import { openExternal } from "../openExternal";
import Terminal from "./Terminal";

const DiffViewer = lazy(() => import("./DiffViewer"));

interface RightPanelProps {
  workspacePath: string;
  previewTarget: PreviewTarget | null;
}

type Tab = "files" | "preview" | "git" | "terminal";

const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
  "rb", "php", "css", "scss", "less", "json", "yaml", "yml", "toml", "xml",
  "sql", "graphql", "sh", "bash", "zsh", "fish", "vue", "svelte",
]);

const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 320;
const MAIN_COLUMN_MIN_WIDTH = 420;
const DEFAULT_CHANGES_HEIGHT = 260;
const MIN_CHANGES_HEIGHT = 120;
const MIN_HISTORY_HEIGHT = 120;
const TAB_MOUNT_DELAY_MS = 45;
const PREVIEW_RENDER_DELAY_MS = 45;
const RICH_PREVIEW_CHAR_LIMIT = 20_000;
const HIGHLIGHT_BATCH_LINES = 160;
const EXTERNAL_LINK_RE = /^(https?:\/\/|mailto:|tel:|obsidian:\/\/)/i;
const HTML_PREVIEW_LINK_MESSAGE_TYPE = "pixie-preview-open-external";

const MD_CODE_STYLE: CSSProperties = { margin: 0, borderRadius: "0.5rem", fontSize: "0.75rem" };
const REMARK_PLUGINS = [remarkGfm];
const shellEscape = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function isExternalPreviewLink(href: string): boolean {
  return EXTERNAL_LINK_RE.test(href.trim());
}

function isHtmlPreviewLinkMessage(value: unknown): value is { type: typeof HTML_PREVIEW_LINK_MESSAGE_TYPE; href: string } {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  return msg.type === HTML_PREVIEW_LINK_MESSAGE_TYPE && typeof msg.href === "string";
}

function htmlPreviewSrcDoc(content: string): string {
  const script = `<script>
(function () {
  var allowed = /^(https?:\\/\\/|mailto:|tel:|obsidian:\\/\\/)/i;
  document.addEventListener("click", function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.href || anchor.getAttribute("href") || "";
    event.preventDefault();
    event.stopPropagation();
    if (allowed.test(href)) {
      window.parent.postMessage({ type: "${HTML_PREVIEW_LINK_MESSAGE_TYPE}", href: href }, "*");
    }
  }, true);
}());
</script>`;

  if (/<\/body\s*>/i.test(content)) {
    return content.replace(/<\/body\s*>/i, `${script}</body>`);
  }
  return `${content}${script}`;
}

// Memoize the whole markdown render so resize-drag (which re-renders the
// panel) doesn't re-parse markdown and re-tokenize every fenced code block.
// Only re-runs when the file content actually changes.
const MarkdownView = memo(function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body preview-markdown w-full min-h-full">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={{
          a({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href?: string }) {
            if (typeof href !== "string") return <span {...props}>{children}</span>;
            const isExternal = isExternalPreviewLink(href);
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isExternal) void openExternal(href);
                }}
                className="text-[var(--accent)] hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeStr = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                  customStyle={MD_CODE_STYLE}>
                  {codeStr}
                </SyntaxHighlighter>
              );
            }
            return <code className="bg-[var(--bg-tertiary)] px-1 py-0.5 rounded text-xs" {...props}>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

const PlainTextPreview = memo(function PlainTextPreview({ content }: { content: string }) {
  return (
    <pre className="flex-1 min-h-0 w-full h-full overflow-auto bg-transparent p-3 text-xs font-mono text-[var(--text-primary)] leading-relaxed whitespace-pre">
      {content}
    </pre>
  );
});

function ChunkedCodePreview({
  content,
  language,
  onCancel,
}: {
  content: string;
  language: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<TokenSegment[][]>([]);
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    timer = window.setTimeout(() => {
      if (cancelled) return;
      setLines([]);
      setProgress(0);
      setWorking(true);
      const rawLines = content.split("\n");
      const total = Math.max(1, rawLines.length);
      const acc: TokenSegment[][] = [];
      let index = 0;

      const runBatch = () => {
        if (cancelled) return;
        const end = Math.min(total, index + HIGHLIGHT_BATCH_LINES);
        for (let i = index; i < end; i += 1) {
          const raw = rawLines[i] ?? "";
          const highlighted = tokenizeSource(raw || " ", language);
          const segments = highlighted?.[0];
          acc.push(segments && segments.length > 0 ? segments : [{ text: raw }]);
        }
        index = end;
        setLines(acc.slice());
        setProgress(Math.round((index / total) * 100));
        if (index < total) {
          timer = window.setTimeout(runBatch, 0);
        } else {
          setWorking(false);
        }
      };

      runBatch();
    }, 0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [content, language]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {working && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-secondary)] tabular-nums w-9 text-right">
              {progress}%
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <PlainTextPreview content={content} />
      ) : (
        <pre className="flex-1 min-h-0 overflow-auto p-3 text-xs font-mono leading-relaxed text-[var(--text-primary)]">
          {lines.map((line, lineIndex) => (
            <span key={lineIndex} className="block min-h-[1.5em] whitespace-pre">
              {line.length === 0
                ? " "
                : line.map((seg, segIndex) => (
                    <span key={segIndex} style={{ color: segmentColor(seg) }}>
                      {seg.text}
                    </span>
                  ))}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

// Unified/split toggle shared by the Changes and commit-diff viewers.
function DiffModeToggle({ mode, onChange }: { mode: DiffViewMode; onChange: (m: DiffViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center rounded bg-[var(--bg-tertiary)] p-0.5">
      {(["unified", "split"] as DiffViewMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-1.5 py-0.5 rounded text-[10px] capitalize transition-colors ${
            mode === m ? "bg-[var(--accent)] text-white" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {m === "unified" ? t("diffViewer.unified") : t("diffViewer.split")}
        </button>
      ))}
    </div>
  );
}

function PanelLoading({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
      <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-[var(--text-secondary)]">{t("common.loading")}</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          {t("common.cancel")}
        </button>
      )}
    </div>
  );
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function isPathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedRoot = normalizePathForCompare(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function relativePathSegments(path: string, root: string): string[] {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedRoot = normalizePathForCompare(root);
  if (!isPathWithinRoot(normalizedPath, normalizedRoot)) return [];
  const relative = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "");
  return relative ? relative.split("/").filter(Boolean) : [];
}

function joinWorkspaceSegments(root: string, segments: string[]): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "") || root;
  if (segments.length === 0) return normalizedRoot;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${normalizedRoot}${separator}${segments.join(separator)}`;
}

function FileGlyph({ entry, extension }: { entry: FileEntry; extension: string }) {
  if (entry.is_dir) {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5v-9z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  const label = (extension || "txt").slice(0, 3).toUpperCase();
  return (
    <span className="relative flex h-7 w-7 items-center justify-center rounded-md bg-[var(--bg-primary)] text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-color)]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="absolute top-1 left-1.5 opacity-50">
        <path d="M7 3h7l4 4v14H7V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 3v5h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="mt-3 max-w-[24px] truncate text-[7px] font-semibold leading-none tracking-normal text-[var(--text-secondary)]">
        {label}
      </span>
    </span>
  );
}

function PanelTabIcon({ tab }: { tab: Tab }) {
  if (tab === "files") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5v-9z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tab === "preview") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7V3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M14 3v5h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9.5 12h5M9.5 15h5M9.5 18h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (tab === "git") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7v5a5 5 0 0 0 5 5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="5" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="7" cy="19" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="19" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11z" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8 9 3 3-3 3M13 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RightPanelImpl({ workspacePath, previewTarget }: RightPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("files");
  const [contentTab, setContentTab] = useState<Tab>("files");
  const [tabLoading, setTabLoading] = useState(false);
  const tabLoadTokenRef = useRef(0);
  const [currentPath, setCurrentPath] = useState(workspacePath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const handleDragRegion = useDragRegion();
  const workspaceRoot = useMemo(() => normalizePathForCompare(workspacePath), [workspacePath]);
  const workspaceLabel = basename(workspaceRoot) || workspaceRoot;

  // Preview state
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRenderReady, setPreviewRenderReady] = useState(false);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const previewLoadTokenRef = useRef(0);
  const previewRenderTokenRef = useRef(0);

  // Git state
  const [gitStatus, setGitStatus] = useState("");
  const [gitLog, setGitLog] = useState("");
  const [gitLoading, setGitLoading] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [gitDiff, setGitDiff] = useState("");
  // Uncommitted working-tree diff (`git diff HEAD`), rendered at the top of the git tab.
  const [gitWorkingDiff, setGitWorkingDiff] = useState("");
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("unified");
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [changesHeight, setChangesHeight] = useState(DEFAULT_CHANGES_HEIGHT);
  const gitLoadTokenRef = useRef(0);
  const gitSplitRef = useRef<HTMLDivElement | null>(null);
  const isResizingChanges = useRef(false);
  const didInitChangesHeight = useRef(false);

  // Per-workspace terminal instances. Each workspace maintains a list of
  // terminals (each its own PTY) that stay mounted for the whole session so
  // scrollback and any running process survive tab switches, panel close/reopen,
  // and workspace switches. At least one terminal per workspace is always kept.
  interface TerminalInstance {
    id: string;
    label: string;
    exited: boolean;
  }
  const [terminalsByWs, setTerminalsByWs] = useState<Record<string, TerminalInstance[]>>({});
  // Which terminal instance is currently visible per workspace.
  const [activeTermId, setActiveTermId] = useState<Record<string, string>>({});
  // Monotonic counter so terminal ids stay unique even after add/remove cycles.
  const termSeqRef = useRef(0);

  const makeTerminalId = useCallback((ws: string) => {
    termSeqRef.current += 1;
    return `term-${ws}-${termSeqRef.current}`;
  }, []);

  const ensureWorkspaceTerminals = useCallback(
    (ws: string) => {
      setTerminalsByWs((prev) => {
        if (prev[ws] && prev[ws].length > 0) return prev;
        const id = makeTerminalId(ws);
        setActiveTermId((a) => ({ ...a, [ws]: id }));
        return { ...prev, [ws]: [{ id, label: t("rightPanel.terminalDefault"), exited: false }] };
      });
    },
    [makeTerminalId, t],
  );

  const activateTab = useCallback((next: Tab) => {
    tabLoadTokenRef.current += 1;
    const token = tabLoadTokenRef.current;
    if (next !== "preview") {
      previewLoadTokenRef.current += 1;
      previewRenderTokenRef.current += 1;
      setPreviewLoading(false);
      setPreviewRenderReady(false);
    }
    if (next !== "git") {
      gitLoadTokenRef.current += 1;
      setGitLoading(false);
    }
    setTab(next);
    setTabLoading(true);
    window.setTimeout(() => {
      if (tabLoadTokenRef.current !== token) return;
      setContentTab(next);
      setTabLoading(false);
    }, TAB_MOUNT_DELAY_MS);
  }, []);

  const cancelTabLoad = useCallback(() => {
    tabLoadTokenRef.current += 1;
    if (contentTab !== "preview") {
      previewLoadTokenRef.current += 1;
      previewRenderTokenRef.current += 1;
      setPreviewLoading(false);
      setPreviewRenderReady(false);
    }
    if (contentTab !== "git") {
      gitLoadTokenRef.current += 1;
      setGitLoading(false);
    }
    setTab(contentTab);
    setTabLoading(false);
  }, [contentTab]);

  // Lazily seed a terminal the first time the terminal tab content is mounted in
  // a workspace; later tab switches keep the PTY component mounted but hidden.
  useEffect(() => {
    if (contentTab !== "terminal" || !workspacePath || terminalsByWs[workspacePath]) return;
    const timer = window.setTimeout(() => ensureWorkspaceTerminals(workspacePath), 0);
    return () => window.clearTimeout(timer);
  }, [contentTab, ensureWorkspaceTerminals, terminalsByWs, workspacePath]);

  const createTerminal = useCallback(
    (ws: string) => {
      setTerminalsByWs((prev) => {
        const id = makeTerminalId(ws);
        const next = [
          ...(prev[ws] ?? []),
          { id, label: `${t("rightPanel.terminal")} ${(prev[ws]?.length ?? 0) + 1}`, exited: false },
        ];
        setActiveTermId((a) => ({ ...a, [ws]: id }));
        return { ...prev, [ws]: next };
      });
    },
    [makeTerminalId, t],
  );

  const closeTerminal = useCallback(
    (ws: string, id: string) => {
      setTerminalsByWs((prev) => {
        const list = prev[ws] ?? [];
        // Enforce the minimum-one rule: never close the last terminal.
        if (list.length <= 1) return prev;
        const next = list.filter((t) => t.id !== id);
        setActiveTermId((a) => {
          if (a[ws] !== id) return a;
          return { ...a, [ws]: next[0].id };
        });
        return { ...prev, [ws]: next };
        // Note: the Terminal component for `id` unmounts (it's no longer in the
        // list) and its cleanup kills the PTY.
      });
    },
    [],
  );

  const restartTerminal = useCallback(
    (ws: string, id: string) => {
      // Remount the Terminal with a fresh id so a clean xterm + fresh PTY are
      // spawned. The old component unmounts; since the process already exited
      // its cleanup skips pty_kill.
      setTerminalsByWs((prev) => {
        const list = prev[ws] ?? [];
        const newId = makeTerminalId(ws);
        const next = list.map((t) =>
          t.id === id ? { id: newId, label: t.label, exited: false } : t,
        );
        setActiveTermId((a) => ({ ...a, [ws]: newId }));
        return { ...prev, [ws]: next };
      });
    },
    [makeTerminalId],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isHtmlPreviewLinkMessage(event.data)) return;
      if (!isExternalPreviewLink(event.data.href)) return;
      void openExternal(event.data.href);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleTerminalExit = useCallback(
    (ws: string, id: string) => {
      setTerminalsByWs((prev) => {
        const list = prev[ws];
        if (!list) return prev;
        const inst = list.find((t) => t.id === id);
        if (!inst) return prev; // late event after close — ignore
        // Last terminal standing: auto-respawn so at least one always remains.
        if (list.length === 1) {
          const newId = makeTerminalId(ws);
          setActiveTermId((a) => ({ ...a, [ws]: newId }));
          return { ...prev, [ws]: [{ id: newId, label: inst.label, exited: false }] };
        }
        // Others remain — mark this one exited so an overlay offers restart.
        return {
          ...prev,
          [ws]: list.map((t) => (t.id === id ? { ...t, exited: true } : t)),
        };
      });
    },
    [makeTerminalId],
  );

  const loadDirectory = useCallback(async (path: string) => {
    if (!isPathWithinRoot(path, workspaceRoot)) {
      setCurrentPath(workspaceRoot);
      return;
    }
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>("list_directory", { path });
      setEntries(result);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, [workspaceRoot]);

  const toAbsPath = useCallback((p: string) => {
    // macOS/Linux absolute, Windows drive absolute, or relative-to-workspace.
    const isAbsPosix = p.startsWith("/");
    const isAbsWin = /^[a-zA-Z]:\\/.test(p);
    if (isAbsPosix || isAbsWin) return p;
    const ws = workspacePath.endsWith("/") ? workspacePath.slice(0, -1) : workspacePath;
    return `${ws}/${p.replace(/^\.?\//, "")}`;
  }, [workspacePath]);

  const revealInFileManager = useCallback(async (path: string) => {
    try {
      await invoke<void>("reveal_in_file_manager", { path, workspace_path: workspacePath });
    } catch (err) {
      // Most common cause in dev: backend command not registered until tauri restart.
      // Fall back to a best-effort platform command so the button still works.
      const abs = toAbsPath(path);
      try {
        await invoke<string>("run_command", { command: `open -R ${shellEscape(abs)}`, cwd: workspacePath });
      } catch (fallbackErr) {
        console.error("Failed to reveal in file manager", { path, workspacePath, err, fallbackErr });
      }
    }
  }, [toAbsPath, workspacePath]);

  useEffect(() => {
    const t = window.setTimeout(() => { void loadDirectory(currentPath); }, 0);
    return () => window.clearTimeout(t);
  }, [currentPath, loadDirectory]);

  // Load git data (status, log, and the uncommitted working-tree diff) when the
  // git tab is active. Exposed as `loadGit` so the Changes header can refresh on
  // demand — the working tree changes as the user works.
  const loadGit = useCallback(async () => {
    const token = ++gitLoadTokenRef.current;
    setGitLoading(true);
    const [status, log, workingDiff] = await Promise.all([
      invoke<string>("git_status", { path: workspacePath }).catch(() => t("rightPanel.notGitRepo")),
      invoke<string>("git_log", { path: workspacePath, count: 30 }).catch(() => ""),
      invoke<string>("git_diff", { path: workspacePath, commit: "HEAD" }).catch(() => ""),
    ]);
    if (gitLoadTokenRef.current !== token) return;
    setGitStatus(status);
    setGitLog(log);
    setGitWorkingDiff(workingDiff);
    setGitLoading(false);
  }, [workspacePath, t]);

  useEffect(() => {
    if (contentTab !== "git") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate: fetch git data when the tab becomes active
    loadGit();
  }, [contentTab, loadGit]);

  // Untracked files aren't covered by `git diff HEAD`; surface them separately.
  const untracked = useMemo(
    () =>
      gitStatus
        .split("\n")
        .filter((l) => l.startsWith("?? "))
        .map((l) => l.slice(3).trim())
        .filter(Boolean),
    [gitStatus],
  );

  const openPreview = useCallback(async (entry: FileEntry) => {
    const ext = getExtension(entry.name);
    const token = ++previewLoadTokenRef.current;
    previewRenderTokenRef.current += 1;
    setPreviewFile(entry);
    setPreviewRenderReady(false);
    activateTab("preview");
    if (IMAGE_EXTENSIONS.has(ext)) {
      setPreviewContent(null);
      setPreviewRenderReady(true);
      return;
    }
    if (!PREVIEW_EXTENSIONS.has(ext) && ext !== "") {
      setPreviewContent(null);
      setPreviewRenderReady(true);
      return;
    }
    setPreviewLoading(true);
    setPreviewContent(null);
    try {
      const content = await invoke<string>("read_file_content", { path: entry.path });
      if (previewLoadTokenRef.current !== token) return;
      setPreviewContent(content);
      const renderToken = ++previewRenderTokenRef.current;
      window.setTimeout(() => {
        if (previewLoadTokenRef.current !== token) return;
        if (previewRenderTokenRef.current !== renderToken) return;
        setPreviewRenderReady(true);
      }, PREVIEW_RENDER_DELAY_MS);
    } catch (e) {
      if (previewLoadTokenRef.current !== token) return;
      setPreviewContent(t("rightPanel.failedReadFile", { error: String(e) }));
      setPreviewRenderReady(true);
    } finally {
      if (previewLoadTokenRef.current === token) setPreviewLoading(false);
    }
  }, [activateTab, t]);

  const cancelPreviewLoad = useCallback(() => {
    previewLoadTokenRef.current += 1;
    previewRenderTokenRef.current += 1;
    setPreviewLoading(false);
    setPreviewRenderReady(false);
    setPreviewFile(null);
    setPreviewContent(null);
  }, []);

  useEffect(() => {
    if (contentTab !== "preview" || tabLoading) return;
    if (!previewFile || previewLoading || previewRenderReady) return;

    const ext = getExtension(previewFile.name);
    const hasRenderablePreview =
      IMAGE_EXTENSIONS.has(ext) ||
      (!PREVIEW_EXTENSIONS.has(ext) && ext !== "") ||
      previewContent !== null;
    if (!hasRenderablePreview) return;

    const renderToken = ++previewRenderTokenRef.current;
    const timer = window.setTimeout(() => {
      if (previewRenderTokenRef.current !== renderToken) return;
      setPreviewRenderReady(true);
    }, PREVIEW_RENDER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [contentTab, previewContent, previewFile, previewLoading, previewRenderReady, tabLoading]);

  useEffect(() => {
    if (!panelFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelFullscreen]);

  // React to an externally-requested file preview target (a file path clicked
  // in a chat message). URLs never reach here — they are handed off to the
  // system browser instead. Keyed on `previewTarget` (which carries a nonce)
  // so the same target can be re-opened.
  useEffect(() => {
    if (!previewTarget || previewTarget.kind !== "file") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate: drive panel state from an external prop
    openPreview({ name: basename(previewTarget.path), path: previewTarget.path, is_dir: false, size: 0 });
  }, [previewTarget, openPreview]);

  // The panel no longer remounts on workspace switch (so per-workspace terminals
  // persist), so reset the workspace-scoped views when the workspace changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- legitimate: reset workspace-scoped views on workspace change, since the panel stays mounted */
    setCurrentPath(workspaceRoot);
    setHistory([]);
    setPreviewFile(null);
    setPreviewContent(null);
    setPanelFullscreen(false);
    setSelectedCommit(null);
    setGitDiff("");
    setGitWorkingDiff("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [workspaceRoot]);

  const viewCommitDiff = async (commit: string) => {
    setSelectedCommit(commit);
    try {
      const diff = await invoke<string>("git_diff", { path: workspacePath, commit });
      setGitDiff(diff);
    } catch { setGitDiff(t("rightPanel.failedLoadDiff")); }
  };

  // --- Resize logic ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MAIN_COLUMN_MIN_WIDTH);
      setWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, window.innerWidth - e.clientX)));
    };
    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Drag handle between Changes and History in the Git tab.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingChanges.current) return;
      const el = gitSplitRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dividerH = 6;
      const available = rect.height - dividerH;
      const next = e.clientY - rect.top;
      const maxChanges = Math.max(MIN_CHANGES_HEIGHT, available - MIN_HISTORY_HEIGHT);
      const clamped = Math.min(maxChanges, Math.max(MIN_CHANGES_HEIGHT, next));
      setChangesHeight(clamped);
    };
    const handleMouseUp = () => {
      isResizingChanges.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startChangesResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingChanges.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  // Initialize/clamp the split the first time the Git tab is shown so the
  // default doesn't leave an oversized empty area on tall windows.
  useEffect(() => {
    if (contentTab !== "git") return;
    const el = gitSplitRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const cur = gitSplitRef.current;
      if (!cur) return;
      const rect = cur.getBoundingClientRect();
      const dividerH = 6;
      const available = rect.height - dividerH;
      const maxChanges = Math.max(MIN_CHANGES_HEIGHT, available - MIN_HISTORY_HEIGHT);
      setChangesHeight((prev) => {
        const base = didInitChangesHeight.current ? prev : Math.round(available * 0.5);
        const next = Math.min(maxChanges, Math.max(MIN_CHANGES_HEIGHT, base));
        didInitChangesHeight.current = true;
        return next;
      });
    });
  }, [contentTab]);

  const navigateTo = (path: string) => {
    if (!isPathWithinRoot(path, workspaceRoot)) return;
    setHistory((prev) => [...prev, currentPath]);
    setCurrentPath(path);
  };
  const goBack = () => {
    if (history.length === 0) return;
    let targetIndex = -1;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (isPathWithinRoot(history[i], workspaceRoot)) {
        targetIndex = i;
        break;
      }
    }
    const target = targetIndex >= 0 ? history[targetIndex] : workspaceRoot;
    setCurrentPath(target);
    setHistory(history.slice(0, Math.max(0, targetIndex)).filter((path) => isPathWithinRoot(path, workspaceRoot)));
  };
  const goUp = () => {
    if (normalizePathForCompare(currentPath) === workspaceRoot) return;
    const parent = normalizePathForCompare(currentPath).split("/").slice(0, -1).join("/") || workspaceRoot;
    const target = isPathWithinRoot(parent, workspaceRoot) ? parent : workspaceRoot;
    setHistory((prev) => [...prev, currentPath]);
    setCurrentPath(target);
  };

  const segments = relativePathSegments(currentPath, workspaceRoot);
  const ext = previewFile ? getExtension(previewFile.name) : "";
  const previewText = previewContent ?? "";
  const canUseRichPreview = previewText.length <= RICH_PREVIEW_CHAR_LIMIT;
  const previewNeedsTextContent =
    !!previewFile && !IMAGE_EXTENSIONS.has(ext) && (PREVIEW_EXTENSIONS.has(ext) || ext === "");
  const previewWasCanceledBeforeContent =
    previewNeedsTextContent && !previewLoading && !previewRenderReady && previewContent === null;

  const renderPreviewContent = () => {
    if (!previewFile) return null;
    if (previewLoading || !previewRenderReady) {
      return <PanelLoading onCancel={cancelPreviewLoad} />;
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      return (
        <div className="w-full h-full p-4 flex items-center justify-center">
          <img src={convertFileSrc(previewFile.path)} alt={previewFile.name}
            className="max-w-full max-h-full object-contain rounded" />
        </div>
      );
    }
    if ((ext === "html" || ext === "htm") && previewText.trim()) {
      return (
        <iframe
          srcDoc={htmlPreviewSrcDoc(previewText)}
          className="w-full h-full min-h-full border-0 bg-white"
          sandbox="allow-scripts"
        />
      );
    }
    if (CODE_EXTENSIONS.has(ext)) {
      return (
        <ChunkedCodePreview
          key={`${previewFile.path}:${previewText.length}`}
          content={previewText}
          language={languageFromExt(ext)}
          onCancel={cancelPreviewLoad}
        />
      );
    }
    if (!canUseRichPreview) {
      return <PlainTextPreview content={previewText} />;
    }
    if (ext === "md" || ext === "markdown") {
      return <MarkdownView content={previewText} />;
    }
    return <PlainTextPreview content={previewText} />;
  };

  return (
    <>
    <div
      className={panelFullscreen ? "fixed inset-0 z-50 flex h-screen w-screen overflow-hidden" : "flex h-full shrink-0 overflow-hidden"}
      style={panelFullscreen ? undefined : { width, minWidth: MIN_WIDTH, maxWidth: `calc(100vw - ${MAIN_COLUMN_MIN_WIDTH}px)` }}
    >
      {!panelFullscreen && (
        <div onMouseDown={startResize}
          className="w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--accent)]/50 active:bg-[var(--accent)] transition-colors shrink-0" />
      )}

      <div className="flex-1 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border-color)] min-w-0">
        {/* Header + Tabs. No in-panel close button — the header toolbar toggles
            the whole panel, so an X here would be redundant. */}
        <div className="shrink-0 border-b border-[var(--border-color)]">
          <div className={`relative flex items-center px-4 pr-12 pb-2 ${panelFullscreen ? "pt-8" : "pt-2"}`}>
            <div className="flex gap-1 shrink-0 relative z-10">
              {([
                ["files", t("rightPanel.files")],
                ["preview", t("rightPanel.preview")],
                ["git", t("rightPanel.git")],
                ["terminal", t("rightPanel.terminal")],
              ] as [Tab, string][]).map(([tabId, name]) => (
                <button
                  key={tabId}
                  onClick={() => activateTab(tabId)}
                  title={name}
                  aria-label={name}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,color,box-shadow] ${
                    tab === tabId
                      ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <PanelTabIcon tab={tabId} />
                </button>
              ))}
            </div>
            <div className="flex-1 h-8 min-w-0" onMouseDown={handleDragRegion} />
            <button
              type="button"
              title={panelFullscreen ? t("rightPanel.exitFullscreen") : t("rightPanel.enterFullscreen")}
              aria-label={panelFullscreen ? t("rightPanel.exitFullscreen") : t("rightPanel.enterFullscreen")}
              onClick={() => setPanelFullscreen((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
            >
              {panelFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 1.5v3a1 1 0 0 1-1 1h-3M8.5 12.5v-3a1 1 0 0 1 1-1h3M12.5 5.5h-3a1 1 0 0 1-1-1v-3M1.5 8.5h3a1 1 0 0 1 1 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 1.5h-4v4M8.5 12.5h4v-4M12.5 5.5v-4h-4M1.5 8.5v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Tab content area. `relative` lets the persistent terminal layer overlay
            it without disturbing the files/preview/git layouts. */}
        <div className="flex-1 flex flex-col relative min-h-0">

        {tabLoading && <PanelLoading onCancel={cancelTabLoad} />}

        {/* === FILES TAB === */}
        {!tabLoading && contentTab === "files" && (
          <>
            <div className="shrink-0 border-b border-[var(--border-color)] bg-[color-mix(in_srgb,var(--bg-secondary)_92%,var(--bg-primary))] px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
              <button onClick={goBack} disabled={history.length === 0}
                title={t("rightPanel.navigateBack")}
                aria-label={t("rightPanel.navigateBack")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button onClick={goUp} disabled={segments.length === 0} title={t("rightPanel.navigateUp")} aria-label={t("rightPanel.navigateUp")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 9V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M3.5 5.5 6 3l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    if (normalizePathForCompare(currentPath) === workspaceRoot) return;
                    setHistory((prev) => [...prev, currentPath]);
                    setCurrentPath(workspaceRoot);
                  }}
                  className="shrink-0 rounded px-1 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  {workspaceLabel}
                </button>
                {segments.map((seg, i) => (
                  <span key={i} className="flex shrink-0 items-center">
                    <span className="px-0.5 text-[var(--text-secondary)]/70">/</span>
                    <button onClick={() => {
                      const targetPath = joinWorkspaceSegments(workspaceRoot, segments.slice(0, i + 1));
                      setHistory((prev) => [...prev, currentPath]);
                      setCurrentPath(targetPath);
                    }} className="max-w-[116px] truncate rounded px-1 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]">{seg}</button>
                  </span>
                ))}
              </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2" data-page-find-scope="files">
              {loading && entries.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loading && entries.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-14 text-[var(--text-secondary)]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-[var(--border-color)]">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5v-9z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <p className="text-xs">{t('rightPanel.emptyDirectory')}</p>
                </div>
              )}
              <div className="space-y-0.5">
              {entries.map((entry) => {
                const e = getExtension(entry.name);
                const canPreview = !entry.is_dir && (PREVIEW_EXTENSIONS.has(e) || IMAGE_EXTENSIONS.has(e));
                const isInteractive = entry.is_dir || canPreview;
                return (
                  <div key={entry.path}
                    onClick={() => {
                      if (entry.is_dir) navigateTo(entry.path);
                      else if (canPreview) openPreview(entry);
                    }}
                    className={`group grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors ${
                      isInteractive ? "cursor-pointer hover:border-[var(--border-color)] hover:bg-[var(--bg-primary)]" : "cursor-default hover:bg-[color-mix(in_srgb,var(--bg-primary)_45%,transparent)]"
                    }`}>
                    <FileGlyph entry={entry} extension={e} />
                    <div className="flex-1 min-w-0">
                      <p className={`truncate text-xs ${entry.is_dir ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>{entry.name}</p>
                      {!entry.is_dir && (
                        <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{formatFileSize(entry.size)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      title={t("rightPanel.revealInFileManager")}
                      aria-label={t("rightPanel.revealInFileManager")}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void revealInFileManager(entry.path);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 4h6l2 2h8v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                        <path d="M12 10v6" />
                        <path d="M9 13l3 3 3-3" />
                      </svg>
                    </button>
                    {entry.is_dir
                      ? <span className="shrink-0 rounded-full border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{t("rightPanel.directory")}</span>
                      : <span className="shrink-0 rounded-full bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">{e || t("common.notAvailable")}</span>
                    }
                  </div>
                );
              })}
              </div>
            </div>
          </>
        )}

        {/* === PREVIEW TAB === */}
        {!tabLoading && contentTab === "preview" && (
          <div className="flex-1 flex flex-col min-h-0" data-page-find-scope="preview">
            {!previewFile || previewWasCanceledBeforeContent ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-12 px-4">
                {t('rightPanel.selectFileHint')}
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] shrink-0">
                  <button onClick={() => activateTab("files")}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors shrink-0">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="text-xs text-[var(--text-primary)] truncate flex-1 min-w-0">{previewFile.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] shrink-0">{ext || t("rightPanel.plainTextExt")}</span>
                </div>
                <div className="flex-1 min-h-0 w-full h-full overflow-auto">
                  {renderPreviewContent()}
                </div>
              </>
            )}
          </div>
        )}

        {/* === GIT TAB === */}
        {!tabLoading && contentTab === "git" && (
          <div className="flex-1 flex flex-col min-h-0" data-page-find-scope="git">
            {gitLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div ref={gitSplitRef} className="flex-1 flex flex-col min-h-0">
                  {/* Working-tree (uncommitted) changes — the "new changes", rendered
                      in the same DiffViewer as commit diffs. */}
                  <div
                    className="border-b border-[var(--border-color)] flex flex-col min-h-0"
                    style={changesCollapsed ? undefined : { height: changesHeight }}
                  >
                    <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
                      <button
                        onClick={() => setChangesCollapsed((c) => !c)}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className="text-[10px] text-[var(--text-secondary)]"
                          style={{ transform: changesCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}
                        >
                          ▾
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{t('rightPanel.changes')}</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <DiffModeToggle mode={diffViewMode} onChange={setDiffViewMode} />
                        <button
                          onClick={loadGit}
                          title={t("rightPanel.refresh")}
                          aria-label={t("rightPanel.refresh")}
                          className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-3-6.7" />
                            <path d="M21 3v6h-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {!changesCollapsed && (
                      <div className="flex-1 overflow-auto min-h-0">
                        {gitWorkingDiff ? (
                          <Suspense
                            fallback={
                              <div className="px-3 py-4 text-xs text-[var(--text-secondary)]">
                                {t("common.loading")}
                              </div>
                            }
                          >
                            <DiffViewer diff={gitWorkingDiff} viewMode={diffViewMode} onRevealPath={revealInFileManager} />
                          </Suspense>
                        ) : (
                          <p className="px-3 pb-2 text-xs text-[var(--text-secondary)]">{t('rightPanel.noUncommittedChanges')}</p>
                        )}
                        {untracked.length > 0 && (
                          <div className="border-t border-[var(--border-color)]">
                            <div className="px-3 py-1 text-[10px] text-[var(--text-secondary)]">{t('rightPanel.untracked')}</div>
                            {untracked.map((f, i) => (
                              <div key={i} className="px-3 py-0.5 flex items-center gap-2 text-[11px] font-mono text-[var(--text-secondary)]">
                                <span className="flex-1 min-w-0 truncate">+ {f}</span>
                                <button
                                  type="button"
                                  title={t("rightPanel.revealInFileManager")}
                      aria-label={t("rightPanel.revealInFileManager")}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    void revealInFileManager(f);
                                  }}
                                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors shrink-0"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 4h6l2 2h8v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                                    <path d="M12 10v6" />
                                    <path d="M9 13l3 3 3-3" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Drag handle: resize Changes vs History */}
                  {!changesCollapsed && (
                    <div
                      onMouseDown={startChangesResize}
                      className="h-1.5 cursor-row-resize bg-transparent hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/40 transition-colors shrink-0"
                      title={t("rightPanel.dragToResize")}
                    />
                  )}

                  {/* Git Log */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] sticky top-0 bg-[var(--bg-secondary)]">
                      {t('rightPanel.history')}
                    </div>
                    {gitLog ? (
                      gitLog.split("\n").filter(Boolean).map((line) => {
                        const hash = line.match(/^[*\s|\\/]*([a-f0-9]{7,})/)?.[1];
                        return (
                          <div
                            key={line}
                            onClick={() => hash && viewCommitDiff(hash)}
                            className={`px-3 py-1 text-xs font-mono cursor-pointer transition-colors truncate ${
                              selectedCommit === hash
                                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                                : "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                            }`}
                          >
                            {line}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-[var(--text-secondary)] px-3 py-2">{t('rightPanel.noCommits')}</p>
                    )}
                  </div>
                </div>
                {/* Diff */}
                {gitDiff && (
                  <div className="border-t border-[var(--border-color)] max-h-[55%] overflow-auto shrink-0 flex flex-col">
                    <div className="flex items-center justify-between px-3 py-1.5 sticky top-0 z-10 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                      <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                        {t("rightPanel.diffCommit", { hash: selectedCommit?.slice(0, 7) })}
                      </span>
                      <button onClick={() => { setSelectedCommit(null); setGitDiff(""); }}
                        className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
                        aria-label={t("common.close")}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                    </div>
                    <Suspense
                      fallback={
                        <div className="px-3 py-4 text-xs text-[var(--text-secondary)]">
                          {t("common.loading")}
                        </div>
                      }
                    >
                      <DiffViewer diff={gitDiff} viewMode={diffViewMode} onRevealPath={revealInFileManager} />
                    </Suspense>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* === TERMINAL TAB === */}
        {/* Persistent per-workspace terminals. Each workspace keeps a list of
            terminal instances (each its own PTY) mounted for the whole
            session, so scrollback and any running process survive tab
            switches, panel close/reopen, and workspace switches. Only the
            active workspace's terminals are shown, and only while the
            terminal tab is on. A tab strip lets the user open/close/switch
            between multiple terminals; at least one per workspace is always
            kept, and if the last one's shell exits it auto-respawns. */}
        {Object.entries(terminalsByWs).map(([ws, instances]) => {
          const isThisWs = !tabLoading && contentTab === "terminal" && ws === workspacePath;
          const activeId = activeTermId[ws] ?? instances[0]?.id;
          return (
            <div
              key={ws}
              className="absolute inset-0 flex flex-col"
              data-page-find-scope={isThisWs ? "terminal" : undefined}
              style={{ display: isThisWs ? "flex" : "none" }}
            >
              {/* Tab strip — only rendered for the visible workspace. */}
              {isThisWs && (
                <div className="flex items-center gap-0.5 px-1 py-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0 overflow-x-auto">
                  {instances.map((inst) => {
                    const isActive = inst.id === activeId;
                    const canClose = instances.length > 1;
                    return (
                      <div
                        key={inst.id}
                        className={`group flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-t text-[11px] transition-colors whitespace-nowrap ${
                          isActive
                            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                        }`}
                        onClick={() => setActiveTermId((a) => ({ ...a, [ws]: inst.id }))}
                        role="button"
                      >
                        <span className={inst.exited ? "opacity-60" : ""}>{inst.label}</span>
                        <button
                          type="button"
                          title={canClose ? t("rightPanel.closeTerminal") : t("rightPanel.minOneTerminal")}
                          aria-label={canClose ? t("rightPanel.closeTerminal") : t("rightPanel.minOneTerminal")}
                          disabled={!canClose}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canClose) closeTerminal(ws, inst.id);
                          }}
                          className={`p-0.5 rounded hover:bg-[var(--bg-primary)] transition-colors ${
                            canClose ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)]" : "text-[var(--text-secondary)] opacity-30 cursor-not-allowed"
                          }`}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    title={t("rightPanel.newTerminal")}
                    aria-label={t("rightPanel.newTerminal")}
                    onClick={() => createTerminal(ws)}
                    className="p-1 ml-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Terminal viewport. All instances stay mounted (hidden via
                  display) so their PTYs and scrollback persist. */}
              <div className="flex-1 relative min-h-0">
                {instances.map((inst) => {
                  const show = inst.id === activeId;
                  return (
                    <div
                      key={inst.id}
                      className="absolute inset-0 flex flex-col"
                      style={{ display: show ? "flex" : "none" }}
                    >
                      {inst.exited ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 bg-[#1a1b26] text-center px-4">
                          <p className="text-xs text-[var(--text-secondary)]">{t('rightPanel.processExited')}</p>
                          <button
                            type="button"
                            onClick={() => restartTerminal(ws, inst.id)}
                            className="px-3 py-1 rounded bg-[var(--accent)] text-white text-xs hover:opacity-90 transition-opacity"
                          >
                            {t("rightPanel.restartTerminal")}
                          </button>
                        </div>
                      ) : (
                        <Terminal
                          id={inst.id}
                          cwd={ws}
                          onExit={(tid) => handleTerminalExit(ws, tid)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        </div>
      </div>
    </div>
    </>
  );
}

// Memoize so typing in the composer (which lives in the same AppShell that
// renders this panel) doesn't re-render the panel — and thus doesn't re-run
// Prism over a large file preview or git diff — on every keystroke. Both props
// (workspacePath, previewTarget) are stable across keystrokes, so a shallow
// memo skips it. Mirrors the memo on MessageBubble for the same reason.
const RightPanel = memo(RightPanelImpl);

export default RightPanel;
