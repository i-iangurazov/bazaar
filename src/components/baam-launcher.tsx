"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowUpRight } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { hasPermission, type RoleAccess } from "@/lib/roleAccess";
import { baamCopy } from "@/lib/baam/copy";
import { BaamIcon } from "@/components/icons";
import { Button } from "./ui/button";
import { normalizeLocale } from "@/lib/locales";

export const canShowBaamLauncher = (access: RoleAccess, pathname: string) => {
  const segments = pathname.split(/[?#]/, 1)[0].split("/");
  if (normalizeLocale(segments[1])) segments.splice(1, 1);
  const path = segments.join("/").replace(/\/+$/, "") || "/";
  return (
    hasPermission(access, "viewReports") && path !== "/pos/sell" && !path.startsWith("/printing/")
  );
};

export function BaamLauncher({
  access,
  pathname,
  children,
}: {
  access: RoleAccess;
  pathname: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [viewport, setViewport] = useState<{ height: number; top: number }>();
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!mounted) return;
    const measure = () => {
      setHeaderSlot(
        document.querySelector<HTMLElement>(
          innerWidth < 768 ? "[data-baam-mobile-slot]" : "[data-baam-desktop-slot]",
        ),
      );
      const visual = window.visualViewport;
      setViewport(visual ? { height: visual.height, top: visual.offsetTop } : undefined);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [mounted, pathname]);
  if (!mounted || !headerSlot || !canShowBaamLauncher(access, pathname)) return null;
  const launcher = (
    <Button
      type="button"
      data-baam-launcher
      data-baam-docked="header"
      aria-label={baamCopy(locale, "open")}
      className="h-11 w-11 shrink-0 gap-2 rounded-lg p-0 md:h-10 md:w-full md:px-3"
      onClick={
        pathname === "/baam"
          ? () => {
              const input = document.querySelector<HTMLTextAreaElement>(
                "[data-baam-input]:not(:disabled)",
              );
              const target = input ?? document.querySelector<HTMLElement>("[data-baam-workspace]");
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "nearest" });
            }
          : undefined
      }
    >
      <BaamIcon className="h-6 w-6 shrink-0" />
      <span className="hidden text-xs font-bold tracking-wide md:inline">
        {baamCopy(locale, "name")}
      </span>
    </Button>
  );
  if (pathname === "/baam") return createPortal(launcher, headerSlot);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {createPortal(<DialogTrigger asChild>{launcher}</DialogTrigger>, headerSlot)}
      <DialogContent
        data-baam-drawer
        style={
          viewport && typeof window !== "undefined" && window.innerWidth < 640
            ? { height: viewport.height, maxHeight: viewport.height, top: viewport.top }
            : undefined
        }
        className="bottom-0 left-0 right-0 top-auto h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none pb-[env(safe-area-inset-bottom,0px)] sm:bottom-4 sm:left-auto sm:right-4 sm:h-[min(48rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[29rem] sm:rounded-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>("[data-baam-drawer] [data-baam-input]")
              ?.focus({ preventScroll: true }),
          );
        }}
      >
        <DialogHeader className="py-3">
          <DialogTitle className="flex items-center gap-2">
            <BaamIcon className="h-8 w-8 text-primary" />
            <span>{baamCopy(locale, "name")}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">{baamCopy(locale, "subtitle")}</DialogDescription>
          <Link
            href="/baam"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="button-focus-ring inline-flex min-h-7 items-center gap-1 rounded text-xs text-muted-foreground hover:text-primary"
          >
            {baamCopy(locale, "workspace")}
            <ArrowUpRight size={13} />
          </Link>
        </DialogHeader>
        <div className="min-h-0 flex-1">{open ? children : null}</div>
      </DialogContent>
    </Dialog>
  );
}
