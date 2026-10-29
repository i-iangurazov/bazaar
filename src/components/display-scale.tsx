"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export const displayScaleKey = "bazaar:display-scale";
export const displayScales = ["auto", "100", "110", "125"] as const;
export type DisplayScale = (typeof displayScales)[number];
export const parseDisplayScale = (value: string | null): DisplayScale =>
  displayScales.includes(value as DisplayScale) ? (value as DisplayScale) : "auto";

const ScaleContext = createContext<{
  scale: DisplayScale;
  setScale: (scale: DisplayScale) => void;
  sessionOnly: boolean;
} | null>(null);

export function DisplayScaleProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [scale, updateScale] = useState<DisplayScale>("auto");
  const [sessionOnly, setSessionOnly] = useState(false);
  useEffect(() => {
    try {
      updateScale(parseDisplayScale(localStorage.getItem(displayScaleKey)));
    } catch {
      setSessionOnly(true);
    }
    const sync = (event: StorageEvent) => {
      if (event.key === displayScaleKey || event.key === null)
        updateScale(parseDisplayScale(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.dataset.bazaarScale = scale;
    return () => {
      delete document.documentElement.dataset.bazaarScale;
    };
  }, [scale, enabled]);
  const setScale = (value: DisplayScale) => {
    updateScale(value);
    try {
      localStorage.setItem(displayScaleKey, value);
      setSessionOnly(false);
    } catch {
      setSessionOnly(true);
    }
  };
  return (
    <ScaleContext.Provider value={{ scale, setScale, sessionOnly }}>
      {children}
    </ScaleContext.Provider>
  );
}

export function DisplayScaleSettings() {
  const t = useTranslations("profile.display");
  const context = useContext(ScaleContext);
  const id = useId();
  if (!context) return null;
  return (
    <Card className="bazaar-admin-surface" id="display-settings">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor={id}>{t("scale")}</Label>
        <Select
          value={context.scale}
          onValueChange={(value) => context.setScale(parseDisplayScale(value))}
        >
          <SelectTrigger id={id} aria-describedby={`${id}-hint`} className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {displayScales.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "auto" ? t("automatic") : `${value}%`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${id}-hint`} className="max-w-2xl text-sm text-muted-foreground">
          {t("hint")}
        </p>
        {context.sessionOnly ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("sessionOnly")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
