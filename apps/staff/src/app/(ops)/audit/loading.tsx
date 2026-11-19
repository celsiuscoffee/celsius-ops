export default function AuditLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-6 w-32 rounded bg-line animate-pulse" />
          <div className="h-3 w-48 rounded bg-sunken animate-pulse" />
        </div>

        {/* CTA button shell */}
        <div className="h-12 w-full rounded-xl bg-line animate-pulse" />

        {/* List skeletons */}
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-line animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-sunken animate-pulse" />
                </div>
                <div className="h-8 w-12 rounded bg-sunken animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
