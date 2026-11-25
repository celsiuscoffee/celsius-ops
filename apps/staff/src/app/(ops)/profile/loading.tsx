export default function ProfileLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-line animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-line animate-pulse" />
            <div className="h-3 w-24 rounded bg-sunken animate-pulse" />
          </div>
        </div>

        {/* Stats card */}
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="h-4 w-28 rounded bg-line animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-6 w-8 rounded bg-line animate-pulse" />
                <div className="h-3 w-12 rounded bg-sunken animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        {/* Menu rows */}
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-sunken animate-pulse" />
                <div className="h-4 w-32 rounded bg-line animate-pulse" />
              </div>
              <div className="h-4 w-4 rounded bg-sunken animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
