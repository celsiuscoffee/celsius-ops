// Lightweight connectivity tracking — deliberately NO native dependency
// (@react-native-community/netinfo). We infer online/offline from whether the
// till's Supabase calls succeed, and expose a short-timeout helper so an
// offline call fails fast instead of hanging on the default socket timeout.
//
// This keeps the APK rebuild dependency-free; if we later want instant OS-level
// reconnect events, NetInfo can drop in behind the same getOnline()/subscribe.

type Listener = (online: boolean) => void;

let online = true;
const listeners = new Set<Listener>();

export function getOnline(): boolean {
  return online;
}

export function markOnline(): void {
  setOnline(true);
}

export function markOffline(): void {
  setOnline(false);
}

function setOnline(v: boolean): void {
  if (online === v) return;
  online = v;
  for (const l of listeners) {
    try {
      l(v);
    } catch {
      /* listener must not break the toggle */
    }
  }
}

/** Subscribe to online/offline transitions. Fires immediately with current state. */
export function subscribeOnline(l: Listener): () => void {
  listeners.add(l);
  try {
    l(online);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(l);
}

/** Race a promise against a timeout so an offline network call fails fast
 *  (instead of hanging ~10-30s on the default socket timeout). */
export function withTimeout<T>(p: PromiseLike<T>, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network-timeout")), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
