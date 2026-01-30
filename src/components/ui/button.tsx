import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "default" | "icon" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

const variantClasses: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-gray-800",
  secondary: "bg-white text-ink border border-gray-200 hover:bg-gray-50",
  ghost: "bg-transparent text-ink hover:bg-gray-100 data-[state=open]:bg-gray-100",
  danger: "bg-danger text-white hover:bg-red-500",
};

const sizeClasses: Record<Size, string> = {
  default: "h-10 px-4",
  icon: "h-10 w-10 p-0 shadow-none",
  sm: "h-8 px-3 text-xs",
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
        "button-focus-ring inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50",
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
