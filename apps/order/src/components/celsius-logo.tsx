import { cn } from "@/lib/utils";

interface CelsiusLogoProps {
  /** "wordmark" = °Celsius Coffee text  |  "mark" = large °C icon */
  type?: "wordmark" | "mark";
  size?: "sm" | "md" | "lg";
  variant?: "default" | "white";
  className?: string;
}

const DISPLAY_FONT = '"Peachi", "Space Grotesk", serif';

export function CelsiusLogo({
  type = "wordmark",
  size = "md",
  variant = "default",
  className,
}: CelsiusLogoProps) {
  const color = variant === "white" ? "text-white" : "text-[#160800]";

  if (type === "mark") {
    // Square icon mark — large °C on brand-dark background
    const dims = { sm: 32, md: 44, lg: 64 }[size];
    const fontSize = { sm: 20, md: 28, lg: 40 }[size];
    return (
      <div
        className={cn("rounded-xl bg-[#160800] flex items-center justify-center shrink-0", className)}
        style={{ width: dims, height: dims }}
      >
        <span
          className="text-white font-black leading-none select-none"
          style={{ fontFamily: DISPLAY_FONT, fontSize }}
        >
          °C
        </span>
      </div>
    );
  }

  // Wordmark — °Celsius Coffee
  const textSize = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" }[size];
  return (
    <span
      className={cn("font-black tracking-tight leading-none select-none", textSize, color, className)}
      style={{ fontFamily: DISPLAY_FONT }}
    >
      °Celsius Coffee
    </span>
  );
}
