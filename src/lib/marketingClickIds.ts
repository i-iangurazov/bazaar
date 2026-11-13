// A short, consented bridge across the public landing → signup navigation.
// Google's own consented advertising cookies have their own lifetime. These IDs
// never enter the acquisition cookie, registration payload or application DB.
const storageKey = "bazaar_google_click_v1";
const lifetime = 30 * 60 * 1000;
const keys = ["gclid", "gbraid", "wbraid", "gad_source"] as const;
type ClickRecord = { version: 1; at: number; query: string };
let memoryRecord: ClickRecord | null = null;
let lastObservedQuery: string | null = null;
let ignorePersisted = false;

function validatedQuery(search: URLSearchParams): string {
  const result = new URLSearchParams();
  for (const key of keys) {
    const values = search.getAll(key);
    if (values.length !== 1) continue;
    const value = values[0];
    // Google documents gclid's 100-character limit. The other limits are our
    // defensive bounds, not a claim about Google's identifier specification.
    const valid = key === "gad_source" ? /^[0-9]{1,3}$/.test(value)
      : new RegExp(`^[A-Za-z0-9_-]{1,${key === "gclid" ? 100 : 256}}$`).test(value);
    if (valid) result.set(key, value); // Preserve case; never truncate identifiers.
  }
  return result.toString();
}

function readRecord(): ClickRecord | null {
  // A newer consented click still wins if storage is read-only or full and
  // contains a previous click that could not be replaced.
  if (memoryRecord !== null) return memoryRecord;
  if (ignorePersisted) return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Number.isFinite(saved.at) ||
      typeof saved.query !== "string" || saved.query.length > 1000 || !saved.query)
      return null;
    const search = new URLSearchParams(saved.query);
    if (Array.from(search.keys()).some(key => !keys.includes(key as typeof keys[number])) ||
      validatedQuery(search) !== saved.query) return null;
    return saved;
  } catch {
    return memoryRecord;
  }
}

export function clearMarketingClickIds() {
  const hadRecord = readRecord() !== null;
  memoryRecord = null;
  // Removing storage can fail even when reads succeed. Keep an in-memory
  // tombstone so a withdrawn identifier cannot reappear in this document.
  ignorePersisted = true;
  // Do not revive the current landing ID if the user revokes and re-allows in
  // this document. A different Google click can still establish a new bridge.
  if (hadRecord && typeof window !== "undefined")
    lastObservedQuery = validatedQuery(new URLSearchParams(window.location.search));
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
}

export function marketingClickQuery(search: URLSearchParams, now = Date.now()): string {
  const current = validatedQuery(search);
  const hasClickParameter = keys.some(key => search.has(key));
  let saved = readRecord();
  if (hasClickParameter && current !== lastObservedQuery) {
    lastObservedQuery = current;
    // A newer click replaces the entire previous set: never combine an old
    // gclid with a new braid/source. Repeated renders do not renew captured time.
    if (!saved || saved.query !== current) {
      saved = current ? { version: 1, at: now, query: current } : null;
      memoryRecord = saved;
      ignorePersisted = true;
      try {
        if (saved) sessionStorage.setItem(storageKey, JSON.stringify(saved));
        else sessionStorage.removeItem(storageKey);
        memoryRecord = null;
        if (saved) ignorePersisted = false;
      } catch { /* In-memory continuity still works without browser storage. */ }
    }
  }
  if (!saved || saved.at > now || now - saved.at >= lifetime) {
    memoryRecord = null;
    ignorePersisted = true;
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
    return "";
  }
  return saved.query;
}
