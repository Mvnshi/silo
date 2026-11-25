import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { baseVariants, innerGradientVariants, shadowTextVariants } from "./variant-class"
import { baseStyles } from "./variants"

export interface CustomButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof baseVariants> {
  asChild?: boolean
}

const CustomButton = React.forwardRef<HTMLButtonElement, CustomButtonProps>(
  ({ className, variant, size, rounded, children, ...props }, ref) => {
    const hasMinimalVariant = variant === "minimal"

    return (
      <button className={cn(baseVariants({ variant, size, rounded, className }))} ref={ref} {...props}>
        {!hasMinimalVariant && (
          <>
            <div className={cn(innerGradientVariants({ variant, rounded }))} />
            <div className={cn(shadowTextVariants({ variant, size }))}>{children}</div>
          </>
        )}
        <div className={cn(baseStyles.child)}>{children}</div>
      </button>
    )
  },
)
CustomButton.displayName = "CustomButton"

export { CustomButton }
