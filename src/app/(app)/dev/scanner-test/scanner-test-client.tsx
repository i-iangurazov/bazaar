"use client";

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { ScanInput } from "@/components/ScanInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/i18nFormat";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { shouldSubmitFromKey, type ScanResolvedResult, type ScanSubmitTrigger } from "@/lib/scanning/scanRouter";

type KeyLogItem = {
  at: Date;
  key: string;
  code: string;
};

const maxKeyLog = 40;

export const ScannerTestClient = () => {
  const t = useTranslations("scannerTest");
  const locale = useLocale();
  const [rawValue, setRawValue] = useState("");
  const [keyLog, setKeyLog] = useState<KeyLogItem[]>([]);
  const [lastResolved, setLastResolved] = useState<ScanResolvedResult | null>(null);
  const [lastTrigger, setLastTrigger] = useState<ScanSubmitTrigger | null>(null);
  const [lastTimingMs, setLastTimingMs] = useState<number | null>(null);
  const submitMetaRef = useRef<{ at: number; trigger: ScanSubmitTrigger } | null>(null);

  const normalizedValue = useMemo(() => normalizeScanValue(rawValue), [rawValue]);

  const appendKeyLog = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const logItem: KeyLogItem = {
      at: new Date(),
      key: event.key,
      code: event.code,
    };
    setKeyLog((current) => [logItem, ...current].slice(0, maxKeyLog));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    appendKeyLog(event);

    const trigger = shouldSubmitFromKey({
      key: event.key,
      supportsTabSubmit: true,
      tabSubmitMinLength: 4,
      normalizedValue,
    });

    if (!trigger) {
      return;
    }

    submitMetaRef.current = {
      at: performance.now(),
      trigger,
    };
    setLastTrigger(trigger);
  };

  const handleResolved = async (result: ScanResolvedResult): Promise<boolean> => {
    setLastResolved(result);

    const submitted = submitMetaRef.current;
    if (submitted) {
      setLastTimingMs(Math.round(performance.now() - submitted.at));
      setLastTrigger(submitted.trigger);
      submitMetaRef.current = null;
    }

    return true;
  };

  const actionLabel = useMemo(() => {
    if (!lastResolved) {
      return t("actionPending");
    }
    if (lastResolved.kind === "notFound") {
      return t("actionNotFound");
    }
    if (lastResolved.kind === "multiple") {
      return t("actionMultiple", { count: lastResolved.items.length });
    }
    if (lastResolved.item.matchType === "barcode") {
      return t("actionBarcode", { sku: lastResolved.item.sku });
    }
    if (lastResolved.item.matchType === "sku") {
      return t("actionSku", { sku: lastResolved.item.sku });
    }
    return t("actionName", { sku: lastResolved.item.sku });
  }, [lastResolved, t]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("inputTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScanInput
            context="global"
            value={rawValue}
            onValueChange={setRawValue}
            placeholder={t("placeholder")}
            ariaLabel={t("placeholder")}
            supportsTabSubmit
            tabSubmitMinLength={4}
            onKeyDown={handleKeyDown}
            onResolved={handleResolved}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{t("inputHint")}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("summaryTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {t("rawValue")}: <span className="font-mono">{rawValue || t("empty")}</span>
            </p>
            <p>
              {t("normalizedValue")}: <span className="font-mono">{normalizedValue || t("empty")}</span>
            </p>
            <p>
              {t("submitTrigger")}: {lastTrigger ? t(`trigger.${lastTrigger}`) : t("empty")}
            </p>
            <p>
              {t("resolvedAction")}: {actionLabel}
            </p>
            <p>
              {t("timingMs")}:{" "}
              {lastTimingMs === null ? t("empty") : t("timingValue", { value: lastTimingMs })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("keysTitle")}</CardTitle>
            <Button type="button" variant="secondary" onClick={() => setKeyLog([])}>
              {t("clear")}
            </Button>
          </CardHeader>
          <CardContent>
            {keyLog.length ? (
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {keyLog.map((item, index) => (
                  <div
                    key={`${item.at.toISOString()}-${index}`}
                    className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="text-muted-foreground">{formatDateTime(item.at, locale)}</span>
                    <span className="font-mono text-foreground">{item.key}</span>
                    <span className="font-mono text-muted-foreground">{item.code}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("keysEmpty")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
