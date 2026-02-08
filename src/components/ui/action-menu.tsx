"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreIcon } from "@/components/icons";

export const ActionMenu = ({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) => {
  const tCommon = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-8 px-0"
          aria-label={tCommon("actions")}
        >
          <MoreIcon className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align === "right" ? "end" : "start"}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const ActionMenuItem = ({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  className?: string;
  disabled?: boolean;
}) => {
  return (
    <DropdownMenuItem
      className={className}
      onSelect={(event) => {
        event.preventDefault();
        onSelect?.();
      }}
      disabled={disabled}
    >
      {children}
    </DropdownMenuItem>
  );
};
