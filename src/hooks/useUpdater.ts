import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installed"
  | "error";

export interface UseUpdaterResult {
  status: UpdateStatus;
  newVersion: string | null;
  downloaded: number;
  contentLength: number;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  installBeta: () => Promise<void>;
  restart: () => Promise<void>;
}

// `check()` returns null when the remote version is <= the installed one,
// so "no update needed" is built-in — no manual version comparison required.
export function useUpdater(): UseUpdaterResult {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Progress events for the beta install (emitted by the backend command).
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ downloaded: number; total: number | null }>("update-download-progress", (e) => {
      setDownloaded(e.payload.downloaded);
      if (e.payload.total != null) setContentLength(e.payload.total);
    }).then((u) => (un = u));
    return () => {
      un?.();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    setStatus("checking");
    setError(null);
    setDownloaded(0);
    setContentLength(0);
    try {
      const result = await check();
      setUpdate(result);
      setNewVersion(result?.version ?? null);
      setStatus(result ? "available" : "up-to-date");
    } catch (e) {
      // If the update manifest doesn't have a build for this platform, treat
      // it as "up-to-date" rather than an error — there's nothing to install.
      const msg = String(e);
      if (msg.includes("None of the fallback platforms")) {
        setStatus("up-to-date");
      } else {
        setError(msg);
        setStatus("error");
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!update) return;
    setStatus("downloading");
    setError(null);
    try {
      let received = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setContentLength(total);
            break;
          case "Progress":
            received += event.data.chunkLength;
            setDownloaded(received);
            break;
          case "Finished":
            break;
        }
      });
      setStatus("installed");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [update]);

  const restart = useCallback(async () => {
    try {
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  // Install the latest beta (prerelease). Discovers the latest prerelease via
  // the GitHub API, then hands its manifest URL to the backend, which builds an
  // updater against that endpoint and installs it. Stable users stay on stable
  // — this is an explicit opt-in.
  const installBeta = useCallback(async () => {
    setStatus("checking");
    setError(null);
    setDownloaded(0);
    setContentLength(0);
    try {
      const res = await fetch(
        "https://api.github.com/repos/white1or1black/pixie/releases?per_page=30",
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const releases = (await res.json()) as Array<{
        tag_name: string;
        prerelease: boolean;
        draft: boolean;
      }>;
      const beta = releases.find(
        (r) => r.prerelease && !r.draft && r.tag_name.startsWith("app-v"),
      );
      if (!beta) {
        setError("No beta version is available yet. Check back soon.");
        setStatus("error");
        return;
      }
      const endpoint = `https://github.com/white1or1black/pixie/releases/download/${beta.tag_name}/latest.json`;
      setStatus("downloading");
      const installed = await invoke<string | null>("install_update_from_endpoint", {
        endpoint,
      });
      if (installed) {
        setNewVersion(installed);
        setStatus("installed");
      } else {
        setStatus("up-to-date"); // already on the latest beta
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  return {
    status,
    newVersion,
    downloaded,
    contentLength,
    error,
    checkForUpdates,
    downloadAndInstall,
    installBeta,
    restart,
  };
}
