import * as React from "react"
import { cn } from "./utils"
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react"

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Label describing the stat */
  label: string
  /** The main value to display */
  value: string | number
  /** Lucide icon component */
  icon: LucideIcon
  /** Optional trend information */
  trend?: {
    /** Percentage change */
    value: number
    /** Whether the trend is positive */
    isPositive: boolean
  }
}

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-6 text-card-foreground shadow-sm",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-[#C2452D]/10 p-2">
          <Icon className="h-5 w-5 text-[#C2452D]" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {trend && (
          <div className="mt-1 flex items-center gap-1">
            {trend.isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-[#C2452D]" />
            )}
            <span
              className={cn(
                "text-xs font-medium",
                trend.isPositive ? "text-green-600" : "text-[#C2452D]"
              )}
            >
              {trend.isPositive ? "+" : ""}
              {trend.value}%
            </span>
            <span className="text-xs text-muted-foreground">vs last period</span>
          </div>
        )}
      </div>
    </div>
  )
}

export { StatCard }
