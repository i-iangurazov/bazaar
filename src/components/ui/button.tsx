import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type Variant =
  | "default"
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "destructive"
  | "outline"
  | "link";
type Size = "default" | "icon" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

const variantClasses: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "border border-input bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:
    "bg-secondary/70 text-secondary-foreground hover:bg-secondary data-[state=open]:bg-secondary",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  outline: "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
  link: "h-auto rounded-none px-0 text-primary underline-offset-4 hover:underline shadow-none",
};

const sizeClasses: Record<Size, string> = {
  default: "h-10 px-4",
  icon: "h-10 w-10 p-0 shadow-none",
  sm: "h-9 px-3.5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "default", className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const title =
      size === "icon" && !props.title && props["aria-label"]
        ? props["aria-label"]
        : props.title;
    return (
      <Comp
        ref={ref}
        className={cn(
          "button-focus-ring inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        title={title}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
