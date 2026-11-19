export default function HrLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-6 w-24 rounded bg-line animate-pulse" />
          <div className="h-3 w-40 rounded bg-sunken animate-pulse" />
        </div>

        {/* Clock in card */}
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-line animate-pulse" />
            <div className="h-4 w-16 rounded bg-sunken animate-pulse" />
          </div>
          <div className="h-12 w-full rounded-lg bg-line animate-pulse" />
        </div>

        {/* Row of module tiles */}
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-surface p-4 space-y-2"
            >
              <div className="h-9 w-9 rounded-lg bg-sunken animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-line animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-sunken animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
