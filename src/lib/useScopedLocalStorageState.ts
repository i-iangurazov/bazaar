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
  const [state, setState] = useState({
    key: storageKey,
    value: defaultValue,
    ready: false,
    hasStoredValue: false,
  });
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
      setState({
        key: storageKey,
        value: defaultValueRef.current,
        ready: true,
        hasStoredValue: false,
      });
      return;
    }

    let nextValue = defaultValueRef.current;
    let nextHasStoredValue = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = parseRef.current(raw);
        nextValue = parsed ?? defaultValueRef.current;
        nextHasStoredValue = parsed !== null;
      }
    } catch {
      nextValue = defaultValueRef.current;
      nextHasStoredValue = false;
    }

    setState({
      key: storageKey,
      value: nextValue,
      ready: true,
      hasStoredValue: nextHasStoredValue,
    });
  }, [storageKey]);

  useEffect(() => {
    // During a user/organization change, the previous render still holds the old
    // value. Never write it into the newly selected scope before hydration.
    if (!storageKey || !state.ready || state.key !== storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, serializeRef.current(state.value));
    } catch {
      // ignore storage errors
    }
  }, [storageKey, state]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setState((current) => {
        // A delayed response from a previous organization must not update this one.
        if (current.key !== storageKey) return current;
        const value =
          typeof next === "function" ? (next as (previous: T) => T)(current.value) : next;
        return Object.is(value, current.value) ? current : { ...current, value };
      });
    },
    [storageKey],
  );

  const ownsState = state.key === storageKey;
  return {
    value: ownsState ? state.value : defaultValue,
    setValue,
    isReady: ownsState && state.ready,
    hasStoredValue: ownsState && state.hasStoredValue,
  };
};
