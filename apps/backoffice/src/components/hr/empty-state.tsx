// Standard empty-state card for HR pages. Pass an icon and a label; optional
// hint text and action button. Replaces the ad-hoc "No X yet" paragraphs
// scattered across pages.
//
// Usage:
//   <HrEmptyState icon={<FileText />} label="No memos" hint="Manager memos appear here" />
export function HrEmptyState({
  icon,
  label,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <p className="font-semibold text-gray-500">{label}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
