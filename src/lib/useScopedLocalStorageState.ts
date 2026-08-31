"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export const buildScopedStorageKey = ({
  prefix,
  organizationId,
  userId,
}: {
  prefix: string;
  organizationId?: string | null;
  userId?: string | null;
}) => {
  if (!organizationId || !userId) {
    return null;
  }
  return `${prefix}:${organizationId}:${userId}`;
};

export const useScopedLocalStorageState = <T>({
  storageKey,
  defaultValue,
  parse,
  serialize = JSON.stringify,
}: {
  storageKey: string | null;
  defaultValue: T;
  parse: (raw: string) => T | null;
  serialize?: (value: T) => string;
}): {
  value: T;
  setValue: Dispatch<SetStateAction<T>>;
  isReady: boolean;
  hasStoredValue: boolean;
} => {
  const [value, setValueState] = useState<T>(defaultValue);
  const [isReady, setIsReady] = useState(false);
  const [hasStoredValue, setHasStoredValue] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const defaultValueRef = useRef(defaultValue);
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);
  const previousStorageKeyRef = useRef<string | null | undefined>(undefined);
  const hasPendingLocalChangeRef = useRef(false);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    hasPendingLocalChangeRef.current = true;
    setValueState(nextValue);
  }, []);

  useEffect(() => {
    defaultValueRef.current = defaultValue;
  }, [defaultValue]);

  useEffect(() => {
    parseRef.current = parse;
  }, [parse]);

  useEffect(() => {
    serializeRef.current = serialize;
  }, [serialize]);

  useEffect(() => {
    if (!storageKey) {
      setValueState(defaultValueRef.current);
      setIsReady(true);
      setHasStoredValue(false);
      setHydratedStorageKey(null);
      previousStorageKeyRef.current = null;
      hasPendingLocalChangeRef.current = false;
      return;
    }

    let nextValue = defaultValueRef.current;
    let nextHasStoredValue = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        nextValue = parseRef.current(raw) ?? defaultValueRef.current;
        nextHasStoredValue = true;
      }
    } catch {
      nextValue = defaultValueRef.current;
      nextHasStoredValue = false;
    }

    const preservePendingUnscopedChange =
      previousStorageKeyRef.current === null && hasPendingLocalChangeRef.current;
    if (!preservePendingUnscopedChange) {
      setValueState(nextValue);
    }
    setHasStoredValue(preservePendingUnscopedChange ? false : nextHasStoredValue);
    setIsReady(true);
    setHydratedStorageKey(storageKey);
    previousStorageKeyRef.current = storageKey;
    hasPendingLocalChangeRef.current = false;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !isReady || hydratedStorageKey !== storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, serializeRef.current(value));
      hasPendingLocalChangeRef.current = false;
    } catch {
      // ignore storage errors
    }
  }, [hydratedStorageKey, isReady, storageKey, value]);

  const isResolvedScopeReady = isReady && (!storageKey || hydratedStorageKey === storageKey);

  return { value, setValue, isReady: isResolvedScopeReady, hasStoredValue };
};
