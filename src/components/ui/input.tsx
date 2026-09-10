import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.ComponentProps<"input">;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const isNumberInput = type === "number";

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useEffect(() => {
      const input = inputRef.current;
      if (!input || !isNumberInput) {
        return;
      }

      const preventWheelStep = (event: WheelEvent) => {
        if (document.activeElement === input && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
        }
      };

      input.addEventListener("wheel", preventWheelStep, { passive: false });
      return () => input.removeEventListener("wheel", preventWheelStep);
    }, [isNumberInput]);

    return (
      <input
        ref={inputRef}
        type={type}
        className={cn(
          "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:border-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
