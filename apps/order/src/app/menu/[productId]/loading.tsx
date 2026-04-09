export default function ProductDetailLoading() {
  return (
    <div className="flex flex-col h-dvh bg-white overflow-hidden animate-pulse">
      {/* Hero image placeholder */}
      <div className="relative h-[52vh] bg-muted shrink-0" />

      {/* White sheet */}
      <div className="flex-1 bg-white rounded-t-3xl -mt-6 relative z-10 px-5 pt-5 space-y-4">
        {/* Title */}
        <div className="h-8 bg-muted rounded-xl w-3/4" />
        {/* Description */}
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-2/3" />
        </div>
        {/* Price */}
        <div className="h-7 bg-muted rounded-xl w-24" />

        <div className="h-px bg-border" />

        {/* Modifier group */}
        <div className="space-y-3">
          <div className="h-3 bg-muted rounded w-20" />
          <div className="flex gap-2">
            <div className="flex-1 h-12 bg-muted rounded-xl" />
            <div className="flex-1 h-12 bg-muted rounded-xl" />
            <div className="flex-1 h-12 bg-muted rounded-xl" />
          </div>
        </div>

        {/* Second modifier group */}
        <div className="space-y-3">
          <div className="h-3 bg-muted rounded w-16" />
          <div className="flex gap-2">
            <div className="flex-1 h-12 bg-muted rounded-xl" />
            <div className="flex-1 h-12 bg-muted rounded-xl" />
          </div>
        </div>
      </div>

      {/* Bottom CTA placeholder */}
      <div className="fixed bottom-0 inset-x-0 max-w-[430px] mx-auto bg-white border-t px-5 py-4 z-20">
        <div className="h-14 bg-muted rounded-full animate-pulse" />
      </div>
    </div>
  );
}
