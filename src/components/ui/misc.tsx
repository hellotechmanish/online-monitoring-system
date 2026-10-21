import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "navy";
const tones: Record<Tone, string> = {
  neutral: "bg-muted text-subtle ring-border",
  success: "bg-success/10 text-success ring-success/30",
  warning: "bg-warning/10 text-warning ring-warning/30",
  danger: "bg-danger/10 text-danger ring-danger/30",
  info: "bg-primary/10 text-primary ring-primary/30",
  navy: "bg-navy text-white ring-navy",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-border/60", className)} aria-hidden />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-subtle">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-muted p-3 text-subtle">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-danger/10 p-3 text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-subtle">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Forbidden({ message = "You do not have permission to view this page." }: { message?: string }) {
  return (
    <Card>
      <EmptyState icon={<ShieldAlert className="h-6 w-6" aria-hidden />} title="Access denied" description={message} />
    </Card>
  );
}
