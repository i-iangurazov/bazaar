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
        if (document.activeElement === input) {
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
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
