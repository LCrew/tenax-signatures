# Pilot checklist: Outlook signature add-in

Covers brief §8.4 and phase 3 acceptance: the signature is inserted in new Outlook, classic Outlook and OWA **without duplicates**, and it follows group changes after the caches expire.

Tick each cell with `[x]`, or write `FAIL` plus a note number. `n/a` means the platform doesn't support the scenario (see the notes).

---

## 0. Preparation (done by the admin, by hand)

- [ ] Licensed test mailbox exists, e.g. `sig.test@tenaxgrupa.lv` (created by the admin, **not** by any script).
- [ ] Test mailbox is a member of `SG-Signature-Pilot` **and exactly one** company group (start with `SG-Signature-Tenax`).
- [ ] A shared mailbox with an entry in `config/shared_mailboxes.json` (or the admin UI) mapped to a **different** company. The test user has *Full Access* + *Send As* on it.
- [ ] Entra setup done ([entra-setup.md](entra-setup.md)): admin consent granted, certificate uploaded, setup wizard completed.
- [ ] `https://sig.tenaxgrupa.lv/healthz` returns OK.
- [ ] `https://sig.tenaxgrupa.lv/.well-known/microsoft-officeaddins-allowed.json` lists `https://sig.tenaxgrupa.lv/addin/launchevent.js`.
- [ ] `https://sig.tenaxgrupa.lv/addin/launchevent.js` starts with `globalThis.__SIG_CONFIG__ = {…}` containing the right `apiBase`, `clientId`, `apiScope` and `tenantId`.
- [ ] Add-in uploaded in the M365 admin center (Integrated apps) and assigned **only** to `SG-Signature-Pilot`. Record the date and time: ____________ (propagation can take **up to 24 h**).
- [ ] Admin UI preview for the test user shows the expected company template (new + reply).
- [ ] Client versions noted:

| Client | Version / build | Tester | Date |
|---|---|---|---|
| New Outlook for Windows | | | |
| Classic Outlook for Windows (M365 Apps) | | | |
| Outlook on the web (Edge/Chrome) | | | |
| Outlook for Mac | | | |
| Outlook iOS | | | |
| Outlook Android | | | |

Minimum versions: classic Outlook needs Windows 10 1903+, event-based activation (Mailbox 1.10) and, for the From switch, Version 2304+. NAA SSO needs Version 2409+; older builds fall back to Office SSO. Mac needs 16.77+ for the From switch. Mobile needs 4.2502+ for the From switch.

## 1. Insertion matrix

For each cell: open a fresh compose window, wait up to 5 s, then check the signature is there **and** matches the expected company and type (full `new` vs compact `reply`).

| Scenario | New Outlook (Win) | Classic Outlook (Win) | OWA | Mac | iOS | Android |
|---|---|---|---|---|---|---|
| New mail: full signature | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Reply: compact signature | [ ] | [ ] | [ ] | [ ] | [ ] ¹ | [ ] ¹ |
| Reply all: compact signature | [ ] | [ ] | [ ] | [ ] | [ ] ¹ | [ ] ¹ |
| Forward: compact signature | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| New meeting invite (organizer): full signature | [ ] | [ ] | [ ] | [ ] | n/a ² | n/a ² |
| Shared-mailbox **From** switch: signature changes to the shared mailbox's company | [ ] | [ ] | [ ] | [ ] | n/a ³ | n/a ³ |
| Switch **From** back to own address: own signature returns | [ ] | [ ] | [ ] | [ ] | n/a ³ | n/a ³ |
| **No duplicate signature** (Outlook's own signature suppressed) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Images load** (logo shows, no "download pictures" block for internal recipients, correct size) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Dark mode**: logo and text readable, no invisible transparent logo | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Received side: the sent message renders correctly for an external recipient (e.g. Gmail) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Latvian diacritics (ā ē ī ū š ž ņ ļ ķ ģ č) intact in the sent message | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Compose is never blocked: with the API unreachable (step 4), a new mail opens normally without a signature | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Notes:
1. On mobile, **Reply** from the bottom of a message inserts the signature, but it only shows after expanding the compose window to full screen (Microsoft limitation).
2. Outlook mobile doesn't raise `OnNewAppointmentOrganizer`.
3. Outlook mobile doesn't support delegate or shared-mailbox scenarios for `OnMessageFromChanged`.

### How to check "no duplicate signature"

- Give the test user a **local Outlook signature** (Settings → Signatures, set as default for new messages *and* replies/forwards) in each client before testing.
- Expected: only the company signature appears. The add-in calls `disableClientSignatureAsync()` before `setSignatureAsync()`.
- Classic Outlook: also check with roaming signatures turned on. After the add-in runs, **File → Options → Mail → Signatures** may show *(none)* as the default for that account, because `disableClientSignatureAsync` turns off the client default. That is expected.
- Mobile: a locally saved signature may flash briefly before it's replaced. That's expected.

### Dark mode

- Windows: **File → Office Account → Office Theme: Black**, and the compose "switch background" (sun/moon) toggle.
- OWA / new Outlook: Settings → General → Appearance → Dark mode.
- Mac: macOS dark appearance. iOS/Android: system dark mode.
- Check both **while composing** and **the received message** in dark mode.

## 2. Group switch after cache expiry

The API caches **resolved user data for 10 minutes** and **group memberships for 30 minutes**. The admin UI has a **Clear cache** button to skip the wait.

| Step | Action | Expected | Result |
|---|---|---|---|
| 1 | Test user is in `SG-Signature-Tenax` only. New mail. | Tenax design | [ ] |
| 2 | Admin moves the user from `SG-Signature-Tenax` to `SG-Signature-Vareno` in Entra. Note the time: ______ | | [ ] |
| 3 | Straight away, new mail. | **Still Tenax** (cached), which is fine | [ ] |
| 4 | After **30+ minutes** (group cache TTL), new mail. | **Vareno design** | [ ] |
| 5 | Admin UI → user detail → preview | Vareno, resolved via *group* | [ ] |
| 6 | Move the user to `SG-Signature-TenaxPanel`, then press **Clear cache** in the admin UI. New mail. | **TenaxPanel design** within about 1 minute | [ ] |
| 7 | Add the user to **two** company groups. Clear cache. New mail. | Priority winner per `config/companies.json`; conflict shown in the data-quality report | [ ] |
| 8 | Remove the user from **all** company groups. Clear cache. New mail. | `defaultCompany` design; user flagged in the report | [ ] |
| 9 | Set an admin override (e.g. `jobTitleLv`) in the admin UI. New mail after ≤10 min (or after Clear cache). | Override title shown | [ ] |
| 10 | Put the user back in the original company group. | Original design | [ ] |

## 3. Pilot rollout for a second person (optional)

- [ ] Add one real colleague (with their consent) to `SG-Signature-Pilot` and one company group. After up to 24 h they get the signature in their main client with no duplicate.

## 4. Failure behaviour

- [ ] Make the API unreachable for the pilot (e.g. stop the container briefly **in a test window**). New mail opens immediately with no signature and no error dialog, and no hang beyond about 5 s.
- [ ] Bring the API back. Telemetry entries show `stage: fetch` failures from the outage window (check the API logs / telemetry view).
- [ ] Temporarily revoke consent in a **test tenant only** (not production) → telemetry shows `stage: token`.

## 5. Troubleshooting aids

- Classic Outlook runtime logging: registry `HKCU\SOFTWARE\Microsoft\Office\16.0\WEF\Developer\RuntimeLogging` → set the default value to a log file path. Remove it afterwards.
- New Outlook / OWA: the browser DevTools console for the add-in frame (`launchevent.html`).
- Add-in not activating at all: check that the add-in shows under **Get Add-ins → My add-ins → Admin-managed**. Remember the 24 h propagation. Restart Outlook.
- Signature missing only in classic Outlook: check the well-known JSON and that `launchevent.js` loads over HTTPS without redirects.

## 6. Sign-off

| Role | Name | Date | Decision (go / no-go to production assignment) |
|---|---|---|---|
| IT admin | | | |
| Business owner | | | |

After go: reassign the add-in to the whole organisation (admin center, or `scripts/deploy-addin.ps1 -Production`), and allow up to 24 h.
