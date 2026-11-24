import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { inputVariants, innerGradientVariants } from "./variant-class"

export interface CustomInputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

const CustomInput = React.forwardRef<HTMLInputElement, CustomInputProps>(
  ({ className, variant, size, rounded, type, ...props }, ref) => {
    const hasMinimalVariant = variant === "minimal"

    return (
      <div className={cn("relative", className)}>
        {!hasMinimalVariant && (
          <>
            <div className={cn(innerGradientVariants({ variant, rounded }))} />
          </>
        )}
        <input
          type={type}
          className={cn(
            inputVariants({ variant, size, rounded }),
            "relative z-10 w-full py-3 text-sm outline-none bg-transparent",
            hasMinimalVariant && "bg-gray-50",
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  },
)
CustomInput.displayName = "CustomInput"

export { CustomInput }
