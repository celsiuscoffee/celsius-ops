import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Celsius Manager",
  description:
    "Privacy policy for the Celsius Manager app by Celsius Coffee Sdn Bhd.",
};

// Public privacy policy for the Celsius Manager app (staff-native).
// Reachable at /privacy without authentication (allow-listed in middleware).
export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 96px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1A0200",
        lineHeight: 1.65,
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 4 }}>
        Privacy Policy — Celsius Manager
      </h1>
      <p style={{ color: "#6B6B6B", marginTop: 0 }}>Last updated: 7 June 2026</p>

      <p>
        Celsius Coffee Sdn Bhd (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates the
        Celsius Manager app for our staff and managers. This policy explains
        what we collect and why.
      </p>

      <h2 style={h2}>Information we collect</h2>
      <ul>
        <li>
          <strong>Account &amp; identity:</strong> your name, staff number,
          role, and assigned outlet, used to authenticate you and show your
          data. Sign-in uses a PIN issued by your employer.
        </li>
        <li>
          <strong>Location:</strong> with your permission, we use precise
          location (including in the background) only to detect arrival and
          departure at your assigned outlet for automatic clock in/out. Location
          is checked at outlet boundaries — not continuously tracked — and is
          never used for any other purpose. You can decline and clock in
          manually.
        </li>
        <li>
          <strong>Camera &amp; photos:</strong> with your permission, to capture
          expense-claim receipts, scan outlet QR codes, and take a clock-in
          verification photo.
        </li>
        <li>
          <strong>Biometrics:</strong> Face ID / fingerprint may be used to
          confirm clock in/out. This is handled entirely by your device&rsquo;s
          operating system; we never receive or store biometric data.
        </li>
        <li>
          <strong>Device &amp; usage data:</strong> we use Sentry to collect
          crash and error diagnostics, and push-notification tokens to deliver
          work notifications.
        </li>
      </ul>

      <h2 style={h2}>How we use it</h2>
      <p>
        To provide attendance, payroll, scheduling, leave, claims, checklists,
        inventory, and sales features; and to operate, secure, and improve the
        app.
      </p>

      <h2 style={h2}>Sharing</h2>
      <p>
        We do not sell your data. We share data only with service providers that
        run the app on our behalf (Supabase for our database, Expo for push
        delivery and updates, Sentry for diagnostics), and as required by law.
      </p>

      <h2 style={h2}>Retention</h2>
      <p>
        We keep employment-related records for as long as required for HR,
        payroll, and legal obligations.
      </p>

      <h2 style={h2}>Your choices</h2>
      <p>
        You can disable location and camera permissions anytime in your device
        settings; clock-in can then be done manually. For access or deletion
        requests, contact us.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Celsius Coffee Sdn Bhd —{" "}
        <a href="mailto:barista@celsiuscoffee.com" style={{ color: "#A2492C" }}>
          barista@celsiuscoffee.com
        </a>
      </p>
    </main>
  );
}

const h2 = {
  fontSize: 19,
  fontWeight: 700,
  marginTop: 32,
  marginBottom: 8,
} as const;
