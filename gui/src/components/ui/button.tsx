import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
  outline: "bg-transparent border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
  danger: "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20",
  ghost: "bg-transparent text-zinc-400 hover:text-zinc-200",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: "sm" | "md";
}

export function Button({ variant = "outline", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
