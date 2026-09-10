"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type SetStateAction } from "react";
import { useScopedLocalStorageState } from "./useScopedLocalStorageState";

export type ListUrlField = { key: string; param: string; aliases?: string[]; preference?: boolean };
const eventName = "bazaar:list-state";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(eventName, listener);
  };
};
const snapshot = () => window.location.search;
const serverSnapshot = () => "";
const getField = (value: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((item, part) => (item as Record<string, unknown>)?.[part], value);
const putField = <T>(value: T, key: string, next: unknown): T => {
  const [head, tail] = key.split(".");
  return { ...value, [head]: tail ? { ...(getField(value, head) as object), [tail]: next } : next };
};
export const hasListUrl = (params: URLSearchParams, fields: readonly ListUrlField[]) =>
  params.has("list") ||
  fields.some((field) => [field.param, ...(field.aliases ?? [])].some((key) => params.has(key)));

/** A deep link starts a new filter scope, retaining only display preferences. */
export function readListUrl<T>(
  params: URLSearchParams,
  stored: T,
  defaults: T,
  fields: readonly ListUrlField[],
  parse: (raw: string) => T | null,
): T {
  if (!hasListUrl(params, fields)) return stored;
  let value = stored;
  for (const field of fields) {
    if (!field.preference) value = putField(value, field.key, getField(defaults, field.key));
  }
  for (const field of fields) {
    const param = [field.param, ...(field.aliases ?? [])].find((key) => params.has(key));
    if (!param) continue;
    const raw = params.get(param)!;
    const defaultValue = getField(defaults, field.key);
    const decoded =
      typeof defaultValue === "number"
        ? Number(raw)
        : typeof defaultValue === "boolean"
          ? raw === "true" || raw === "1"
          : raw;
    const candidate = parse(JSON.stringify(putField(value, field.key, decoded)));
    if (candidate) value = candidate;
  }
  return value;
}

export function writeListUrl<T>(
  params: URLSearchParams,
  value: T,
  fields: readonly ListUrlField[],
) {
  const next = new URLSearchParams(params);
  next.set("list", "1");
  for (const field of fields) {
    for (const alias of field.aliases ?? []) next.delete(alias);
    next.set(field.param, String(getField(value, field.key) ?? ""));
  }
  return next;
}

/** Native history preserves list state on refresh/back without a server navigation per keystroke. */
export function useScopedListState<T>(options: {
  pathname: string;
  storageKey: string | null;
  defaultValue: T;
  parse: (raw: string) => T | null;
  fields: readonly ListUrlField[];
}) {
  const stored = useScopedLocalStorageState(options);
  const { isReady, setValue: setStoredValue } = stored;
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Next can mount the destination before committing window.location. The list
  // owns its declared route, never the previous page observed during that render.
  const ownsRoute = typeof window !== "undefined" && options.pathname === window.location.pathname;
  const scope = useRef(options.storageKey);
  const scopeChanged = scope.current !== null && scope.current !== options.storageKey;
  const params = new URLSearchParams(scopeChanged || !ownsRoute ? "" : search);
  const explicit = hasListUrl(params, options.fields);
  const value = readListUrl(
    params,
    isReady ? stored.value : options.defaultValue,
    options.defaultValue,
    options.fields,
    options.parse,
  );
  const current = useRef({ ...options, value });
  current.current = { ...options, value };
  const replace = useCallback((params: URLSearchParams) => {
    const query = params.toString();
    const href = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", href);
    window.dispatchEvent(new Event(eventName));
  }, []);
  const serialized = JSON.stringify(value);
  const storedSerialized = JSON.stringify(stored.value);
  useEffect(() => {
    if (!isReady || !options.storageKey || !ownsRoute) return;
    const config = current.current;
    const previousScope = scope.current;
    scope.current = options.storageKey;
    const params = new URLSearchParams(window.location.search);
    if (previousScope !== null && previousScope !== options.storageKey) {
      params.delete("list");
      for (const field of config.fields) {
        params.delete(field.param);
        for (const alias of field.aliases ?? []) params.delete(alias);
      }
    }
    const next = writeListUrl(params, config.value, config.fields);
    if (next.toString() !== params.toString() || previousScope !== options.storageKey)
      replace(next);
    if (serialized !== storedSerialized) setStoredValue(config.value);
  }, [
    options.storageKey,
    ownsRoute,
    isReady,
    setStoredValue,
    serialized,
    storedSerialized,
    search,
    replace,
  ]);
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      const config = current.current;
      if (
        !isReady ||
        !options.storageKey ||
        config.storageKey !== options.storageKey ||
        options.pathname !== window.location.pathname
      )
        return;
      const value = typeof next === "function" ? (next as (value: T) => T)(config.value) : next;
      if (!config.parse(JSON.stringify(value))) return;
      current.current = { ...config, value };
      setStoredValue(value);
      replace(writeListUrl(new URLSearchParams(window.location.search), value, config.fields));
    },
    [options.pathname, options.storageKey, isReady, setStoredValue, replace],
  );
  return {
    ...stored,
    isReady: isReady && ownsRoute,
    value,
    setValue,
    hasStoredValue: stored.hasStoredValue || explicit,
  };
}

export const commonListFields: readonly ListUrlField[] = [
  { key: "storeId", param: "storeId" },
  { key: "search", param: "q", aliases: ["query", "search"] },
  { key: "page", param: "page" },
  { key: "pageSize", param: "pageSize", preference: true },
  { key: "sort.key", param: "sortBy", preference: true },
  { key: "sort.direction", param: "sortDirection", preference: true },
  { key: "viewMode", param: "view", preference: true },
];
