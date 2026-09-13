# Medinet availability controls

Verified 2026-09-13. The availability UI lives in `review/site/medinet-availability.js` and its dedicated stylesheet. Keep semantic occupancy colors independent of the global reading theme.

| Occupied percentage | Color |
| --- | --- |
| 0 through 25 | Red |
| Over 25 through 50 | Orange |
| Over 50, below 75 | Yellow |
| 75 through 100 | Green |
| Missing/inconsistent counts | Neutral, unknown |

Cells show **free / total**, while their color represents **occupied / total**. This preserves the original available-slot counts. Total is the current feed's free-plus-occupied count; it does not include independently verified blocked capacity. An absent day does not prove a closed or fully booked schedule. Legacy snapshots only contain dates with free slots, so the interface cannot reconstruct a fully booked day missing from the source. Explicit zero-free records with a valid total display correctly.

Selecting a professional resets the branch filter to all of that professional's known branches. The professional list is independent of the branch filter. Refresh preserves valid selections. Details identify both professional and branch; they open by mouse, touch, or keyboard, and close explicitly or with Escape.

Overlap alerts compare free offers for the same professional ID and day across all branches, including branches hidden by the filter. Known appointment duration permits interval comparison; absent duration only permits flagging identical start times as possible conflicts. These are conflicting offers, **not proof of double-booked appointments**. Telemedicine alerts ask staff to verify absence of listed slots. Cached data older than 20 minutes requires rechecking.

## Schedule mutation discovery

All live Medinet requests originated from the existing Chilean VPS using the configured service account. No schedule changes were performed.

| Endpoint | Verification | Implication |
| --- | --- | --- |
| `/token-login/` | Authenticated successfully | Current service credentials work |
| `/api/` | GET 200; DRF directory | Identifies endpoints, not permission to use them |
| `/api/agenda/horarios-profesionales/` | OPTIONS 403 | Write permission/schema unverified |
| `/api/agenda/aperturas/` | OPTIONS 403 | Write permission/schema unverified |
| `/api/agenda/bloqueos/` | OPTIONS 403 | Write permission/schema unverified |
| `/api/agenda/bloqueos-feriados/` | OPTIONS 403 | Write permission/schema unverified |
| `/api/agenda/citas/` | OPTIONS 403 | Write permission/schema unverified |
| `/api-public/schedule/appointment/all-appointments/{from}/{to}/` | GET 200 for requested test date | Appointment reading works; not availability editing |
| `/api/agenda/citas/proximos-cupos-all/{branch}/` | Existing sync integration | Availability reading; not schedule editing |
| `/api/agenda/citas/add/?format=json` | Existing session-based worker code only; not invoked | Appointment creation is distinct from opening professional schedules |

The `Allow` header lists route methods even on a 403 response and does not establish authorization. Do not switch accounts to circumvent a denial. For a future controlled test, require a specific professional, branch, date, operation, and start/end time, plus authorized write access or an authenticated Medinet UI exposing the action. Inspect existing appointments before changing anything; verify the result and retain a concrete rollback plan.

## Verification

`REVIEW_TEST_JSDOM_PATH=/path/to/jsdom/lib/api.js node --test tests/medinet-availability.test.mjs`

Tests cover threshold boundaries, explicit zeros, unknown counts, multi-branch filtering, interval overlaps, qualified alerts, exact-branch popup contents, selection persistence, keyboard closing, and failed refresh handling.
