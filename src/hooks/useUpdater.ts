import { useCallback, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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
      setError(String(e));
      setStatus("error");
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

  return {
    status,
    newVersion,
    downloaded,
    contentLength,
    error,
    checkForUpdates,
    downloadAndInstall,
    restart,
  };
}
