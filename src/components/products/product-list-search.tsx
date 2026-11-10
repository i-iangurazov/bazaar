"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";

import { ListSearch } from "@/components/list-toolbar";

/** Keep keystrokes local: table, URL and network updates follow a committed search. */
export function ProductListSearch({
  value,
  onChange,
  scopeKey,
  disabled,
  ...props
}: ComponentProps<typeof ListSearch> & { scopeKey: string }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const committed = useRef(value);
  const scope = useRef(scopeKey);
  const latest = useRef({ onChange, disabled, scopeKey });
  latest.current = { onChange, disabled, scopeKey };
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const commit = useCallback((next: string, expectedScope?: string) => {
    clearTimeout(timer.current);
    if (
      latest.current.disabled ||
      (expectedScope !== undefined && expectedScope !== latest.current.scopeKey) ||
      next === committed.current
    )
      return;
    committed.current = next;
    latest.current.onChange(next);
  }, []);
  useEffect(() => {
    if (scope.current !== scopeKey || value !== committed.current || disabled) {
      cancel();
      scope.current = scopeKey;
      committed.current = value;
      setDraft(value);
      composing.current = false;
    }
  }, [value, scopeKey, disabled, cancel]);
  useEffect(() => cancel, [cancel]);
  const change = (next: string) => {
    setDraft(next);
    cancel();
    if (composing.current) return;
    if (!next) commit("");
    else timer.current = setTimeout(() => commit(next, scopeKey), 250);
  };
  return (
    <ListSearch
      {...props}
      value={draft}
      disabled={disabled}
      onChange={change}
      onScan={(next) => {
        setDraft(next);
        commit(next);
      }}
      onBlur={() => {
        if (!composing.current) commit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !composing.current && !event.nativeEvent.isComposing) {
          event.preventDefault();
          commit(event.currentTarget.value);
        }
      }}
      onCompositionStart={() => {
        composing.current = true;
        cancel();
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        change(event.currentTarget.value);
      }}
    />
  );
}
