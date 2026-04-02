import Image from "next/image";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <Image
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius Coffee"
          width={48}
          height={48}
          className="mb-6 h-12 w-12 rounded-lg"
        />
        <h1 className="text-2xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: 29 March 2026
        </p>

        <div className="mt-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              1. Data Controller
            </h2>
            <p>
              Celsius Coffee (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the Celsius
              Coffee Loyalty Programme. This policy explains how we collect, use,
              and protect your personal data in accordance with the Personal Data
              Protection Act 2010 (PDPA) of Malaysia.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              2. Data We Collect
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                <strong>Phone number</strong> — required for account
                identification and OTP verification
              </li>
              <li>
                <strong>Name</strong> — for personalisation (optional)
              </li>
              <li>
                <strong>Email</strong> — for communications (optional)
              </li>
              <li>
                <strong>Birthday</strong> — for birthday rewards (optional)
              </li>
              <li>
                <strong>Transaction history</strong> — points earned, redeemed,
                and visit records
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              3. How We Use Your Data
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>To manage your loyalty points and rewards</li>
              <li>To send OTP codes for account verification</li>
              <li>
                To send promotional SMS messages (only with your consent; you
                can opt out at any time)
              </li>
              <li>To provide birthday rewards and special offers</li>
              <li>To improve our services through aggregated analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              4. Third-Party Data Sharing
            </h2>
            <p>We share limited data with:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                <strong>SMS providers</strong> (SMS123 / SMS Niaga) — your phone
                number and message content for delivering OTP codes and
                promotional messages
              </li>
              <li>
                <strong>Supabase</strong> — cloud database provider for secure
                data storage
              </li>
            </ul>
            <p className="mt-2">
              We do not sell your personal data to any third party.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              5. SMS Marketing &amp; Opt-Out
            </h2>
            <p>
              You may receive promotional SMS messages from us. You can opt out
              at any time by informing our staff at any outlet or by contacting
              us. Opting out of marketing messages will not affect your loyalty
              account or transactional messages (such as OTP codes).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              6. Data Retention
            </h2>
            <p>
              We retain your personal data for as long as your loyalty account is
              active. OTP codes are automatically deleted after verification or
              expiry. SMS logs are retained for 90 days for troubleshooting
              purposes. You may request deletion of your account and all
              associated data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              7. Your Rights (PDPA Sections 12 &amp; 13)
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                <strong>Access</strong> — You have the right to know what
                personal data we hold about you
              </li>
              <li>
                <strong>Correction</strong> — You may request corrections to
                your personal data
              </li>
              <li>
                <strong>Deletion</strong> — You may request deletion of your
                account and personal data
              </li>
              <li>
                <strong>Withdraw Consent</strong> — You may withdraw consent for
                marketing communications at any time
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              8. Data Security
            </h2>
            <p>
              We implement appropriate security measures to protect your personal
              data, including encrypted connections (HTTPS), hashed passwords and
              PINs, and access controls on our systems.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              9. Contact Us
            </h2>
            <p>
              For any enquiries regarding your personal data, please contact us
              at any Celsius Coffee outlet or email us at{" "}
              <strong>ops@celsiuscoffee.com</strong>.
            </p>
          </section>
        </div>

        <div className="mt-10 border-t pt-6">
          <p className="text-xs text-gray-400">
            This privacy policy is published in compliance with the Personal Data
            Protection Act 2010 (Act 709) of Malaysia.
          </p>
        </div>
      </div>
    </div>
  );
}
