# Celsius Coffee — App Store + Play Store listing copy

Source of truth for both store submissions. Paste from here into App Store Connect and Google Play Console.

---

## Shared foundations

- **Legal entity:** CELSIUS COFFEE SDN. BHD.
- **Bundle ID / package:** `com.celsiuscoffee.pickup`
- **Public developer name:** Celsius Coffee
- **Support email:** barista@celsiuscoffee.com
- **Support URL:** https://order.celsiuscoffee.com/support
- **Marketing URL:** https://celsiuscoffee.com
- **Privacy policy URL:** https://order.celsiuscoffee.com/privacy
- **Account deletion URL:** https://order.celsiuscoffee.com/account-delete
- **Primary category:** Food & Drink
- **Secondary category:** Lifestyle
- **Content rating:** 4+ (Apple) / Everyone (Google IARC)
- **Pricing:** Free, no in-app purchases, no ads
- **Distribution country:** Malaysia (start), expand later if needed

---

## App Store Connect (iOS)

### App name (30 char max)
```
Celsius Coffee
```
*14 chars. Keep simple — brand-first.*

### Subtitle (30 char max)
```
Order. Earn. Pick up.
```
*21 chars. Verb-led, captures the three core flows.*

### Promotional text (170 char max — editable without review)
```
Skip the queue at your favourite Celsius outlet. Order ahead, earn points on every cup, and get notified the moment your drink is ready for pickup.
```

### Keywords (100 char max, comma-separated, no spaces after commas)
```
coffee,celsius,malaysia,kl,pickup,order,loyalty,rewards,cafe,specialty,latte,espresso,brew
```
*97 chars. Mix of brand, category, geography, and product terms.*

### Description (4000 char max)
```
Celsius Coffee is a Malaysian specialty coffee brand. Our app lets you order ahead, earn rewards, and skip the queue at any of our outlets.

ORDER AHEAD
Browse the full menu, customise your drink, and pay before you arrive. Your order goes straight to the barista the moment you confirm.

EARN ON EVERY CUP
Earn loyalty points on every transaction — at the counter or in-app. Redeem points for free drinks, food, and birthday rewards. Your points balance and history are always one tap away.

GET NOTIFIED THE MOMENT IT'S READY
We'll send a push notification when your drink is on the bar so your coffee is at peak temperature when you pick it up. No more guessing.

BUILT FOR REGULARS
- See your usual orders and reorder in two taps
- Find your nearest Celsius outlet with hours and directions
- Update your details and notification preferences any time
- View your full order history and digital receipts

PRIVACY YOU CAN READ IN A MINUTE
We collect only what we need to run your loyalty account and let you order. We don't track you across other apps or websites and we don't use advertising IDs. Read our full privacy policy at order.celsiuscoffee.com/privacy.

QUESTIONS?
Email us at barista@celsiuscoffee.com or talk to our team at any Celsius outlet.

Celsius Coffee Sdn. Bhd.
```
*~1500 chars — leaves room for future feature drops.*

### Review notes (for App Review team)
```
This app is a customer-facing companion for Celsius Coffee, a Malaysian specialty coffee chain. It loads our existing PWA at order.celsiuscoffee.com inside a Capacitor 7 shell.

DEMO ACCOUNT FOR REVIEW
Phone: +60 11-111-1111 (reviewer account; SMS is suppressed, static OTP below)
OTP: 424242

KEY FLOWS TO TEST
- Browse menu without account
- Sign in via OTP
- View loyalty points and rewards
- Place a test order (sandbox payment, no charge)
- Receive push notification on order ready

PUSH NOTIFICATION TESTING
We use APNs to notify customers when their order is ready for pickup. The "Allow Notifications" prompt fires only after the user explicitly enables push in app settings.

NO IN-APP PURCHASES
All payments for physical goods (coffee, food) go through Stripe / our payment processor — physical goods are not subject to Apple's In-App Purchase policy. The app is free to download with no IAP.
```

### App Privacy questionnaire (App Store Connect → App Privacy)

**Data collected and linked to user identity:**
- Contact Info → Name, Email, Phone Number
- Identifiers → User ID (your loyalty account ID)
- Purchases → Purchase History (loyalty transactions)
- Usage Data → Product Interaction (anonymised app events)
- Diagnostics → Crash Data, Performance Data

**Data used for:**
- App Functionality (loyalty, ordering, push notifications)
- Analytics (anonymised — Firebase Analytics)
- Product Personalization (showing relevant menu items / past orders)

**NOT collected:**
- Location, Health & Fitness, Financial Info, Sensitive Info, Contacts, Search History, Browsing History, Audio Data, Photos, Other User Content
- Tracking — **No**

**Data linked to user:** Yes (everything except crash/performance is tied to the loyalty account)
**Tracking across other apps/websites:** No

### Age Rating
Apple's questionnaire — answer No to everything except:
- Unrestricted Web Access: **No**
- Gambling/Contests: **No**
- Mature/Suggestive Themes: **No**

Result: **4+**

### Screenshots required
- 6.9" iPhone (e.g. 17 Pro Max) — 1320×2868 — minimum 3
- 6.5" iPhone (e.g. 11 Pro Max) — 1242×2688 — minimum 3
- 5.5" iPhone (legacy) — 1242×2208 — only if supporting iPhone 8 Plus
- 13" iPad — 2064×2752 — only required if iPad-supported (we are, since `TARGETED_DEVICE_FAMILY = "1,2"`)

**Recommended captures:**
1. Menu landing screen
2. Drink customisation
3. Loyalty / points dashboard
4. Order confirmation / receipt
5. Outlets / store finder

---

## Google Play Console (Android)

### App name (50 char max)
```
Celsius Coffee
```

### Short description (80 char max)
```
Order ahead, earn rewards, and skip the queue at your favourite Celsius outlet.
```
*78 chars.*

### Full description (4000 char max)
*Use the App Store description above — works as-is. Optionally add at the end:*

```
TARGET DEVICES
Phones and tablets running Android 7.0 (Nougat) or later.
```

### What's new — Release notes for first version (500 char max)
```
First release of the Celsius Coffee app. Order ahead, earn loyalty points, and get notified the moment your drink is ready. We'd love your feedback — email barista@celsiuscoffee.com.
```

### App categorisation
- **App category:** Food & Drink
- **Tags:** Coffee, Loyalty, Ordering, Cafe (max 5)

### Data Safety form (Play Console → App content → Data safety)

**Data collected:**
| Data type | Collected | Shared | Optional | Purpose | Linked to user |
|---|---|---|---|---|---|
| Name | Yes | No | Yes | Account management, Personalization | Yes |
| Email | Yes | No | Yes | Account management, Communications | Yes |
| Phone number | Yes | No | No | Account management, Auth (OTP) | Yes |
| User IDs | Yes | No | No | Account management, App functionality | Yes |
| Purchase history | Yes | No | No | App functionality (loyalty), Analytics | Yes |
| App interactions | Yes | No | No | Analytics, App functionality | No (anonymised) |
| Crash logs | Yes | No | No | Analytics, App functionality | No (anonymised) |
| Diagnostics | Yes | No | No | Analytics, App functionality | No (anonymised) |
| Push tokens | Yes | Yes (FCM/APNs) | No | App functionality (notifications) | Yes |

**Security practices:**
- Data encrypted in transit: **Yes** (HTTPS)
- Users can request data deletion: **Yes** — link to https://order.celsiuscoffee.com/account-delete
- Independently validated against global security standards: **No**
- Follows Families Policy: **No** (not targeted at children)

### Content rating (IARC questionnaire)
- Violence: No
- Sexual content: No
- Profanity: No
- Drugs/Alcohol/Tobacco references: **Yes — coffee is a stimulant; mention if asked, but typically rated Everyone**
- Gambling/Simulated gambling: No
- User-generated content: No
- Sharing of user location: No
- Personal info shared with strangers: No
- Real-money gambling: No

Expected result: **Everyone** (or Everyone 10+ if caffeine references are flagged)

### Target audience
- Target age groups: **18 and over** (we sell coffee; even if usable by all ages, set primary as 18+)

### Ads
- Contains ads: **No**

### App access
- All functionality is available without restrictions: **No** — some features need a Celsius account
- Provide instructions for reviewer:

```
TEST ACCOUNT
Phone: +60 11-111-1111 (reviewer account; SMS is suppressed, static OTP below)
OTP: 424242

The app loads order.celsiuscoffee.com in a Capacitor WebView. Reviewer can:
- Browse the full menu without signing in
- Sign in via OTP using the test phone above
- View their loyalty dashboard
- Place a sandbox order (no real charge)
```

### Government apps / News apps / COVID-19
- Government: No
- News: No
- COVID-19: No

### Graphic assets needed
- **App icon:** 512×512 (already generated by `@capacitor/assets`)
- **Feature graphic:** 1024×500 — REQUIRED. Brand banner for store listing top.
- **Phone screenshots:** 16:9 or 9:16, between 320px and 3840px on each side. Min 2, max 8.
- **7" tablet screenshots:** Optional but recommended.
- **10" tablet screenshots:** Optional but recommended.
- **Promo video:** Optional. YouTube URL.

---

## Reviewer test account — DB seeding

The reviewer fast-path is wired into `packages/shared/src/otp.ts` (phone `60111111111`, OTP `424242`). The phone bypasses SMS and the static OTP always verifies.

**Before submitting**, seed a member row in Supabase project `kqdcdhpnyuwrxqhbuyfl` so the reviewer can actually use the app post-login:

```sql
-- Run once before App Review submission
INSERT INTO members (phone, name, email)
VALUES ('60111111111', 'App Review Tester', NULL)
ON CONFLICT (phone) DO NOTHING;

-- Bootstrap minimal loyalty data for Celsius brand (replace brand UUID with the real one):
INSERT INTO member_brands (member_id, brand_id, points_balance, total_visits)
SELECT m.id, b.id, 100, 1
FROM members m, brands b
WHERE m.phone = '60111111111' AND b.slug = 'celsius'
ON CONFLICT (member_id, brand_id) DO NOTHING;
```

After approval and a successful first review pass, you can delete this member if desired.

---

## Asset production checklist

- [x] **Feature graphic 1024×500** at `apps/pickup/assets/feature-graphic-1024x500.png`
- [ ] **5+ screenshots** captured from real iPhone + Android device (or simulator)
  - Menu
  - Drink customisation
  - Loyalty / points
  - Order confirmation
  - Outlets / map
- [ ] Tablet screenshots (optional but boosts Android quality score)
- [ ] **Test account** wired up in the auth backend that accepts a known phone+OTP for reviewer use
- [ ] `/support` page on celsiuscoffee.com (currently 404 — Apple wants a working support URL)
- [ ] Promo video (optional, future)

---

## Submission order recommendation

1. **TestFlight (iOS)** first — internal testing, gets feedback while Google reviews
2. **Play Console Internal Testing track** in parallel — invite-only, doesn't need full store listing
3. **Closed Testing** — small group of regulars to catch real-world issues
4. **Production rollout** — staged 5% → 20% → 50% → 100% on Android; full release on iOS

---

## Risk areas for first review

- **Apple guideline 4.2 (Minimum functionality)** — apps that just wrap a website without offering native value get rejected. Mitigations baked in:
  - Push notifications (native APNs)
  - Haptics on key interactions
  - Splash screen with native feel
  - Status bar styling
- **Apple guideline 5.1.1 (Account deletion)** — must be in-app, not just a web link. **Currently account deletion is via email/in-person only.** Apple requires an in-app deletion option. *Action item: add a "Delete my account" button in app settings that POSTs to a backend endpoint.*
- **Google Play Data Safety form mismatch** — if the form says one thing and the privacy policy says another, the listing gets blocked. The mappings above are aligned with the current `/privacy` content.
- **Caffeine / health claims** — don't make health claims about coffee in the description. Current copy is safe.
