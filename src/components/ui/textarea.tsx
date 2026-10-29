import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentProps<"textarea">;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[88px] w-full rounded-[var(--radius)] border border-transparent bg-secondary px-2.5 py-2 text-base text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:bg-accent focus:border-primary focus:bg-card focus:outline-none focus:shadow-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger sm:text-sm",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
