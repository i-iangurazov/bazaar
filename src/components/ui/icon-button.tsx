import React, { type ComponentProps, type ComponentType } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  openInNewTab?: boolean;
  loading?: boolean;
};

export const IconButton = ({
  icon: Icon,
  label,
  href,
  openInNewTab,
  loading = false,
  className,
  ...props
}: IconButtonProps) => {
  const content = loading ? (
    <Spinner className="h-4 w-4" />
  ) : (
    <Icon className="h-4 w-4" aria-hidden />
  );
  const canLink = Boolean(href) && !props.disabled;
  const isInternalLink = Boolean(href?.startsWith("/") && !href.startsWith("/api/"));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          asChild={canLink}
          size="icon"
          aria-label={label}
          aria-busy={loading || undefined}
          className={cn("h-10 w-10 md:h-8 md:w-8", className)}
        >
          {canLink ? (
            isInternalLink ? (
              <Link
                href={href!}
                prefetch={false}
                aria-label={label}
                target={openInNewTab ? "_blank" : undefined}
                rel={openInNewTab ? "noopener noreferrer" : undefined}
              >
                {content}
              </Link>
            ) : (
              <a
                href={href}
                aria-label={label}
                target={openInNewTab ? "_blank" : undefined}
                rel={openInNewTab ? "noopener noreferrer" : undefined}
              >
                {content}
              </a>
            )
          ) : (
            content
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
