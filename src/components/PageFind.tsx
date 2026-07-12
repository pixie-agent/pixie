import { useCallback, useEffect, useRef, useState } from "react";
import { formatModShortcut } from "../lib/i18nFormat";
import { useTranslation } from "../hooks/useTranslation";

const FIND_MARK_SELECTOR = "mark[data-page-find='true']";

function clearHighlights(root: HTMLElement) {
  const marks = Array.from(root.querySelectorAll(FIND_MARK_SELECTOR));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  }
}

function isSearchableTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (!node.nodeValue?.trim()) return false;
  if (parent.closest("[data-page-find-ignore]")) return false;
  if (parent.closest(FIND_MARK_SELECTOR)) return false;
  if (parent.closest("script, style, noscript, textarea, input, select")) return false;
  const style = window.getComputedStyle(parent);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function highlightMatches(root: HTMLElement, query: string): HTMLElement[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isSearchableTextNode(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  const marks: HTMLElement[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    const haystack = text.toLocaleLowerCase();
    let index = haystack.indexOf(needle);
    if (index === -1) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (index !== -1) {
      if (index > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
      }
      const mark = document.createElement("mark");
      mark.dataset.pageFind = "true";
      mark.className = "page-find-match";
      mark.textContent = text.slice(index, index + needle.length);
      fragment.appendChild(mark);
      marks.push(mark);
      cursor = index + needle.length;
      index = haystack.indexOf(needle, cursor);
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  return marks;
}

function closestScope(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-page-find-ignore]")) return null;
  return target.closest("[data-page-find-scope]") as HTMLElement | null;
}

function isUsableScope(scope: HTMLElement | null): scope is HTMLElement {
  if (!scope || !scope.isConnected) return false;
  const style = window.getComputedStyle(scope);
  return style.display !== "none" && style.visibility !== "hidden";
}

export default function PageFind() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const activeScopeRef = useRef<HTMLElement | null>(null);
  const updatingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  const selectActiveMark = useCallback((index: number, scroll = true) => {
    const marks = marksRef.current;
    for (const mark of marks) {
      mark.classList.remove("page-find-active");
    }
    const mark = marks[index];
    if (!mark) return;
    mark.classList.add("page-find-active");
    if (scroll) {
      mark.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  }, []);

  const rebuildHighlights = useCallback((nextQuery: string, nextActiveIndex: number, scroll = true) => {
    const appRoot = document.getElementById("root");
    if (!appRoot) return;
    const searchRoot = isUsableScope(activeScopeRef.current) ? activeScopeRef.current : appRoot;
    updatingRef.current = true;
    clearHighlights(appRoot);
    const marks = highlightMatches(searchRoot, nextQuery);
    marksRef.current = marks;
    setMatchCount(marks.length);

    if (marks.length === 0) {
      setActiveIndex(0);
    } else {
      const boundedIndex = Math.min(Math.max(nextActiveIndex, 0), marks.length - 1);
      setActiveIndex(boundedIndex);
      selectActiveMark(boundedIndex, scroll);
    }
    window.setTimeout(() => {
      updatingRef.current = false;
    }, 0);
  }, [selectActiveMark]);

  useEffect(() => {
    const updateActiveScope = (target: EventTarget | null) => {
      const scope = closestScope(target);
      if (!scope || scope === activeScopeRef.current) return;
      activeScopeRef.current = scope;
      if (open && query.trim()) {
        window.setTimeout(() => rebuildHighlights(query, 0, true), 0);
      }
    };
    const handlePointerDown = (event: PointerEvent) => updateActiveScope(event.target);
    const handleFocusIn = (event: FocusEvent) => updateActiveScope(event.target);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [open, query, rebuildHighlights]);

  const move = useCallback((direction: 1 | -1) => {
    const count = marksRef.current.length;
    if (count === 0) return;
    const next = (activeIndex + direction + count) % count;
    setActiveIndex(next);
    selectActiveMark(next);
  }, [activeIndex, selectActiveMark]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        activeScopeRef.current = closestScope(document.activeElement) ?? activeScopeRef.current;
        setOpen(true);
        window.setTimeout(() => inputRef.current?.select(), 0);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move, open]);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    if (!open) {
      clearHighlights(root);
      marksRef.current = [];
      return;
    }
    const timer = window.setTimeout(() => rebuildHighlights(query, 0, true), 0);
    return () => window.clearTimeout(timer);
  }, [open, query, rebuildHighlights]);

  useEffect(() => {
    if (!open || !query.trim()) return;
    const root = document.getElementById("root");
    if (!root) return;
    let timer: number | undefined;
    const observer = new MutationObserver(() => {
      if (updatingRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => rebuildHighlights(query, activeIndex, false), 80);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [activeIndex, open, query, rebuildHighlights]);

  if (!open) return null;

  return (
    <div
      data-page-find-ignore
      className="fixed top-3 right-3 z-[70] flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2 shadow-xl"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        placeholder={t("pageFind.placeholder")}
        className="w-56 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <span className="w-16 text-right text-xs text-[var(--text-secondary)]">
        {query.trim() ? t("pageFind.count", { current: matchCount ? activeIndex + 1 : 0, total: matchCount }) : formatModShortcut(t, "F")}
      </span>
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={matchCount === 0}
        className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
        aria-label={t("pageFind.previous")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={matchCount === 0}
        className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
        aria-label={t("pageFind.next")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        aria-label={t("common.close")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
