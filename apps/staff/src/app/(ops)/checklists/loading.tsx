export default function ChecklistsLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-6 w-36 rounded bg-line animate-pulse" />
          <div className="h-3 w-52 rounded bg-sunken animate-pulse" />
        </div>

        {/* Card skeletons */}
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-sunken animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-line animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-sunken animate-pulse" />
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-sunken" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
