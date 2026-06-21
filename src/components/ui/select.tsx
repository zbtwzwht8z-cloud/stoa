import * as React from "react";

import { cn } from "./utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    className={cn(
      "h-control w-full rounded border border-border bg-surface px-3 text-lead font-normal text-text outline-none focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:[box-shadow:none] disabled:cursor-not-allowed disabled:opacity-50 sm:text-body",
      className
    )}
    ref={ref}
    {...props}
  />
));
Select.displayName = "Select";
