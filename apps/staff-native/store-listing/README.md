# Celsius Staff — Store Listing Pack

Everything Apple App Store Connect and Google Play Console will ask for,
pre-drafted. Copy/paste into the listing forms (or I'll do it once
you're logged in).

---

## App name / subtitle

- **App name** (max 30 chars): `Celsius Staff`
- **Subtitle** (max 30 chars, iOS only): `Outlet operations & HR`

## Short description (Play Store — 80 char max)

Clock in, run checklists, manage stock and HR for Celsius Coffee outlets.

## Long description (≤ 4000 chars on both stores)

Celsius Staff is the on-shift app for Celsius Coffee employees. Sign in
with your staff PIN, clock in with GPS + Face ID at your assigned
outlet, and run the day:

• **Clock in / out** — auto-detected when you enter your outlet's
geofence, biometric-confirmed, with a selfie for the attendance log.

• **Checklists** — shift opening, midday and closing SOPs delivered to
your home screen with photo capture, time-stamped completion and
personal contribution stats.

• **Audits** — Barista / Kitchen skill audits with one-tap rating,
photo evidence and per-staff coverage so managers see who needs
auditing next.

• **Inventory** — daily stock count, receivings against POs, wastage
logging, inter-outlet transfers, supplier purchase orders (AI-suggested
restock + WhatsApp send), invoice tracking with proof-of-payment.

• **Pay & Claim** — out-of-pocket reimbursement claims with receipt
photos and supplier payment requests for managers.

• **HR** — your shift roster, attendance history (with overtime),
leave balances + requests, payslips, performance reviews, skill audits
and company memos.

The app is restricted to active Celsius Coffee staff. Access is
provisioned by HR; there is no public sign-up.

## Keywords (Apple — ≤ 100 chars, comma-separated)

cafe,coffee,staff,attendance,clock in,clockin,sop,inventory,checklist,workforce,outlet,celsius

## Categories

- **iOS primary**: Business
- **iOS secondary**: Productivity
- **Play category**: Business

## Content rating

- **iOS**: 4+ (no objectionable content)
- **Play / IARC**: Everyone

## Pricing

Free, all territories.

## Support / marketing URLs

- **Support URL**: https://staff.celsiuscoffee.com/support
  - (If that page doesn't exist yet, use mailto: `support@celsiuscoffee.com`
    until the static support page is up.)
- **Marketing URL**: https://celsiuscoffee.com
- **Privacy policy URL**: https://staff.celsiuscoffee.com/privacy
  - (Published by this commit — file at apps/staff/public/privacy.html.
    Will be live on Vercel within ~2 min of `git push`.)

## App Store Connect — App Review Notes

```
Celsius Staff is an internal-only workforce app. Public sign-up is
disabled by design.

To review the app, please sign in with the demo credentials below.

  Outlet:  Celsius Coffee Putrajaya
  PIN:     999999  (demo account — read-only across the app)

The demo account has STAFF role with no outlet assignment, so location
auto-clock-in won't fire. You can still:
  - browse the Home screen and the bottom tabs (Checklists, Audit, HR,
    Inventory)
  - tap the avatar (top-left of Home) to open Profile, change PIN,
    toggle Face ID, switch theme
  - open any module to see the empty state and UI

If you'd like to test attendance with a real outlet, contact
support@celsiuscoffee.com and we'll temporarily attach the demo
account to an outlet for the review window.

Permissions explained:
  - NSLocationAlways: required to auto clock-in/out when staff enter
    or leave the outlet geofence. The app records ONLY whether a
    boundary was crossed; it does not continuously track location.
  - NSCameraUsageDescription: clock-in selfies (audit trail), receipt
    photos for expense claims, audit evidence photos.
  - NSFaceIDUsageDescription: optional second factor at clock-in.

Test data: hr@celsiuscoffee.com if you need a custom test path.
```

## Google Play — Content Rating questionnaire answers

- Violence: None
- Sexual content: None
- Profanity: None
- Drugs / alcohol / tobacco: None
- User-generated content: No
- Shares user location: Yes (precise; used solely for attendance
  geofencing of company outlets)
- Internet usage: Required (HTTPS to staff.celsiuscoffee.com)

## Google Play — Data Safety form

- Personal info collected: Name, Email (work), Phone
- Financial info: Bank account (for payroll only)
- Location: Approximate + precise (collected, not shared)
- Photos: Yes (collected, not shared)
- App activity: In-app actions (collected, not shared)
- Audio / contacts / files / messages: None
- Data encrypted in transit: Yes
- Users can request deletion: Yes (contact hr@celsiuscoffee.com)
- Data shared with third parties: No (processors only — Supabase,
  Cloudinary, Sentry, Expo, Apple, Google — listed in privacy policy)

## Demo account — needs to be created server-side

Before submission, HR should create a User with:
  email:     appstore-review@celsiuscoffee.com  (or similar)
  pin:       999999
  role:      STAFF
  outletId:  null
  moduleAccess: all-read (so reviewers can navigate but not mutate)

I'll create that user via SQL when you give the go-ahead.

## Screenshots — need to generate

App Store requires at least 1 set; we'll provide for:
  - 6.7" iPhone (1290 × 2796) — required
  - 6.5" iPhone (1242 × 2688) — strongly recommended
  - 5.5" iPhone (1242 × 2208) — required for older iPhone listings

Play Store requires at least 2 phone screenshots (1080 × 1920 or
larger; aspect 16:9 or 9:16).

Plan: capture via iOS Simulator after the build's TestFlight upload
(I have local terminal access and can run `xcrun simctl` to drive
the simulator + take screenshots). Same for Android via emulator
once the .aab is downloaded and converted to .apk for emulator
install.
