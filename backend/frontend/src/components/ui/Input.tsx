"use client";

import { forwardRef, useId } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** Validation state shared by every form control. */
export type FieldState = "default" | "error" | "success";

const STATE_RING: Record<FieldState, string> = {
  default:
    "border-slate-300 focus:border-brand-500 dark:border-slate-700 dark:focus:border-brand-500",
  error: "border-red-400 focus:border-red-500 dark:border-red-500/60",
  success: "border-emerald-400 focus:border-emerald-500 dark:border-emerald-500/60",
};

export const fieldBase = cn(
  "w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900",
  "placeholder:text-slate-400 transition-colors",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
  "dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800",
);

interface FieldWrapperProps {
  label?: string;
  hint?: string;
  error?: string;
  success?: string;
  required?: boolean;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Label, hint and validation message around any control.
 *
 * Messages are wired with `aria-describedby` by the callers below, so assistive
 * technology reads the error together with the field rather than separately.
 */
export function FieldWrapper({
  label,
  hint,
  error,
  success,
  required,
  htmlFor,
  children,
  className,
}: FieldWrapperProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p
          id={`${htmlFor}-message`}
          role="alert"
          className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : success ? (
        <p
          id={`${htmlFor}-message`}
          className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
          {success}
        </p>
      ) : hint ? (
        <p
          id={`${htmlFor}-message`}
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  success?: string;
  /** Icon rendered inside the field, on the leading edge. */
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, success, icon, id, required, ...props }, ref) => {
    const generated = useId();
    const fieldId = id || generated;
    const state: FieldState = error ? "error" : success ? "success" : "default";

    return (
      <FieldWrapper
        label={label}
        hint={hint}
        error={error}
        success={success}
        required={required}
        htmlFor={fieldId}
      >
        <div className="relative">
          {icon && (
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={fieldId}
            required={required}
            aria-invalid={state === "error" || undefined}
            aria-describedby={error || success || hint ? `${fieldId}-message` : undefined}
            className={cn(fieldBase, STATE_RING[state], icon && "pl-9", className)}
            {...props}
          />
        </div>
      </FieldWrapper>
    );
  },
);
Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, id, required, ...props }, ref) => {
    const generated = useId();
    const fieldId = id || generated;
    return (
      <FieldWrapper
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={fieldId}
      >
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${fieldId}-message` : undefined}
          className={cn(
            fieldBase,
            STATE_RING[error ? "error" : "default"],
            "min-h-24 resize-y",
            className,
          )}
          {...props}
        />
      </FieldWrapper>
    );
  },
);
Textarea.displayName = "Textarea";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, hint, error, options, id, required, ...props }, ref) => {
    const generated = useId();
    const fieldId = id || generated;
    return (
      <FieldWrapper
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={fieldId}
      >
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${fieldId}-message` : undefined}
          className={cn(
            fieldBase,
            STATE_RING[error ? "error" : "default"],
            "appearance-none bg-[length:1rem] bg-[right:0.6rem_center] bg-no-repeat pr-9",
            "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke-width=%222%22 stroke=%22%2394a3b8%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22m19.5 8.25-7.5 7.5-7.5-7.5%22/%3E%3C/svg%3E')]",
            className,
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldWrapper>
    );
  },
);
Select.displayName = "Select";

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, hint, id, ...props }, ref) => {
    const generated = useId();
    const fieldId = id || generated;
    return (
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          className={cn(
            "mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-600",
            "transition-colors dark:border-slate-600 dark:bg-slate-800",
            className,
          )}
          {...props}
        />
        <div className="min-w-0">
          <label
            htmlFor={fieldId}
            className="cursor-pointer text-sm text-slate-700 dark:text-slate-300"
          >
            {label}
          </label>
          {hint && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
          )}
        </div>
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";

export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ className, label, hint, id, ...props }, ref) => {
    const generated = useId();
    const fieldId = id || generated;
    return (
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="radio"
          className={cn(
            "mt-0.5 size-4 shrink-0 border-slate-300 text-brand-600",
            "dark:border-slate-600 dark:bg-slate-800",
            className,
          )}
          {...props}
        />
        <div className="min-w-0">
          <label
            htmlFor={fieldId}
            className="cursor-pointer text-sm text-slate-700 dark:text-slate-300"
          >
            {label}
          </label>
          {hint && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
          )}
        </div>
      </div>
    );
  },
);
Radio.displayName = "Radio";
