export default function HomeLoading() {
  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5] animate-pulse">
      {/* Header skeleton */}
      <div className="bg-[#160800] px-4 pb-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-center justify-between">
          <div className="h-7 w-28 bg-white/20 rounded" />
          <div className="h-6 w-6 bg-white/20 rounded" />
        </div>
        <div className="h-4 w-40 bg-white/10 rounded mt-4" />
      </div>

      {/* Hero banner skeleton */}
      <div className="bg-[#2a1200] h-48 mx-0" />

      {/* Quick actions skeleton */}
      <div className="grid grid-cols-2 gap-3 px-4 mt-4">
        <div className="h-24 bg-white rounded-xl shadow-sm" />
        <div className="h-24 bg-white rounded-xl shadow-sm" />
      </div>

      {/* Best sellers skeleton */}
      <div className="px-4 mt-4">
        <div className="h-5 w-24 bg-gray-200 rounded mb-3" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shrink-0 w-40 h-56 bg-white rounded-3xl shadow-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
