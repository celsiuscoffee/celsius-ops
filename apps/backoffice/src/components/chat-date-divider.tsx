// WhatsApp-style centered date pill that separates message groups by day.
// Pair with mytDayKey/chatDayLabel from @/lib/chat-day to decide when to render one.
export function ChatDateDivider({ label }: { label: string }) {
  return (
    <div className="my-1 flex justify-center">
      <span className="rounded-full border bg-background/80 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
        {label}
      </span>
    </div>
  );
}
