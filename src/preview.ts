/**
 * Shared helpers for deciding what's previewable, used by the right-side
 * preview panel (`RightPanel.tsx`) and by chat message bubbles
 * (`MessageBubble.tsx`) so "supported" means the same thing in both places.
 */

export function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export const PREVIEW_EXTENSIONS = new Set([
  "txt", "md", "markdown", "html", "htm", "css", "js", "jsx", "ts", "tsx",
  "json", "yaml", "yml", "toml", "xml", "svg", "csv", "log", "env",
  "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "rb", "php",
  "sh", "bash", "zsh", "fish", "sql", "graphql", "vue", "svelte",
  "ini", "cfg", "conf", "gitignore", "dockerfile", "makefile",
  "lock", "editorconfig",
]);

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);

/** A file whose content the preview panel can render (text/code/markdown/image). */
export function isPreviewableFile(name: string): boolean {
  const ext = getExtension(name);
  return PREVIEW_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

/** Cross-platform last path segment (handles both `/` and `\`). */
export function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
