import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";

import { toUserMessage } from "../../lib/ipc/errors";
import {
  attachTransfers,
  cancelTransfer,
  isActive,
  listTransfers,
  type TransferTask,
} from "../../lib/ipc/transfers";

interface SpeedSample {
  bytes: number;
  at: number;
  bytesPerSecond: number;
}

export interface TransfersState {
  tasks: TransferTask[];
  speeds: Record<string, number>;
  error: string | null;
  /** Increments whenever a task finishes successfully (panes refresh on it). */
  revision: number;
  clearError: () => void;
  cancel: (id: string) => Promise<void>;
}

/** Subscribes to the backend queue and keeps a bounded sample for speed. */
export function useTransfers(): TransfersState {
  const [tasks, setTasks] = useState<TransferTask[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const samples = useRef<Record<string, SpeedSample>>({});
  const statuses = useRef<Record<string, string>>({});

  useEffect(() => {
    let disposed = false;
    const channel = new Channel<TransferTask>();

    channel.onmessage = (task) => {
      setTasks((previous) => {
        const index = previous.findIndex((item) => item.id === task.id);
        if (index === -1) {
          return [task, ...previous];
        }
        const next = [...previous];
        next[index] = task;
        return next;
      });

      const finished = task.status === "completed" || task.status === "skipped";
      const wasActive = statuses.current[task.id] === "running" || statuses.current[task.id] === "queued";
      statuses.current[task.id] = task.status;
      if (finished && wasActive) {
        setRevision((value) => value + 1);
      }

      const sample = samples.current[task.id];
      const now = Date.now();
      if (sample === undefined || now - sample.at >= 400) {
        const elapsed = sample === undefined ? 0 : (now - sample.at) / 1000;
        const delta = sample === undefined ? 0 : task.transferred - sample.bytes;
        const speed = elapsed > 0 ? Math.max(0, delta / elapsed) : 0;
        samples.current[task.id] = {
          bytes: task.transferred,
          at: now,
          bytesPerSecond: speed,
        };
        if (speed > 0 || !isActive(task)) {
          setSpeeds((previous) => ({ ...previous, [task.id]: speed }));
        }
      }
    };

    void attachTransfers(channel)
      .then(() => listTransfers())
      .then((existing) => {
        if (!disposed) {
          setTasks(existing);
        }
      })
      .catch((err) => {
        if (!disposed) {
          setError(toUserMessage(err));
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  const cancel = useCallback(async (id: string) => {
    try {
      await cancelTransfer(id);
    } catch (err) {
      setError(toUserMessage(err));
    }
  }, []);

  return {
    tasks,
    speeds: Object.fromEntries(
      Object.entries(speeds).filter(([, speed]) => speed > 0),
    ),
    error,
    revision,
    clearError: () => setError(null),
    cancel,
  };
}
