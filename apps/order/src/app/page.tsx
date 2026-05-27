/**
 * Probe — pure Next.js page at /, bypassing the pickup-native Expo Web
 * SPA. Goal: confirm iOS Safari's URL bar collapses on body scroll
 * here (it has to — there's no react-native-web wrapper chain
 * clamping document height). If this works, the real home content
 * gets rebuilt as a Next.js page in a follow-up. If it doesn't,
 * URL-bar collapse is unfixable and we accept it.
 *
 * Middleware (apps/order/src/middleware.ts) was updated to NOT rewrite
 * "/" to the SPA's index.html so this Next.js page actually wins.
 * Inner routes (/menu, /cart, /product/[id], etc.) still rewrite to
 * the SPA — those keep their existing rendering.
 *
 * The customer can tap "Open the menu" to enter the SPA at /menu.
 */
export default function ProbeHome() {
  return (
    <main
      style={{
        // min-height so the document can grow with content; body uses
        // its browser-default scrolling on this page (no RN-Web in the
        // way). iOS Safari collapses its URL bar on the first scroll.
        minHeight: "100dvh",
        background: "#FFFFFF",
        color: "#160800",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        padding: "24px 20px 96px",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          background: "#160800",
          color: "#FFFFFF",
          padding: "32px 20px",
          borderRadius: 18,
          marginBottom: 20,
        }}
      >
        <p style={{ margin: 0, opacity: 0.6, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
          Celsius Coffee
        </p>
        <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
          Order &amp; pickup
        </h1>
        <p style={{ margin: "12px 0 0", opacity: 0.75, fontSize: 14, lineHeight: 1.5 }}>
          Scroll down. The Safari URL bar should slim/hide once the document overflows the viewport.
        </p>
      </header>

      <a
        href="/menu"
        style={{
          display: "block",
          background: "#A2492C",
          color: "#FFFFFF",
          textDecoration: "none",
          textAlign: "center",
          padding: "14px 20px",
          borderRadius: 999,
          fontWeight: 600,
          marginBottom: 24,
        }}
      >
        Open the menu →
      </a>

      {/* Filler content so the document is taller than the viewport,
          giving iOS Safari something to scroll. */}
      {Array.from({ length: 14 }).map((_, i) => (
        <section
          key={i}
          style={{
            background: i % 2 === 0 ? "#F7F4F0" : "#FFFFFF",
            border: "1px solid #E8E1D8",
            borderRadius: 16,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>
            Section {i + 1}
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#5C534A" }}>
            Filler so the page is taller than the viewport. The Safari URL bar
            collapses when the body actually scrolls — that&apos;s what this
            probe is verifying. If it works, the real home content (hero,
            BEANS card, outlet picker, sections) gets rebuilt as a Next.js
            page in a follow-up. Native iOS pickup app is unaffected.
          </p>
        </section>
      ))}
    </main>
  );
}
