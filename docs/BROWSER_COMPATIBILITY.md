# Browser compatibility checklist

This is dated compatibility evidence, not a blanket browser-support claim. It
records one narrow, rendered pass through the public static demo using only the
repository's fictional LumaLane material.

## Evidence snapshot

- Date: 30 August 2026
- Public demo: <https://sion612.github.io/rubrictrail/>
- Deployed revision: [`0d9255bfe7724d1de72a8027ea3b1c9582a33962`](https://github.com/Sion612/rubrictrail/commit/0d9255bfe7724d1de72a8027ea3b1c9582a33962)
- OS family/version: Windows 11, 64-bit
- Firefox: Mozilla Firefox 154.0.1, the vendor Firefox release, in private mode
  with a new temporary profile; driven through geckodriver 0.37.1 and WebDriver
  BiDi
- WebKit: Playwright WebKit 26.5, build 2311, through Playwright 1.61.1 in a new
  ephemeral browser context

Playwright WebKit is not Safari. No Safari, macOS, iOS, mobile user agent, touch
device or normal browser profile was used. The Firefox and WebKit checks were a
one-off operator-driven scripted run; they are separate from the repository's
automated desktop and responsive Chromium projects.

## Approximately five-minute checklist per browser

1. Open the public demo in a new private or otherwise ephemeral browser
   context. Confirm that it starts without prior RubricTrail site data.
2. Load the fictional sample and visit **Brief**, **Rubric**, **Plan**,
   **Check**, and **Progress**.
3. Start a file-based assignment and upload only
   `samples/lumalane-assignment-brief.txt` and
   `samples/lumalane-rubric.txt`. Confirm the extracted fields against those
   files. If the conservative parser requests rubric repair, enter only the
   criterion names and published percentages present in the fictional rubric.
4. Create the project, complete the first available Action Plan item, reload,
   reopen the project and confirm that the item remains complete.
5. Download that fictional project's backup, reset/delete the project through
   **Storage & recovery**, restore the backup as a new project and confirm that
   the completed item remains complete.
6. Review page-context network activity for the complete flow. Confirm that no
   request reaches `/api/live/*`, `api.openai.com`, or an unrelated third-party
   origin.
7. Delete the downloaded backup, clear RubricTrail cookies, cache and site
   storage, reload to an empty workspace, then close the temporary context.

## Results

| Step | Firefox 154.0.1 | Playwright WebKit 26.5 | Narrow observation |
| --- | --- | --- | --- |
| 1. Private/ephemeral start | Pass | Pass | Firefox used `-private` with a new temporary profile. WebKit used a new non-persistent Playwright context. Initial RubricTrail site storage was empty in both. |
| 2. Sample and five views | Pass | Pass | The LumaLane sample rendered in Brief, Rubric, Plan, Check and Progress. |
| 3. Repository TXT files | Pass | Pass | Only the two named `samples/` files were uploaded. The parser asked for rubric confirmation in both browsers, so the five exact fictional criterion names and published weights were entered from `lumalane-rubric.txt`; the total displayed as 100%. |
| 4. Create, complete, reload | Pass | Pass | The project was created, the first Action Plan item was completed, and the checked state remained after reload and reopen. |
| 5. Backup, reset, restore | Pass | Pass | A one-project backup was downloaded, the project was deleted through Storage & recovery, the backup was restored as new, and the completed item remained complete. |
| 6. Network boundary | Pass | Pass | Firefox WebDriver BiDi observed 40 distinct page-context HTTP(S) URLs; Playwright observed 39. Every URL stayed under `https://sion612.github.io/rubrictrail/`. Neither run saw a Live API path, `api.openai.com`, an unrelated origin, a failed request, a console error or a page error. |
| 7. Cleanup | Pass | Pass | The downloaded fictional backups were deleted. Cookies, cache, local storage and session storage were cleared; reload showed an empty workspace before each temporary context closed. |

The temporary screenshots used to check that the restored Plan view was
rendered and free of a framework error overlay were deleted after inspection.
No screenshot archive, backup, browser profile, local-storage payload, console
dump, private input or identifying machine detail is committed.

## Evidence boundary

This pass does not certify complete browser support, accessibility conformance,
performance, security or every RubricTrail state. It does not add Firefox or
WebKit to CI and does not replace the existing automated Chromium regression
suite. Browser storage capacity and private-mode policy can also vary by browser
and deployment. Repeat the checklist after a material browser, persistence or
public-demo change, and record failures with fictional reproduction data only.
