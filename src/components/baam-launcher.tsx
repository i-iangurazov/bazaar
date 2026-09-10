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
import { launcherBottom } from "@/lib/baam/launcher-position";
import { cn } from "@/lib/utils";

export const canShowBaamLauncher = (access: RoleAccess, pathname: string) =>
  hasPermission(access, "viewReports") && !pathname.startsWith("/printing/");

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
  const [bottom, setBottom] = useState(24);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);
  const [viewport, setViewport] = useState<{ height: number; top: number }>();
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!mounted) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setMobileSlot(
        innerWidth < 768 ? document.querySelector<HTMLElement>("[data-baam-mobile-slot]") : null,
      );
      const obstacles = [...document.querySelectorAll<HTMLElement>("[data-baam-obstacle]")].map(
        (el) => {
          const box = el.getBoundingClientRect();
          return {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            fixed: getComputedStyle(el).position === "fixed",
            action: el.dataset.baamObstacle === "action",
          };
        },
      );
      setBottom(launcherBottom(innerWidth, innerHeight, obstacles));
      const visual = window.visualViewport;
      setViewport(visual ? { height: visual.height, top: visual.offsetTop } : undefined);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    document.querySelectorAll("[data-baam-obstacle]").forEach((el) => observer.observe(el));
    observer.observe(document.body);
    mutation.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      observer.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [mounted, pathname]);
  if (!mounted || !canShowBaamLauncher(access, pathname)) return null;
  const launcher = (
    <button
      type="button"
      data-baam-launcher
      data-baam-docked={mobileSlot ? "header" : undefined}
      aria-label={baamCopy(locale, "open")}
      style={
        mobileSlot ? undefined : { bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }
      }
      className={cn(
        "button-focus-ring z-40 flex items-center justify-center gap-2 border border-primary-foreground/15 bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 [body:has([role=alertdialog][data-state=open])_&]:invisible [body:has([role=dialog][data-state=open])_&]:invisible",
        mobileSlot
          ? "h-11 w-11 rounded-xl p-1"
          : "fixed right-[max(1rem,env(safe-area-inset-right,0px))] h-12 rounded-2xl px-3 shadow-lg shadow-black/15 md:right-6",
      )}
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
      <BaamIcon className="h-8 w-8" />
      <span className={mobileSlot ? "sr-only" : "text-xs font-bold tracking-[0.06em]"}>
        {baamCopy(locale, "name")}
      </span>
    </button>
  );
  if (pathname === "/baam") return createPortal(launcher, mobileSlot ?? document.body);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {createPortal(<DialogTrigger asChild>{launcher}</DialogTrigger>, mobileSlot ?? document.body)}
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
