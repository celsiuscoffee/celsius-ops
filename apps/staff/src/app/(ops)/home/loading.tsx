export default function HomeLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-line animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-40 rounded bg-line animate-pulse" />
              <div className="h-3 w-28 rounded bg-sunken animate-pulse" />
            </div>
          </div>

          {/* Progress bar shell */}
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-4 w-24 rounded bg-line animate-pulse" />
              <div className="h-3 w-14 rounded bg-sunken animate-pulse" />
            </div>
            <div className="h-2 w-full rounded-full bg-sunken overflow-hidden" />
          </div>

          {/* Task card skeletons */}
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-line border-l-4 border-l-line bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-sunken animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-line animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-sunken animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
