"use client";

import React, { useRef, useState, type ComponentType } from "react";
import Link from "next/link";

import { MoreIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type RowAction = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect?: () => void;
  href?: string;
  openInNewTab?: boolean;
  disabled?: boolean;
  variant?: string;
};

type RowActionsProps = {
  actions: RowAction[];
  maxInline?: number;
  moreLabel: string;
  className?: string;
};

export const RowActions = ({ actions, maxInline = 2, moreLabel, className }: RowActionsProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const runAfterMenuClose = (action?: () => void) => {
    if (!action) return;
    pendingActionRef.current = action;
  };

  const resolveVariant = (variant?: string): "primary" | "secondary" | "ghost" | "danger" => {
    if (
      variant === "primary" ||
      variant === "secondary" ||
      variant === "ghost" ||
      variant === "danger"
    ) {
      return variant;
    }
    return "ghost";
  };

  const inlineActions = actions.slice(0, maxInline);
  const menuActions = actions.slice(maxInline);

  const renderMenuAction = (action: RowAction) => {
    const item = (
      <div className="flex items-center gap-2">
        <action.icon className="h-4 w-4" aria-hidden />
        <span>{action.label}</span>
      </div>
    );
    const openInNewTab = Boolean(action.href && action.openInNewTab);

    if (action.href && !action.disabled) {
      return (
        <DropdownMenuItem key={action.key} asChild>
          {action.href.startsWith("/api/") ? (
            <a
              href={action.href}
              onClick={action.onSelect}
              target={openInNewTab ? "_blank" : undefined}
              rel={openInNewTab ? "noopener noreferrer" : undefined}
            >
              {item}
            </a>
          ) : action.href.startsWith("/") ? (
            <Link
              href={action.href}
              onClick={action.onSelect}
              target={openInNewTab ? "_blank" : undefined}
              rel={openInNewTab ? "noopener noreferrer" : undefined}
            >
              {item}
            </Link>
          ) : (
            <a
              href={action.href}
              onClick={action.onSelect}
              target={openInNewTab ? "_blank" : undefined}
              rel={openInNewTab ? "noopener noreferrer" : undefined}
            >
              {item}
            </a>
          )}
        </DropdownMenuItem>
      );
    }

    return (
      <DropdownMenuItem
        key={action.key}
        onSelect={() => runAfterMenuClose(action.onSelect)}
        disabled={action.disabled}
      >
        {item}
      </DropdownMenuItem>
    );
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {inlineActions.map((action) => (
        <IconButton
          key={action.key}
          icon={action.icon}
          label={action.label}
          variant={resolveVariant(action.variant)}
          onClick={action.onSelect}
          href={action.href}
          openInNewTab={Boolean(action.href && action.openInNewTab)}
          disabled={action.disabled}
        />
      ))}
      {menuActions.length ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuTriggerRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={moreLabel}
                  className="h-10 w-10 md:h-8 md:w-8"
                >
                  <MoreIcon className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{moreLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              const action = pendingActionRef.current;
              if (!action) return;
              event.preventDefault();
              pendingActionRef.current = null;
              menuTriggerRef.current?.focus();
              queueMicrotask(action);
            }}
          >
            {menuActions.map(renderMenuAction)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};
