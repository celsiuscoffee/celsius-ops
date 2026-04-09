import * as React from "react"
import { cn } from "./utils"

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Progress value from 0 to 100 */
  value: number
  /** Color theme for the progress bar */
  color?: "default" | "green" | "yellow" | "blue"
  /** Size of the progress bar */
  size?: "sm" | "md" | "lg"
  /** Whether to show a percentage label */
  showLabel?: boolean
}

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
} as const

const colorClasses = {
  default: "bg-primary",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  blue: "bg-blue-500",
} as const

function ProgressBar({
  value,
  color = "default",
  size = "md",
  showLabel = false,
  className,
  ...props
}: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value))

  return (
    <div className={cn("w-full", className)} {...props}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            Progress
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {Math.round(clampedValue)}%
          </span>
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-secondary",
          sizeClasses[size]
        )}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-in-out",
            colorClasses[color]
          )}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  )
}

export { ProgressBar }
