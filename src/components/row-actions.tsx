"use client";

import type { ComponentType } from "react";
import Link from "next/link";

import { MoreIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  const resolveVariant = (variant?: string): "primary" | "secondary" | "ghost" | "danger" => {
    if (variant === "primary" || variant === "secondary" || variant === "ghost" || variant === "danger") {
      return variant;
    }
    return "ghost";
  };

  const inlineActions = actions.slice(0, maxInline);
  const menuActions = actions.slice(maxInline);

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
          openInNewTab={Boolean(action.href && (action.openInNewTab ?? action.key === "edit"))}
          disabled={action.disabled}
        />
      ))}
      {menuActions.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span>
              <IconButton icon={MoreIcon} label={moreLabel} variant="ghost" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuActions.map((action) => {
              const item = (
                <div className="flex items-center gap-2">
                  <action.icon className="h-4 w-4" aria-hidden />
                  <span>{action.label}</span>
                </div>
              );
              const openInNewTab = Boolean(
                action.href && (action.openInNewTab ?? action.key === "edit"),
              );

              if (action.href && !action.disabled) {
                return (
                  <DropdownMenuItem key={action.key} asChild>
                    {action.href.startsWith("/api/") ? (
                      <a
                        href={action.href}
                        target={openInNewTab ? "_blank" : undefined}
                        rel={openInNewTab ? "noopener noreferrer" : undefined}
                      >
                        {item}
                      </a>
                    ) : action.href.startsWith("/") ? (
                      <Link
                        href={action.href}
                        target={openInNewTab ? "_blank" : undefined}
                        rel={openInNewTab ? "noopener noreferrer" : undefined}
                      >
                        {item}
                      </Link>
                    ) : (
                      <a
                        href={action.href}
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
                  onSelect={(event) => {
                    event.preventDefault();
                    action.onSelect?.();
                  }}
                  disabled={action.disabled}
                >
                  {item}
                </DropdownMenuItem>
              );
            })}
            {menuActions.some((action) => action.variant === "danger") ? (
              <DropdownMenuSeparator />
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};
