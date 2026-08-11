# Visual QA report

Date: 12 August 2026  
Targets: desktop 1440×900 and mobile 390×844  
Method: production build served on `127.0.0.1`; Browser plugin unavailable, so
the documented Playwright/installed-Chrome fallback was used for the saved
screenshots. Current functional browser coverage runs in GitHub Actions.

## Evidence

| Artifact | Purpose |
| --- | --- |
| `docs/design/rubrictrail-workspace-concept.png` | Image-generated visual direction |
| `docs/assets/rubrictrail-workspace.png` | Final desktop production viewport |
| `docs/assets/rubrictrail-mobile.png` | Final mobile production viewport |

The capture script creates a fictional TXT project, confirms a 100% rubric,
opens the rubric view and, on desktop, opens the exact retained source excerpt.
It waits for the local-save toast to leave before capturing.

## Concept-to-product comparison

| Design intent | Final implementation | Assessment |
| --- | --- | --- |
| Warm ivory canvas, dark ink, deep teal and restrained amber | The same trust-oriented palette is used across content, state and warning surfaces | Faithful |
| Five explicit workflow states | Desktop uses a persistent left rail; mobile uses a horizontally scrollable state strip with labels | Faithful, responsively adapted |
| Assignment identity, due date, word count and local mode visible together | A project context line sits below the header and a Local-only badge stays in the header | Faithful |
| Criterion, weight, confirmation state and source appear in one scan path | Desktop rubric rows preserve all four fields; mobile stacks the source below each row | Faithful, responsively adapted |
| Source evidence opens beside the work rather than replacing it | A modal side drawer retains filename, page when available and exact excerpt | Faithful |
| One dominant next action | The rubric ends in **Build action plan**; secondary navigation stays visually quieter | Faithful |
| Trust language avoids invented grades or semantic certainty | The UI says weights are user-confirmed, progress is work completion and self-checks record human judgment | Strengthened |

## Deliberate deviations

- The concept placed the workflow across the top. The product uses a left rail
  on desktop so long labels and real state descriptions remain readable.
- The concept showed four mixed-status criteria. The final screenshot uses three
  fully source-linked criteria because the fictional upload contains exactly
  three rows; the product never invents a fourth.
- The mobile artifact is a viewport screenshot, not a stitched full-page image.
  This avoids false placement of sticky header and workflow elements.
- The final evidence drawer is an overlay with a focus trap, Escape close and
  focus restoration. Opening it uses `preventScroll` so the background heading
  stays in place.

## Interaction and layout checks

- 16/16 Playwright flows passed in GitHub Actions across desktop and mobile,
  including targeted 320×700 mixed-batch, paste and error states.
- Navigation and local-project creation reset the workspace to the top.
- The active mobile workflow step scrolls into view.
- Evidence drawer keyboard trapping, Escape close and focus restoration pass.
- Document width remains within the viewport in tested desktop/mobile states.
- The production screenshots contain no Next.js development badge.

The screenshots predate the v0.3.1 paste form and v0.3.2 mixed-batch review.
Those flows have browser assertions for focus, text size, explicit recovery,
privacy and overflow, but no new local screenshot comparison because Playwright
permission was not granted in this task. The saved screenshots are product
evidence, not claims of external usability or accessibility validation. External
student testing remains a roadmap item.
