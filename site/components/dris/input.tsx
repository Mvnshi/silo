import type React from "react"
import { Input as InputBase } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { VariantProps } from "class-variance-authority"
import { inputVariants, innerGradientVariants } from "./variant-class"
import type { defaultProps } from "./variants"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, VariantProps<typeof inputVariants> {
  rounded?: (typeof defaultProps)[number]
}

export function Input({ className, variant, size, rounded, ...props }: InputProps) {
  return (
    <div className="relative">
      <InputBase
        {...props}
        className={cn(inputVariants({ variant, size, rounded }), "relative z-10 bg-transparent", className)}
      />
      {variant !== "minimal" && <div className={cn(innerGradientVariants({ variant, rounded }))} />}
    </div>
  )
}
