export default function CartLoading() {
  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5] animate-pulse">
      <div className="bg-[#160800] px-4 py-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
        <div className="h-6 w-20 bg-white/20 rounded" />
      </div>
      <div className="flex-1 px-4 py-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-4 shadow-sm flex gap-3">
            <div className="w-16 h-16 bg-gray-100 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-8">
        <div className="h-14 bg-[#160800]/20 rounded-2xl" />
      </div>
    </div>
  );
}
