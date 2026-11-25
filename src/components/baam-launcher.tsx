"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ExternalLinkIcon as ArrowUpRight } from "@/components/icons";
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
import { mobileShellMediaQuery, phoneWorkspaceMediaQuery } from "@/hooks/useIsMobile";
import { isIOS } from "@/lib/native/platform";
import { baamPathname, baamWorkspaceHref } from "@/lib/baam/workspaceNavigation";

export const canShowBaamLauncher = (access: RoleAccess, pathname: string) => {
  const path = baamPathname(pathname);
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
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [phoneWorkspace, setPhoneWorkspace] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname, phoneWorkspace]);
  useEffect(() => {
    if (!mounted) return;
    const mobileShell = window.matchMedia?.(mobileShellMediaQuery);
    const phone = window.matchMedia?.(phoneWorkspaceMediaQuery);
    const measure = () => {
      const mobile = mobileShell?.matches ?? window.innerWidth < 768;
      setPhoneWorkspace(phone?.matches ?? mobile);
      setHeaderSlot(
        document.querySelector<HTMLElement>(
          mobile ? "[data-baam-mobile-slot]" : "[data-baam-desktop-slot]",
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    phone?.addEventListener("change", measure);
    return () => {
      window.removeEventListener("resize", measure);
      phone?.removeEventListener("change", measure);
    };
  }, [mounted, pathname]);
  if (!mounted || !headerSlot || !canShowBaamLauncher(access, pathname)) return null;
  const inWorkspace = baamPathname(pathname) === "/baam";
  const launcher = (
    <Button
      type="button"
      data-baam-launcher
      data-baam-docked="header"
      aria-label={baamCopy(locale, "open")}
      title={baamCopy(locale, "open")}
      className="h-11 w-11 shrink-0 gap-1.5 p-0 md:h-9 md:w-full md:px-0 lg:px-3"
      onClick={(event) => {
        if (inWorkspace) {
          const input = document.querySelector<HTMLTextAreaElement>(
            "[data-baam-input]:not(:disabled)",
          );
          const target = input ?? document.querySelector<HTMLElement>("[data-baam-workspace]");
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: "nearest" });
        } else if (phoneWorkspace || isIOS()) {
          // Cancel the dialog trigger if the native bridge became ready after rendering.
          event.preventDefault();
          router.push(baamWorkspaceHref(window.location));
        }
      }}
    >
      <BaamIcon className="h-6 w-6 shrink-0 md:h-[18px] md:w-[18px]" />
      <span className="hidden text-sm font-medium lg:inline">
        {baamCopy(locale, "name")}
      </span>
    </Button>
  );
  if (inWorkspace || phoneWorkspace || isIOS()) return createPortal(launcher, headerSlot);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {createPortal(<DialogTrigger asChild>{launcher}</DialogTrigger>, headerSlot)}
      <DialogContent
        data-baam-drawer
        className="bottom-4 left-auto right-4 top-auto h-[min(48rem,calc(100dvh-2rem))] w-full translate-x-0 translate-y-0 rounded-lg sm:max-w-[29rem]"
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
