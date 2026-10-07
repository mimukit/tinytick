// One in-memory store per open window. Every screen in the window, including
// pushed ones, reads it, so a change on the task screen shows in Today at once.
import { useSyncExternalStore } from "react";
import type { Snapshot } from "./snapshot";
import { loadSnapshot, saveSnapshot } from "./service";

export interface LiveState {
  snapshot: Snapshot;
  loading: boolean;
  undoSize: number;
  undoLabel?: string;
}

let state: LiveState | undefined;
const listeners = new Set<() => void>();

function current(): LiveState {
  state ??= { snapshot: loadSnapshot(), loading: false, undoSize: 0 };
  return state;
}

export function getLive(): LiveState {
  return current();
}

export function setLive(patch: Partial<LiveState>): void {
  state = { ...current(), ...patch };
  for (const l of listeners) l();
}

/** Replaces the snapshot in memory and in the cache file. */
export function commitSnapshot(snapshot: Snapshot): void {
  saveSnapshot(snapshot);
  setLive({ snapshot });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, current, current);
}
