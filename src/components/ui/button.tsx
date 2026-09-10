import type { ButtonHTMLAttributes } from "react";
import React from "react";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

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

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    variant?: Variant;
    size?: Size;
    asChild?: boolean;
  };

export const buttonVariants = cva(
  "button-focus-ring inline-flex max-w-full items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "border border-input bg-card text-foreground hover:border-muted-foreground/50 hover:bg-muted",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground",
        danger: "bg-danger text-danger-foreground hover:bg-danger/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "h-auto rounded-md px-0 text-primary shadow-none hover:text-primary/80",
      },
      size: {
        default: "h-10 px-4",
        icon: "h-10 w-10 shrink-0 p-0 shadow-none",
        sm: "h-9 px-3.5 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonPropsWithoutVariantCollision = Omit<ButtonProps, "variant" | "size"> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonPropsWithoutVariantCollision>(
  ({ variant = "primary", size = "default", className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const title =
      size === "icon" && !props.title && props["aria-label"] ? props["aria-label"] : props.title;
    return (
      <Comp
        ref={ref}
        data-baam-obstacle={props.type === "submit" ? "action" : undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        title={title}
        {...props}
        {...(asChild && props.disabled
          ? {
              "aria-disabled": true,
              tabIndex: -1,
              onClickCapture: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
              },
              onAuxClickCapture: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
              },
              onKeyDownCapture: (event: React.KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                }
              },
            }
          : {})}
      />
    );
  },
);

Button.displayName = "Button";
