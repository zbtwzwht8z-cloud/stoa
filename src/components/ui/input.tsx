import * as React from "react";

import { cn } from "./utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    className={cn(
      "flex h-control w-full rounded border border-border bg-surface px-3 text-lead font-normal text-text outline-none placeholder:text-text-subtle focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:[box-shadow:none] disabled:cursor-not-allowed disabled:opacity-50 sm:text-body",
      className
    )}
    ref={ref}
    type={type}
    {...props}
  />
));
Input.displayName = "Input";
