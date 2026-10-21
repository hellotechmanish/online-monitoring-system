"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  preventClose,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Blocks closing via overlay/Escape (e.g. while submitting). */
  preventClose?: boolean;
}) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <D.Root open={open} onOpenChange={(o) => (!o && preventClose ? undefined : onOpenChange(o))}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl focus:outline-none",
            width,
          )}
          onInteractOutside={(e) => preventClose && e.preventDefault()}
          onEscapeKeyDown={(e) => preventClose && e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold text-foreground">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-sm text-subtle">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">Dialog</D.Description>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={preventClose}>
                <X className="h-4 w-4" />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      preventClose={loading}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-foreground">{message}</div>
    </Modal>
  );
}
