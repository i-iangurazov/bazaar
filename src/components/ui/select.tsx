"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";

import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";

type SelectControlAttributes = Pick<
  React.HTMLAttributes<HTMLButtonElement>,
  "id" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid" | "aria-required"
>;
const SelectControlContext = React.createContext<{
  attributes: SelectControlAttributes;
  controlRef: React.ForwardedRef<HTMLButtonElement>;
}>({ attributes: {}, controlRef: null });
// FormControl is also used around Select.Root throughout the app. Radix Root has
// no DOM element: forward its label, validation and focus target to the trigger.
const Select = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> & SelectControlAttributes
>(
  (
    {
      id,
      "aria-label": label,
      "aria-labelledby": labelledBy,
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
      "aria-required": required,
      ...props
    },
    ref,
  ) => (
    <SelectControlContext.Provider
      value={{
        attributes: {
          id,
          "aria-label": label,
          "aria-labelledby": labelledBy,
          "aria-describedby": describedBy,
          "aria-invalid": invalid,
          "aria-required": required,
        },
        controlRef: ref,
      }}
    >
      <SelectPrimitive.Root {...props} />
    </SelectControlContext.Provider>
  ),
);
Select.displayName = "Select";

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const { attributes, controlRef } = React.useContext(SelectControlContext);
  const mergedRef = React.useCallback(
    (element: HTMLButtonElement | null) => {
      for (const target of [ref, controlRef]) {
        if (typeof target === "function") target(element);
        else if (target) target.current = element;
      }
    },
    [ref, controlRef],
  );
  return (
    <SelectPrimitive.Trigger
      ref={mergedRef}
      {...attributes}
      className={cn(
        "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-base text-foreground transition-colors hover:border-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
  (
    { className, children, position = "popper", sideOffset = 6, align = "start", ...props },
    ref,
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "z-[1100] w-[var(--radix-select-trigger-width)] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
          position === "popper" && "translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
          <ChevronDownIcon className="h-4 w-4 rotate-180" aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="max-h-[min(20rem,var(--radix-select-content-available-height,20rem))] overflow-y-auto p-1">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
          <ChevronDownIcon className="h-4 w-4" aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);

SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
));

SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <CheckIcon className="h-3 w-3 text-foreground" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));

SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-border", className)}
    {...props}
  />
));

SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
