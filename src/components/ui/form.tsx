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
    descriptionId: itemContext?.descriptionId,
    messageId: itemContext?.messageId,
    setDescriptionId: itemContext?.setDescriptionId,
    setMessageId: itemContext?.setMessageId,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
  descriptionId?: string;
  messageId?: string;
  setDescriptionId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
};

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

const FormItem = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => {
    const id = React.useId();
    const [descriptionId, setDescriptionId] = React.useState<string>();
    const [messageId, setMessageId] = React.useState<string>();
    return (
      <FormItemContext.Provider
        value={{ id, descriptionId, messageId, setDescriptionId, setMessageId }}
      >
        <div ref={ref} className={cn("space-y-1", className)} {...props} />
      </FormItemContext.Provider>
    );
  },
);

FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => {
  const { error, formItemId } = useFormField();
  return (
    <Label
      ref={ref}
      className={cn(error && "text-danger", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden className="ml-1 text-danger">
          *
        </span>
      ) : null}
    </Label>
  );
});

FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, descriptionId, messageId } = useFormField();
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={[descriptionId, messageId].filter(Boolean).join(" ") || undefined}
      aria-invalid={Boolean(error)}
      {...props}
    />
  );
});

FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<"p">>(
  ({ className, ...props }, ref) => {
    const { formDescriptionId, setDescriptionId } = useFormField();
    const id = props.id ?? formDescriptionId;
    const hasContent = Boolean(props.children);
    React.useEffect(() => {
      setDescriptionId?.(hasContent ? id : undefined);
      return () => setDescriptionId?.(undefined);
    }, [hasContent, id, setDescriptionId]);
    if (!hasContent) {
      return null;
    }
    return (
      <p ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} id={id} />
    );
  },
);

FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<"p">>(
  ({ className, children, ...props }, ref) => {
    const { error, formMessageId, setMessageId } = useFormField();
    const body = error ? String(error.message) : children;
    const id = props.id ?? formMessageId;
    const hasContent = Boolean(body);
    React.useEffect(() => {
      setMessageId?.(hasContent ? id : undefined);
      return () => setMessageId?.(undefined);
    }, [hasContent, id, setMessageId]);
    if (!body) {
      return null;
    }

    return (
      <p ref={ref} className={cn("text-xs font-medium text-danger", className)} {...props} id={id}>
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
