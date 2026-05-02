import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Standard header for HR sub-pages. Title + optional description on the left,
// optional action on the right, BackToHR crumb above (skipped on landing).
//
// Usage:
//   <HrPageHeader
//     title="Attendance Review"
//     description="3 flagged items need review"
//     action={<button>Run AI</button>}
//   />
export function HrPageHeader({
  title,
  description,
  action,
  showBack = true,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  showBack?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {showBack && (
          <Link
            href="/hr"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3 w-3" /> HR
          </Link>
        )}
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {icon}
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
