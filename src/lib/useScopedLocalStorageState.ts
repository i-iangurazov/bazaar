"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

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
  const [value, setValue] = useState<T>(defaultValue);
  const [isReady, setIsReady] = useState(false);
  const [hasStoredValue, setHasStoredValue] = useState(false);
  const defaultValueRef = useRef(defaultValue);
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);

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
      setValue(defaultValueRef.current);
      setIsReady(true);
      setHasStoredValue(false);
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

    setValue(nextValue);
    setHasStoredValue(nextHasStoredValue);
    setIsReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !isReady) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, serializeRef.current(value));
    } catch {
      // ignore storage errors
    }
  }, [isReady, storageKey, value]);

  return { value, setValue, isReady, hasStoredValue };
};
