# iCIMS Apply Portal Recipe

Recipes for applying on iCIMS-hosted portals (`*.icims.com`), such as Atlassian's career site (`careers-apac-atlassian.icims.com`).

## Candidate Profile & Application Flow

### Goal
Navigate the multi-step apply flow, fill profile/screening fields, and submit.

### Naive approach fails
- **Embedded iframe:** The entire application interface runs inside an iframe named `icims_content_iframe` on the parent page (`careers-apac-atlassian.icims.com/jobs/<id>/<slug>/candidate...`). Querying top-level DOM for form fields returns 0 matches.
- **Entry Gate (GDPR + hCaptcha):** Navigating to the apply URL (`mode=apply`) redirects to a login/GDPR gate with an active hCaptcha challenge. Automation cannot and must not attempt to bypass this.
- **Custom dropdowns:** Dropdowns render with an overlay anchor tag ending in `_icimsDropdown` next to the standard `<select>` element.

### Working path
1. Open the direct apply URL: `https://<tenant>.icims.com/jobs/<jobId>/<slug>/job?mode=apply`.
2. On the GDPR / login screen (`.../login`), hand off to the candidate to select "Continue", check "I accept", and solve the hCaptcha challenge.
3. Once through to Candidate Profile (`.../candidate?mode=apply...`), target the iframe:
   ```javascript
   const iframe = document.getElementById('icims_content_iframe');
   const doc = iframe.contentDocument || iframe.contentWindow.document;
   ```
4. Access and populate form fields directly in the iframe:
   - File upload: `doc.getElementById('PortalProfileFields.Resume_File')`
   - Cover letter (optional): `doc.getElementById('rcf2072_File')`
   - Personal fields: `PersonProfileFields.Email`, `PersonProfileFields.FirstName`, `PersonProfileFields.LastName`, `3803250_PersonProfileFields.PhoneNumber`, address fields.
   - Experience blocks: `[id$='_PersonProfileFields.rcf3212']` (Employer), `...rcf3213` (Title), `...rcf3214_*` (Start Date), `...rcf3215_*` (End Date — leaving empty indicates current position).
   - Dropdown selections: update the value on the underlying `<select>` element (e.g. `doc.getElementById('rcf2037')` for prior employment, `rcf2117` for recording consent).
5. Submit the profile step by clicking `doc.getElementById('cp_form_submit_i')` ("Update Profile").
6. Wait 3–5 seconds for the iframe to navigate to `.../job?mode=submit_apply&in_iframe=1`.
7. Verify success banner: `"Your application was submitted successfully. Thank you for applying."` and record the requisition number (e.g. `ID: REQ-2026-2277`).
8. Take a screenshot of the confirmation page and run `app evidence` and `app submitted`.

### Verified
- **Date:** 2026-10-01
- **Tenant:** Atlassian (Principal Data Engineer, REQ-2026-2277)

## Arm tenant (experienced-arm.icims.com) — full apply flow, verified 2026-10-11

**Goal:** apply to req 2026-17408 end to end (gate → 3-step form → submitted).

**Naive approach fails:**
- The gate's custom dropdowns, the CV uploader, and the step forms each need their own trick (below); a synthetic (untrusted) click on the profile form's submit button does NOT submit — a real trusted input click is required (driving from a real browser via bsk/extension CDP works; in-page `el.click()` does not).
- Chrome blocks CDP access to the whole tab when ANY other extension injects a frame into the page (job-portal autofill extensions do exactly this on ATS pages). Symptom: "Cannot access a chrome-extension:// URL of different extension". Remedy: disable the offending extension; nothing else clears it (navigating away and back re-arms it).
- BrowserSkill/bsk additionally needs "Allow access to file URLs" (chrome://extensions → Details) or the CV upload fails with `{"code":-32000,"message":"Not allowed"}`.

**Working path:**
1. Gate: fill email, set `gdpr_consent_type` to "I accept" (value `37002057001`), tick `accept_gdpr`, click `input#enterEmailSubmitButton`. hCaptcha here is `size=invisible` and passes passively — no challenge appeared.
2. AJAX dropdowns (country code, state, school, degree, major, all rcf* questions): options are NOT in the DOM until the widget opens. Their option data comes from `/jobs/profileoptions?in_iframe=1&q=<search>&page=0&size=25&parentValue=&id=<fieldId>&hash=<hash>` returning clean JSON `{total, options:[{text,value}]}`. Set the hidden `<select>` value, dispatch `change`, and sync the visible label in `#<id>_fakeSelected_icimsDropdown`. (Same-origin iframe: `document.getElementById('icims_content_iframe').contentDocument`.)
3. The whole form re-renders on submits and re-renders **wipe `input[type=file]`** — the filename chip can stay while `files.length` reads 0. Attach the CV (`DataTransfer` + change, or bsk upload) immediately before clicking submit, and verify `files.length===1` in the same breath. Employment-block field suffixes change every render (`-347905_…` → `-361793_…`) — always re-resolve `input[id$='_PersonProfileFields.rcf3212']`.
4. The resume parser scatters fragments into the employment blocks ("Jun 2022 - Se" into a company field, "PrIncipal SoFtwAre Engineer" with mangled casing into a title field). Scrub every block except the one you fill.
5. **A "leave blank if this does not apply" field can still be required.** On the Equal Opportunities Survey, `RecentResidencyCountry` ("Select the applicable country, or leave blank if this does not apply.*") hard-fails validation when blank; the honest value "Not Applicable" is the first real option. Selecting work-country India spawns extra required India EO fields via a dependent-action POST (`getFormFieldDependentAction`) — the form re-renders into a CROSS-ORIGIN nested iframe (`arm.icims.com`), so in-page JS can no longer reach it; drive it by refs/CDP (bsk sees it fine).
6. **There is no review page.** The Step-2 Submit IS the application submit (`mode=submit_apply&from=assessment`; Step 3 "Assessments" can be empty). Stage everything BEFORE Step 2's Submit — after it, "That's it! Your application is now on its way… You are currently submitted to this job." with the Dashboard row as proof. No confirmation number on this tenant.
7. Noise: a "Candidate Experience Survey" modal re-appears repeatedly and eats clicks (dismiss via its X each time); a Survale iframe once opened newsroom.arm.com in a stray tab.

**Verified:** 2026-10-11, req 2026-17408, submitted, Dashboard row "Under Review".
