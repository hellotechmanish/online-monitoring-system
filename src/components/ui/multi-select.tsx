"use client";

import * as P from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export interface MultiSelectOption {
  value: string;
  label?: string;
  color?: string;
  hint?: string;
}

/**
 * Accessible multi-select: a button opening a listbox of checkable options.
 * Keyboard: Tab/Shift+Tab or arrows to move, Space/Enter to toggle, Escape to close.
 */
export function MultiSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled,
  label,
  emptyText = "No options",
}: {
  id?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  emptyText?: string;
}) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary =
    value.length === 0 ? placeholder : value.length <= 3 ? value.join(", ") : `${value.slice(0, 2).join(", ")} +${value.length - 2} more`;

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
  };

  return (
    <P.Root>
      <P.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={`${label}: ${value.length ? value.join(", ") : "none selected"}`}
          className="focus-ring flex h-9 w-full min-w-[220px] items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle"
        >
          <span className={cn("truncate", value.length === 0 && "text-subtle")}>{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-80 w-[var(--radix-popover-trigger-width)] min-w-[220px] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          <div id={listId} role="listbox" aria-multiselectable="true" aria-label={label} onKeyDown={onKey}>
            {options.length === 0 && <p className="px-3 py-2 text-sm text-subtle">{emptyText}</p>}
            {options.map((o) => {
              const selected = value.includes(o.value);
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => toggle(o.value)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggle(o.value);
                    }
                  }}
                  className="focus-ring flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                    aria-hidden
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  {o.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} aria-hidden />}
                  <span className="font-mono text-[13px]">{o.label ?? o.value}</span>
                  {o.hint && <span className="ml-auto text-xs text-subtle">{o.hint}</span>}
                </div>
              );
            })}
          </div>
          {options.length > 1 && (
            <div className="mt-1 flex justify-between border-t border-border px-2 pt-1.5 text-xs">
              <button type="button" className="focus-ring rounded px-1 text-primary hover:underline" onClick={() => onChange(options.map((o) => o.value))}>
                Select all
              </button>
              <button type="button" className="focus-ring rounded px-1 text-subtle hover:underline" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          )}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
