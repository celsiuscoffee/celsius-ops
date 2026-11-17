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
            className="inline-flex items-center gap-1 text-[13px] text-text-2 hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Team
          </Link>
        )}
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">
          {icon}
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-text-2">{description}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
