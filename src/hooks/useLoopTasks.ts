import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LoopTask, LoopIterationRecord } from "../types";

/**
 * Hook over the loop-task Tauri commands. Loads tasks + iteration history on
 * mount, refreshes on window focus and whenever a loop event arrives.
 * When a loop is running, automatically refreshes iterations for that task
 * on every iteration-complete event.
 */
export function useLoopTasks() {
  const [tasks, setTasks] = useState<LoopTask[]>([]);
  const [iterations, setIterations] = useState<LoopIterationRecord[]>([]);
  /** ID of the running task whose iterations we're actively watching. */
  const watchedTaskId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const t = await invoke<LoopTask[]>("list_loop_tasks");
      setTasks(t);
      // Auto-detect the running task and keep its iterations loaded.
      const running = t.find((task) => task.status === "running");
      if (running) {
        watchedTaskId.current = running.id;
        const i = await invoke<LoopIterationRecord[]>("list_loop_iterations", {
          taskId: running.id,
        });
        setIterations(i);
      } else if (watchedTaskId.current) {
        // Loop finished — load final iterations for the task we were watching.
        const i = await invoke<LoopIterationRecord[]>("list_loop_iterations", {
          taskId: watchedTaskId.current,
        });
        setIterations(i);
        watchedTaskId.current = null;
      }
    } catch (e) {
      console.error("useLoopTasks load failed", e);
    }
  }, []);

  const loadIterations = useCallback(async (taskId: string) => {
    try {
      const i = await invoke<LoopIterationRecord[]>("list_loop_iterations", {
        taskId,
      });
      setIterations(i);
    } catch (e) {
      console.error("useLoopTasks iterations load failed", e);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Refresh on focus: the scheduler can fire while the window is hidden.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Live refresh on loop events.
  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;

    listen<{ task_id: string }>("loop-iteration-complete", (evt) => {
      refresh();
      // Also reload iterations for the running task.
      if (evt.payload.task_id) {
        watchedTaskId.current = evt.payload.task_id;
        void loadIterations(evt.payload.task_id);
      }
    }).then((u) => (un1 = u));

    listen<{ task_id: string }>("loop-cycle-complete", () => refresh()).then(
      (u) => (un2 = u)
    );
    listen<{ task_id: string }>("loop-cycle-started", (evt) => {
      refresh();
      if (evt.payload.task_id) {
        watchedTaskId.current = evt.payload.task_id;
        void loadIterations(evt.payload.task_id);
      }
    }).then((u) => (un3 = u));

    return () => {
      un1?.();
      un2?.();
      un3?.();
    };
  }, [refresh, loadIterations]);

  const create = useCallback(
    async (input: {
      name: string;
      workspace: string;
      engine: LoopTask["engine"];
      initial_prompt: string;
      result_template: string;
      exit_conditions: LoopTask["exit_conditions"];
      schedule?: LoopTask["schedule"] | null;
      enabled: boolean;
    }) => {
      const task = await invoke<LoopTask>("create_loop_task", {
        task: {
          id: "",
          iteration: 0,
          status: "idle" as const,
          last_result: null,
          unchanged_streak: 0,
          next_run: null,
          last_run: null,
          created_at: "",
          ...input,
        },
      });
      await refresh();
      return task;
    },
    [refresh]
  );

  const update = useCallback(
    async (task: LoopTask) => {
      await invoke<void>("update_loop_task", { task });
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (taskId: string) => {
      await invoke<void>("delete_loop_task", { taskId });
      await refresh();
    },
    [refresh]
  );

  const toggle = useCallback(
    async (taskId: string, enabled: boolean) => {
      await invoke<void>("toggle_loop_task", { taskId, enabled });
      await refresh();
    },
    [refresh]
  );

  const start = useCallback(async (taskId: string) => {
    watchedTaskId.current = taskId;
    await invoke<string>("start_loop_task", { taskId });
    await refresh();
    await loadIterations(taskId);
  }, [refresh, loadIterations]);

  const pause = useCallback(async (taskId: string) => {
    await invoke<void>("pause_loop_task", { taskId });
    await refresh();
  }, [refresh]);

  const resume = useCallback(async (taskId: string) => {
    watchedTaskId.current = taskId;
    await invoke<void>("resume_loop_task", { taskId });
    await refresh();
    await loadIterations(taskId);
  }, [refresh, loadIterations]);

  const stop = useCallback(async (taskId: string) => {
    await invoke<void>("stop_loop_task", { taskId });
    await refresh();
  }, [refresh]);

  const resumeWithPrompt = useCallback(async (taskId: string, userPrompt: string) => {
    watchedTaskId.current = taskId;
    await invoke<void>("resume_loop_task_with_prompt", { taskId, userPrompt });
    await refresh();
    await loadIterations(taskId);
  }, [refresh, loadIterations]);

  const discard = useCallback(async (taskId: string) => {
    await invoke<void>("discard_loop_task", { taskId });
    await refresh();
  }, [refresh]);

  return {
    tasks,
    iterations,
    refresh,
    loadIterations,
    create,
    update,
    remove,
    toggle,
    start,
    pause,
    resume,
    resumeWithPrompt,
    stop,
    discard,
  };
}
