import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

const FormField = <TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  name,
  ...props
}: ControllerProps<TFieldValues, TName>) => (
  <FormFieldContext.Provider value={{ name }}>
    <Controller name={name} {...props} />
  </FormFieldContext.Provider>
);

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const fallbackId = React.useId();
  const form = useFormContext();
  const fieldState =
    fieldContext && form
      ? form.getFieldState(fieldContext.name, form.formState)
      : {
          invalid: false,
          isDirty: false,
          isTouched: false,
          isValidating: false,
          error: undefined,
        };
  const id = itemContext?.id ?? fieldContext?.name ?? fallbackId;

  return {
    id,
    name: fieldContext?.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    describedByIds: itemContext?.describedByIds ?? [],
    registerDescribedById: itemContext?.registerDescribedById ?? (() => () => undefined),
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
  describedByIds: string[];
  registerDescribedById: (descriptionId: string) => () => void;
};

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

const FormItem = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => {
    const id = React.useId();
    const [describedByIds, setDescribedByIds] = React.useState<string[]>([]);
    const registerDescribedById = React.useCallback((descriptionId: string) => {
      setDescribedByIds((current) =>
        current.includes(descriptionId) ? current : [...current, descriptionId],
      );
      return () => {
        setDescribedByIds((current) => current.filter((idValue) => idValue !== descriptionId));
      };
    }, []);
    const contextValue = React.useMemo(
      () => ({ id, describedByIds, registerDescribedById }),
      [describedByIds, id, registerDescribedById],
    );

    return (
      <FormItemContext.Provider value={contextValue}>
        <div ref={ref} className={cn("space-y-1", className)} {...props} />
      </FormItemContext.Provider>
    );
  },
);

FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField();
  return (
    <Label
      ref={ref}
      className={cn(error && "text-danger", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
});

FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, describedByIds } = useFormField();
  const describedBy = describedByIds.join(" ") || undefined;
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={Boolean(error)}
      {...props}
    />
  );
});

FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<"p">>(
  ({ className, ...props }, ref) => {
    const { formDescriptionId, registerDescribedById } = useFormField();
    const hasDescription = Boolean(props.children);
    React.useEffect(() => {
      if (!hasDescription) {
        return undefined;
      }
      return registerDescribedById(formDescriptionId);
    }, [formDescriptionId, hasDescription, registerDescribedById]);

    if (!props.children) {
      return null;
    }
    return (
      <p
        ref={ref}
        id={formDescriptionId}
        className={cn("text-xs text-muted-foreground", className)}
        {...props}
      />
    );
  },
);

FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<"p">>(
  ({ className, children, role, "aria-live": ariaLive, ...props }, ref) => {
    const { error, formMessageId, registerDescribedById } = useFormField();
    const body = error ? String(error.message) : children;
    const hasMessage = Boolean(body);
    React.useEffect(() => {
      if (!hasMessage) {
        return undefined;
      }
      return registerDescribedById(formMessageId);
    }, [formMessageId, hasMessage, registerDescribedById]);

    if (!body) {
      return null;
    }

    return (
      <p
        ref={ref}
        id={formMessageId}
        role={role ?? (error ? "alert" : undefined)}
        aria-live={ariaLive ?? (error ? "assertive" : undefined)}
        className={cn("text-xs font-medium text-danger", className)}
        {...props}
      >
        {body}
      </p>
    );
  },
);

FormMessage.displayName = "FormMessage";

const Field = ({
  label,
  description,
  className,
  labelClassName,
  children,
}: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  children: React.ReactNode;
}) => (
  <FormItem className={cn("space-y-2", className)}>
    {label ? <FormLabel className={labelClassName}>{label}</FormLabel> : null}
    {children}
    {description ? <FormDescription>{description}</FormDescription> : null}
    <FormMessage />
  </FormItem>
);

export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  Field,
  useFormField,
};
