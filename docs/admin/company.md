# Company & entity administration

Registration, ownership, company secretary, and banking for each entity.
Mask account numbers to last 4 digits; link full documents in Drive.

⚪ = pre-filled 2026-08-31 from the data estate (`Outlet.companyName/regNo`
receipt-header fields, `fin_companies`, finance docs) — needs owner
verification. ✅ = owner-confirmed 2026-08-31 (e-invoice registration
details). Blank = owner to share.

All three entities share the same registered/e-invoice address and phone
(✅ owner): **K-3-01, Conezion City, Persiaran IRC 3, IOI Resort, 62502
Putrajaya** · Tel 017-209 6058.

**The business is THREE sister companies**, mapped to outlets as follows
(⚪ from `Outlet` rows):

| Entity | Outlets |
| --- | --- |
| Celsius Coffee Sdn. Bhd. | Shah Alam (CC002), Nilai (consignment) |
| Celsius Coffee Conezion Sdn. Bhd. | Putrajaya/Conezion (CC001) |
| Celsius Coffee Tamarind Sdn. Bhd. | Tamarind, Cyberjaya (CC003) |

(IOI Mall outlet has no entity recorded — owner to confirm which company it
sits under.)

## Entity: Celsius Coffee Sdn. Bhd.

| Field | Value |
| --- | --- |
| Registered name | ✅ CELSIUS COFFEE SDN. BHD. |
| SSM registration no. | ✅ 202101024485 (1424785-A) — owner-confirmed 2026-08-31, resolving the earlier conflict; `fin_companies.brn` previously held `201501026187` (wrong — corrected in DB same day; if that number meant something else, note it here) |
| TIN (MyInvois) | ✅ C26773249100 |
| SST | ✅ not registered (N/A) |
| Entity type | ⚪ Sdn. Bhd. |
| MSIC code | ⚪ 56101 (restaurants/cafés) |
| Registered address | ✅ K-3-01, Conezion City, Persiaran IRC 3, IOI Resort, 62502 Putrajaya |
| Business address | ⚪ 58, Jalan Renang 13/26, Tadisma Business Park, 40100 Shah Alam, Selangor |
| Financial year end | |
| Annual return due | → also add to `renewals.md` (cosec to confirm date) |
| ~2025 revenue | ⚪ ≈ RM2.5M (e-invoice scoping doc) |

## Entity: Celsius Coffee Conezion Sdn. Bhd.

| Field | Value |
| --- | --- |
| Registered name | ✅ CELSIUS COFFEE CONEZION SDN. BHD. |
| SSM registration no. | ✅ 202501044958 (1646366-U) — incorporated 2025 |
| TIN (MyInvois) | ✅ C60421230050 |
| SST | ✅ not registered (N/A) |
| Entity type | ⚪ Sdn. Bhd. |
| MSIC code | ⚪ 56101 |
| Registered address | ✅ K-3-01, Conezion City, Persiaran IRC 3, IOI Resort, 62502 Putrajaya |
| Business address | ⚪ M-G-06 Persiaran IRC3, IOI City Resort, 62502 Putrajaya |
| Financial year end | |
| Annual return due | → `renewals.md` (cosec to confirm) |

## Entity: Celsius Coffee Tamarind Sdn. Bhd.

| Field | Value |
| --- | --- |
| Registered name | ✅ CELSIUS COFFEE TAMARIND SDN. BHD. |
| SSM registration no. | ✅ 202501036872 (1638282-K) — incorporated 2025 |
| TIN (MyInvois) | ✅ C60337963100 |
| SST | ✅ not registered (N/A) |
| Entity type | ⚪ Sdn. Bhd. |
| MSIC code | ⚪ 56101 |
| Registered address | ✅ K-3-01, Conezion City, Persiaran IRC 3, IOI Resort, 62502 Putrajaya |
| Business address | ⚪ K-05, Level 3m, Tamarind Square, Persiaran Multimedia, 63000 Cyberjaya, Selangor |
| Financial year end | |
| Annual return due | → `renewals.md` (cosec to confirm) |

## Directors / shareholding (Celsius entities)

_PENDING — owner to share (per entity)._

| Entity | Name | Role | Shareholding |
| --- | --- | --- | --- |
| | | | |

---

# Group: GOSAME (Korean-cuisine F&B venture)

✅ From SSM incorporation packs (Section 14/17) + LHDN TIN notices, owner-
provided 2026-08-31. Both companies: MSIC 56101a (restaurants), business
description "F&B including restaurants specializing in Korean cuisine".
Registered address (cosec office): No. 12-1, Jalan PPS 2, Pusat Perniagaan
Selaseh, 68100 Batu Caves, Selangor. Business address: M-G-06, Conezion
City, Persiaran IRC 3, IOI Resort, 62502 Putrajaya. Source PDFs contain
NRIC/DOB/home addresses → repo gets none of that; owner to park the packs
in Drive and paste links below.

## Entity: Gosame International Sdn. Bhd. (holding + operating)

| Field | Value |
| --- | --- |
| SSM registration no. | ✅ 202601006195 (1668293-M), incorporated 2026-02-11 |
| TIN (MyInvois) | ✅ C60579873070 |
| Employer TIN (E) | ✅ E9628007204 — LHDN WP Kuala Lumpur |
| Share capital | ✅ 3,150 ordinary @ RM1 |
| Financial year end | |
| Drive link (SSM pack) | |

Shareholding: ✅ Ammar Bin Shahrin 1,260 (40.0%) · Ammar Bin Roslizar
1,190 (37.8%) · Moon Byongjoon (South Korea) 700 (22.2%).
Directors: ✅ Ammar Bin Shahrin, Ammar Bin Roslizar.

## Entity: Gosame Bukit Tunku Sdn. Bhd. (subsidiary)

| Field | Value |
| --- | --- |
| SSM registration no. | ✅ 202601006713 (1668811-A), incorporated 2026-02-13 |
| TIN (MyInvois) | ✅ C60583422090 |
| Employer TIN (E) | ✅ E9628082601 — LHDN WP Kuala Lumpur |
| Shareholding | ✅ 100% Gosame International Sdn. Bhd. (10,000 ordinary @ RM1) |
| Directors | ✅ Ammar Bin Shahrin, Ammar Bin Roslizar |
| Financial year end | |
| Drive link (SSM pack) | |

Operating location: "Bukit Tunku" implies a restaurant site in Bukit
Tunku, KL — PENDING owner: premises address, tenancy, licences (these get
their own sections in `outlets.md`/`licenses.md` once trading).

---

## Company secretary

✅ Lodging secretary for both Gosame incorporations (and the MYDATA user
that printed the certs): **AAS Premium — Norazah Binti Mohd Kasim**
(MIA 46630), secretary@aaspremium.com, office 03-6177 0812 /
014-307 1812, Batu Caves/Rawang. ⚪ Presumably also cosec for the three
Celsius entities — owner to confirm.

| Field | Value |
| --- | --- |
| Firm / name | ✅ AAS Premium — Norazah Binti Mohd Kasim (MIA 46630) |
| Contact | ✅ secretary@aaspremium.com · 03-6177 0812 · 014-307 1812 |
| Retainer / fees | |

## Bank accounts

⚪ The estate shows **3 company accounts, all Maybank** (Bukku bank feed,
owner-confirmed complete set) — presumably one per entity. Owner to confirm
mapping + last-4.

| Bank | Account (last 4) | Entity | Purpose | Signatories |
| --- | --- | --- | --- | --- |
| Maybank | | Celsius Coffee Sdn. Bhd. | | |
| Maybank | | Celsius Coffee Conezion Sdn. Bhd. | | |
| Maybank | | Celsius Coffee Tamarind Sdn. Bhd. | | |

## BERBUKA@CELSIUS

_PENDING — owner to confirm whether this brand sits under one of the three
entities above or its own registration._

## Key documents (Drive links)

| Document | Entity | Drive link | Last updated |
| --- | --- | --- | --- |
| SSM certificate / Section 17 | ×3 | | |
| Constitution | ×3 | | |
| Latest annual return | ×3 | | |
