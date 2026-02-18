import type { ComponentProps, ComponentType } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  openInNewTab?: boolean;
};

export const IconButton = ({
  icon: Icon,
  label,
  href,
  openInNewTab,
  className,
  ...props
}: IconButtonProps) => {
  const content = <Icon className="h-4 w-4" aria-hidden />;
  const canLink = Boolean(href) && !props.disabled;
  const isInternalLink = Boolean(href?.startsWith("/"));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          asChild={canLink}
          size="icon"
          aria-label={label}
          className={cn("h-8 w-8", className)}
        >
          {canLink ? (
            isInternalLink ? (
              <Link
                href={href!}
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
