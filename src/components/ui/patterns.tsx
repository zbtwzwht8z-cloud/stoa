import * as React from "react";

import { cn } from "./utils";

export const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    label: string;
    htmlFor: string;
    hint?: string;
  }
>(({ children, className, hint, htmlFor, label, ...props }, ref) => (
  <div className={cn("grid gap-2", className)} ref={ref} {...props}>
    <label className="text-body-sm font-medium text-text" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {hint ? <p className="m-0 text-label text-text-subtle">{hint}</p> : null}
  </div>
));
Field.displayName = "Field";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }
>(({ className, id, label, ...props }, ref) => (
  <label
    className="inline-flex items-center gap-2 text-body font-normal text-text"
    htmlFor={id}
  >
    <input
      className={cn(
        "h-4 min-h-0 w-4 shrink-0 rounded border border-border accent-accent outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:[box-shadow:none]",
        className
      )}
      id={id}
      ref={ref}
      type="checkbox"
      {...props}
    />
    <span>{label}</span>
  </label>
));
Checkbox.displayName = "Checkbox";

export function Stat({
  label,
  value,
  accent = false
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-body-sm font-normal text-text-muted">{label}</dt>
      <dd className={cn("m-0 text-h2 font-semibold", accent ? "text-accent" : "text-text")}>
        {value}
      </dd>
    </div>
  );
}

export function NavItem({
  active = false,
  href,
  icon,
  label
}: {
  active?: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-nav items-center gap-2 rounded px-3 text-body-sm font-medium no-underline transition-colors",
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-accent"
          : "text-text-muted hover:bg-surface-muted hover:text-text"
      )}
      href={href}
    >
      <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
        {icon}
      </span>
      <span>{label}</span>
    </a>
  );
}

export const List = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn("divide-y divide-border border-y border-border", className)}
    ref={ref}
    role="list"
    {...props}
  />
));
List.displayName = "List";

export function ListRow({
  action,
  detail,
  meta,
  title
}: {
  action?: React.ReactNode;
  detail?: string;
  meta?: React.ReactNode;
  title: string;
}) {
  return (
    <div
      className="grid min-h-control grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3"
      role="listitem"
    >
      <div className="min-w-0">
        <p className="m-0 text-body font-medium text-text">{title}</p>
        {detail ? (
          <p className="m-0 mt-1 text-body-sm text-text-muted">{detail}</p>
        ) : null}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-body-sm text-text-muted">
            {meta}
          </div>
        ) : null}
      </div>
      {action ? <div className="text-body-sm text-text-subtle">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  action,
  message
}: {
  action: React.ReactNode;
  message: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-y border-border py-4">
      <p className="m-0 text-body text-text-muted">{message}</p>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="flex rounded border border-border bg-surface p-1"
      role="group"
    >
      {options.map(([optionValue, label]) => {
        const active = value === optionValue;

        return (
          <button
            aria-pressed={active}
            className={cn(
              "flex-1 rounded px-3 py-1.5 text-body-sm font-medium transition-colors",
              active
                ? "bg-surface-muted text-text"
                : "text-text-muted hover:text-text"
            )}
            key={optionValue}
            onClick={() => onChange(optionValue)}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
