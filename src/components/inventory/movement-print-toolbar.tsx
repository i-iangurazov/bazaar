"use client";

import { useEffect } from "react";
import Link from "next/link";

import { BackIcon, PrintIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

type MovementPrintToolbarProps = {
  autoPrint: boolean;
  backHref: string;
  labels: {
    backToDetails: string;
    printDocument: string;
    printHint: string;
  };
};

export const MovementPrintToolbar = ({
  autoPrint,
  backHref,
  labels,
}: MovementPrintToolbarProps) => {
  useEffect(() => {
    document.title = labels.printDocument;

    if (!autoPrint) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [autoPrint, labels.printDocument]);

  return (
    <div
      className="movement-print-chrome sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur print:hidden"
      aria-hidden="false"
      data-print-exclude="true"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{labels.printHint}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={backHref}>
              <BackIcon className="h-4 w-4" aria-hidden />
              {labels.backToDetails}
            </Link>
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <PrintIcon className="h-4 w-4" aria-hidden />
            {labels.printDocument}
          </Button>
        </div>
      </div>
    </div>
  );
};
