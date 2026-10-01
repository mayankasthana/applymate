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
