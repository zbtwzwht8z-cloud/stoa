import * as React from "react";

import { cn } from "./utils";

// Stoa = an ancient Greek colonnade/covered walkway. The mark is a minimal
// temple front: a pediment over three columns on a stylobate. Colors come from
// the design tokens so it tracks the theme; the favicon/app-icon variants in
// src/app/icon.svg + public/logo.svg hardcode the same shapes.
export function Logo({
  size = 28,
  className,
  title = "Stoa"
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      height={size}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <rect fill="var(--accent)" height="32" rx="8" width="32" />
      <g fill="var(--accent-foreground)">
        <polygon points="16,6 25,11 7,11" />
        <rect height="2.2" rx="0.6" width="18" x="7" y="11.6" />
        <rect height="8" rx="0.5" width="2.4" x="9.8" y="14.4" />
        <rect height="8" rx="0.5" width="2.4" x="14.8" y="14.4" />
        <rect height="8" rx="0.5" width="2.4" x="19.8" y="14.4" />
        <rect height="2.6" rx="0.7" width="20" x="6" y="22.6" />
      </g>
    </svg>
  );
}
