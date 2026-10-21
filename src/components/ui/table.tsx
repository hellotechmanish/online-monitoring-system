import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Skeleton } from "./misc";

export function Table({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-muted/80 text-left text-xs font-semibold uppercase tracking-wide text-subtle">{children}</thead>;
}
export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}
export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("align-middle transition-colors hover:bg-muted/50", className)}>{children}</tr>;
}
export function TH({ children, className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn("whitespace-nowrap border-b border-border px-4 py-2.5", className)} {...p}>
      {children}
    </th>
  );
}
export function TD({ children, className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-2.5 text-foreground", className)} {...p}>
      {children}
    </td>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <TBody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </TBody>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return total > 0 ? <p className="px-4 py-3 text-xs text-subtle">{total} record{total === 1 ? "" : "s"}</p> : null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-4 py-3" aria-label="Pagination">
      <p className="text-xs text-subtle">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-subtle">
          Page {page} / {pages}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
