export default function StaffLoginLoading() {
  return (
    <div className="min-h-dvh bg-[#160800] flex flex-col items-center justify-between px-6 pt-16 pb-10">
      {/* Brand */}
      <div className="text-center">
        <div className="h-3 w-20 bg-white/10 rounded mx-auto mb-2 animate-pulse" />
        <div className="h-8 w-48 bg-white/20 rounded mx-auto animate-pulse" />
      </div>

      {/* Store selector skeleton */}
      <div className="w-full">
        <div className="h-3 w-24 bg-white/10 rounded mx-auto mb-3 animate-pulse" />
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="w-full py-4 rounded-2xl bg-white/10 animate-pulse h-14" />
          ))}
        </div>
      </div>

      {/* PIN skeleton */}
      <div className="text-center w-full">
        <div className="h-3 w-36 bg-white/10 rounded mx-auto mb-4 animate-pulse" />
        <div className="flex items-center justify-center gap-4 mb-2 bg-white/8 border border-white/12 rounded-2xl px-8 py-5 mx-auto w-fit">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="w-4 h-4 rounded-full bg-white/20 animate-pulse" />
          ))}
        </div>
      </div>

      {/* Numpad skeleton */}
      <div className="w-full max-w-xs">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-white/10 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
