import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "focus-ring block w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-subtle/70 disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle read-only:bg-muted aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[72px] py-2", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-9 pr-8", className)} {...p}>
      {children}
    </select>
  );
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wide text-subtle">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="focus-ring h-4 w-4 rounded border-border text-primary accent-[rgb(var(--primary))]" {...p} />
      <span>{label}</span>
    </label>
  );
}
