export default function MenuLoading() {
  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5] animate-pulse">
      {/* Header */}
      <div className="bg-[#160800] px-4 py-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 bg-white/20 rounded" />
          <div className="h-5 w-32 bg-white/20 rounded" />
          <div className="ml-auto h-6 w-6 bg-white/20 rounded" />
        </div>
        {/* Category pills */}
        <div className="flex gap-2 mt-3 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="shrink-0 h-8 w-20 bg-white/15 rounded-full" />
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 py-3">
        <div className="h-10 bg-white rounded-full shadow-sm" />
      </div>

      {/* Product grid */}
      <div className="px-4 grid grid-cols-2 gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="aspect-square bg-gray-100" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
