"use client";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ReportMetric({
  title,
  value,
  note,
  previous,
  onClick,
  accent,
}: {
  title: string;
  value: string;
  note: string;
  previous?: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const t = useTranslations("reporting");
  const content = (
    <>
      <span
        className={cn(
          "text-xs font-medium",
          accent ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {title}
      </span>
      <strong className="mt-3 block break-words text-xl font-semibold tabular-nums tracking-tight sm:text-2xl xl:text-[1.65rem]">
        {value}
      </strong>
      <span
        className={cn(
          "mt-2 block text-xs leading-5",
          accent ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {note}
      </span>
      {previous !== undefined && (
        <span
          className={cn(
            "mt-4 block border-t pt-2 text-xs",
            accent
              ? "border-primary-foreground/20 text-primary-foreground/80"
              : "border-border text-muted-foreground",
          )}
        >
          {t("previousValue", { value: previous })}
        </span>
      )}
    </>
  );
  const style = cn(
    "min-w-0 rounded-xl border p-4 text-left sm:p-5",
    accent
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-card-foreground",
  );
  return onClick ? (
    <button
      className={cn(
        style,
        "transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
      )}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={style}>{content}</div>
  );
}
