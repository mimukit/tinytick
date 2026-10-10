// The glue between the pure core and Raycast: preferences, the cache file,
// and the API clients built from the stored secrets.
import { Cache, LocalStorage, getPreferenceValues } from "@raycast/api";
import { OpenApi } from "../api/client";
import { V2Api } from "../api/v2";
import { getAuth } from "../auth/secrets";
import { newObjectId } from "../parse/quickadd";
import { EMPTY_SNAPSHOT, parseSnapshot, syncOpen, syncV2, type Snapshot } from "./snapshot";

export interface Preferences {
  refreshAge: string;
  prefill: "none" | "clipboard" | "selection";
  safeUpdates: boolean;
  enableV2: boolean;
}

export function prefs(): Preferences {
  const p = getPreferenceValues<Partial<Preferences>>();
  return {
    refreshAge: p.refreshAge ?? "10",
    prefill: p.prefill ?? "none",
    safeUpdates: !!p.safeUpdates,
    enableV2: !!p.enableV2,
  };
}

const cache = new Cache();
const SNAPSHOT_KEY = "snapshot";

export function loadSnapshot(): Snapshot {
  return parseSnapshot(cache.get(SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT;
}

export function saveSnapshot(snapshot: Snapshot): void {
  cache.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearSnapshot(): void {
  cache.remove(SNAPSHOT_KEY);
}

export class NotSignedInError extends Error {
  constructor() {
    super("Sign in to TickTick from the Account command.");
    this.name = "NotSignedInError";
  }
}

export async function openApi(): Promise<OpenApi> {
  const auth = await getAuth();
  if (!auth.token) throw new NotSignedInError();
  return new OpenApi(auth.token);
}

async function deviceId(): Promise<string> {
  const stored = await LocalStorage.getItem<string>("v2DeviceId");
  if (stored) return stored;
  const id = newObjectId();
  await LocalStorage.setItem("v2DeviceId", id);
  return id;
}

/** The v2 client, or undefined when v2 is off or has no cookie. */
export async function v2Api(): Promise<V2Api | undefined> {
  if (!prefs().enableV2) return undefined;
  const auth = await getAuth();
  if (!auth.v2Cookie) return undefined;
  return new V2Api(auth.v2Cookie, await deviceId());
}

/**
 * Syncs and saves the cache. With v2 on, one request; a background refresh
 * asks for the delta, a manual sync for everything.
 */
export async function syncNow(opts: { full?: boolean } = {}): Promise<Snapshot> {
  const previous = loadSnapshot();
  const v2 = await v2Api();
  const next = v2 ? await syncV2(v2, previous, opts) : await syncOpen(await openApi(), previous);
  saveSnapshot(next);
  return next;
}
