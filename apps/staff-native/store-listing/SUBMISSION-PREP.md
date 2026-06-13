# Celsius Manager — Store Submission Pack

Everything needed to submit **Celsius Manager** (iOS App Store + Google Play). Items marked **[YOU]** need your action; **[DONE]** are already filled in App Store Connect by Claude.

---

## 1. App identity
- **App name:** Celsius Manager  [DONE in ASC + baked into build 8]
- **Bundle ID / package:** com.celsiuscoffee.staff  (unchanged — keeps the existing app record)
- **Version / build:** 1.0.0 (8)
- **Primary category:** Business
- **Age rating:** 4+  [DONE in ASC]

## 2. Subtitle (iOS, ≤30 chars)
`Outlet ops, sales & shifts`

## 3. Promotional text (iOS, ≤170 chars)
`Run your Celsius Coffee outlet from your pocket — attendance, payslips, leave, claims, checklists, and live sales across all outlets.`

## 4. Description (App Store + Play full description)
```
Celsius Manager is the all-in-one operations app for Celsius Coffee outlet teams.

Clock in and out with location-aware attendance, view your shifts, check payslips, apply for leave, submit expense claims with receipt capture, complete opening/closing checklists, and track live sales — all from your phone.

For managers and owners, a consolidated sales dashboard shows real-time revenue vs the previous period, orders, average order value, payment-method and channel breakdowns, and customer growth — for one outlet or all outlets at once.

Features
• Location-based clock in/out with geofencing
• Shift schedule and attendance history
• Payslips and leave applications
• Expense claims with receipt photos
• Daily checklists and audits
• Inventory, stock counts, and goods receiving
• Live consolidated sales dashboard (POS + pickup)
• Light, dark, and system appearance

Celsius Manager is for Celsius Coffee staff and managers. A staff PIN, provided by your outlet, is required to sign in.
```

## 5. Keywords (iOS, ≤100 chars)
`coffee,cafe,staff,manager,POS,sales,attendance,clock in,payslip,leave,shift,roster,inventory`

## 6. Play short description (≤80 chars)
`Attendance, payslips, checklists & live sales for Celsius Coffee teams.`

## 7. URLs
- **Support URL:** https://celsiuscoffee.com  **[YOU: confirm a real support/contact page]**
- **Marketing URL (optional):** https://celsiuscoffee.com
- **Privacy Policy URL:** **[YOU: host the text in §9 and paste the URL]** e.g. https://celsiuscoffee.com/privacy

## 8. 🔴 Reviewer demo login (REQUIRED — app is PIN-gated)  [YOU]
Apple & Google reviewers cannot pass the login screen without working credentials. **Create a demo staff account** (any outlet, a memorable PIN) and put this in:
- iOS: App Store Connect → App Review Information → Sign-In Required → username/password fields (use outlet + PIN, or add a note).
- Play: Play Console → App content → App access → "All functionality" → provide instructions + credentials.

Suggested review note:
```
This app requires a staff PIN to sign in.
Demo outlet: <Outlet name, e.g. Conezion>
Demo PIN: <6-digit PIN>
On launch: tap the outlet selector, choose the demo outlet, then enter the PIN.
```

## 9. 🔴 Privacy Policy (host this, then paste the URL)  [YOU host — drafted by Claude]
```
Privacy Policy — Celsius Manager
Last updated: 7 June 2026

Celsius Coffee Sdn Bhd ("we") operates the Celsius Manager app for our staff and managers. This policy explains what we collect and why.

Information we collect
• Account & identity: your name, staff number, role, and assigned outlet, used to authenticate you and show your data. Sign-in uses a PIN issued by your employer.
• Location: with your permission, we use precise location (including in the background) only to detect arrival/departure at your assigned outlet for automatic clock in/out. Location is checked at outlet boundaries — not continuously tracked — and is never used for any other purpose. You can decline and clock in manually.
• Camera & photos: with your permission, to capture expense-claim receipts, scan outlet QR codes, and take a clock-in verification photo.
• Biometrics: Face ID / fingerprint may be used to confirm clock in/out. This is handled entirely by your device's operating system; we never receive or store biometric data.
• Device & usage data: we use Sentry to collect crash and error diagnostics, and push-notification tokens to deliver work notifications.

How we use it
To provide attendance, payroll, scheduling, leave, claims, checklists, inventory, and sales features; to operate, secure, and improve the app.

Sharing
We do not sell your data. We share data only with service providers that run the app on our behalf (Supabase for our database, Expo for push delivery and updates, Sentry for diagnostics), and as required by law.

Retention
We keep employment-related records for as long as required for HR, payroll, and legal obligations.

Your choices
You can disable location and camera permissions anytime in your device settings; clock-in can then be done manually. For access or deletion requests, contact us.

Contact
Celsius Coffee Sdn Bhd — barista@celsiuscoffee.com
```

## 10. Play Data Safety answers  [YOU/Claude verify before submitting]
- Data collected & linked to user: Name, Staff/employee ID, Approximate + precise location, Photos, App diagnostics/crash logs, Device IDs (push token).
- Purposes: App functionality, Account management. (No advertising, no analytics-for-marketing.)
- Shared with third parties: No (service providers acting on our behalf are not "sharing" under Play rules).
- Encrypted in transit: Yes. Users can request deletion: Yes.

## 11. Play content rating answers
- Category: Utility / Productivity / Business. No violence, sexual content, profanity, controlled substances, gambling, or user-generated social content. → Expected rating: Everyone.

## 12. Target audience (Play)
- Target age: 18+ (employees). Not directed at children.

## 13. Screenshots  [YOU/Claude from TestFlight build 8]
Capture from build 8 (light or dark): Login, Sales dashboard, Clock-in, Payslip/Leave, Checklists. iOS needs 6.7" iPhone; Play needs ≥2 phone shots + a 1024×500 feature graphic.

## 14. Status of automated steps
- [DONE] App Store name → "Celsius Manager"
- [DONE] iOS age rating → 4+
- [DONE] Build 8 uploaded to App Store Connect / TestFlight (processing)
- [TODO via browser] Paste description/keywords/subtitle/URLs into the 1.0 version; attach build 8
- [YOU] Demo creds, privacy URL hosting, screenshots, App Privacy labels, then Submit for Review
- [YOU] Android: first AAB upload + listing + data safety + roll out
```
