# ARES interface design guidance

This guide defines the visual and writing conventions for the Mars data center site-planning app. Use the approved **Mission brief** composition and **Cinematic outline** typography as the foundation: a prominent planetary or terrain view, a compact working panel, and restrained information that helps people make a decision.

**Status:** Mission brief layout, Cinematic outline typography, and Practical guidance copy are selected. Apply Practical guidance throughout the app, including the landing page. ARES remains a working name. Detailed component dimensions, accessibility refinements, and extensions to later screens are implementation guidance, not additional user-approved designs.

## 1. Visual character

The interface should feel exploratory, spacious, and technically credible. Warm outlined display lettering gives the opening a cinematic character; quiet, solid text carries the actual work. The globe and terrain supply the visual richness.

- Give the map the largest share of the composition.
- Use dark, opaque panels so information stays legible against the imagery.
- Reserve outlined typography for branding and the landing headline.
- Use the warm accent for the primary action, selection, and keyboard focus.
- Use atmosphere around the planet sparingly. Avoid glowing text, animated starfields, scrolling crawls, decorative instrument readouts, or spaceship-console framing.
- Keep the established base visible as context. A global opening does not imply that local candidate sites are distributed across the whole planet.

## 2. Color tokens

These colors come from the current Cinematic outline mockup. The initial product direction is intentionally dark; do not automatically invert the planetary scene with the operating-system theme.

| Token | Value | Use |
| --- | --- | --- |
| `space` | `#070B0F` | Application background |
| `panel` | `#111920` | Forms, inspectors, and opaque overlays |
| `field` | `#070D12` | Editable input background |
| `text-primary` | `#F4F1E9` | Headings, values, and control labels |
| `text-secondary` | `#AEB7BD` | Helper text, descriptions, and metadata |
| `border` | `#354048` | Quiet dividers and panel boundaries |
| `accent` | `#EDC49B` | Outline lettering, primary actions, selection emphasis |
| `accent-hover` | `#F6D8B9` | Hovered primary action |
| `accent-ink` | `#1D211F` | Text on filled accent buttons |
| `selected` | `#302A25` | Selected option background |
| `surface-hover` | `#29353E` | Hovered secondary controls |

Border color alone must not be the only way to recognize an interactive control. Keep a visible label, shape, or native input indicator. Validate contrast in the implemented states, including disabled, focused, and selected controls.

### Assessment colors

Keep assessment status separate from the brand accent. The following semantic colors are proposed for later evaluation screens, not scientific thresholds:

| Status | Proposed color | Required accompanying label |
| --- | --- | --- |
| Meets an established screening criterion | `#B8DFC2` | “Meets screening criterion” |
| Requirement conflict | `#FFB19B` | Specific conflict, such as “Footprints overlap” |
| Missing evidence | `#E3C78F` | “Unresolved” or the missing measurement |

Never encode pass, fail, or unknown only with color. An unknown is not a failed requirement, and a green footprint is not construction approval.

## 3. Typography

Use **Audiowide** for display lettering and **Space Grotesk** for the rest of the interface. Load the actual families; do not substitute a different futuristic font on individual screens. Use a system sans-serif fallback while fonts load.

| Role | Family and treatment | Desktop target | Narrow-screen target |
| --- | --- | --- | --- |
| ARES wordmark | Audiowide 400, uppercase, 1 px accent outline | 28 px, tracking 3 px | 24–28 px |
| Landing headline | Audiowide 400, uppercase, 1 px accent outline | 37 px / 1.23, tracking −1 px | 30 px / 1.23 |
| Panel heading | Audiowide 400, solid primary text | 21–22 px / 1.35 | 21 px |
| Section heading or card title | Space Grotesk 500 | 14–16 px / 1.4 | Same |
| Body copy and form labels | Space Grotesk 400–500 | 14 px / 1.5 | Same |
| Helper text and metadata | Space Grotesk 400 | 12 px / 1.5 | Same |
| Input values | Space Grotesk 400 | 16 px minimum; 24 px for fleet totals | Same |
| Buttons | Space Grotesk 500 | 14 px | Same |

The earlier prototypes contain some 9–11 px supporting text. Do not adopt those sizes as the production standard. Use at least 12 px for meaningful guidance and metadata, and keep mobile editable fields at least 16 px.

Outline lettering works only at display sizes against a quiet background. Do not apply it to form labels, tables, descriptions, errors, or map annotations. If the outline cannot render legibly, use solid accent lettering. Use sentence case for functional text. Use tabular numerals for aligned measurements and changing values.

## 4. Composition and spacing

Use a 4 px spacing foundation: 4, 8, 12, 16, 24, 32, 48, and 64 px.

- **App header:** approximately 80 px tall, with the wordmark at left and base context at right. Use 24–32 px horizontal padding on desktop and 16–20 px on small screens.
- **Landing:** a left text column around 280–340 px wide and a dominant globe to the right. Group headline, supporting paragraph, and primary action together. Aim for a short paragraph of two or three lines rather than adding copy to fill empty space.
- **Intake:** replace the left introduction with a panel around 360 px wide. The globe remains visible and interactive. Keep 24 px panel padding, 20–24 px between field groups, and 6–8 px between a label and its supporting text.
- **Results:** retain the same panel position, title scale, and card treatment. Each candidate has a name, a concise reason to investigate it, and access to its unresolved questions.
- **Narrow screens:** stack the globe and working panel. Preserve text size rather than squeezing the desktop layout. Let the page grow vertically; avoid clipped forms and nested scrolling.

Keep negative space where it supports focus. Restore useful text when the screen feels unexplained; adjust spacing when the screen merely feels empty. Do not create a paragraph solely to occupy a gap.

## 5. Component conventions

| Component | Convention |
| --- | --- |
| Primary button | Filled accent, dark text, 7–8 px radius; one main action per task region |
| Secondary button | Panel background, quiet 1 px border, solid primary text |
| Text action | Short verb such as “Edit” or “Close”; accessible focus state |
| Panel | Opaque panel background, 1 px border, 12 px radius |
| Option row | Native checkbox, clear title, optional one-line example; entire row clickable |
| Selected option | Warm tinted surface and accent border plus checked indicator |
| Number input | Visible label and units; retain entered value when moving between steps |
| Candidate card | Name, one reason to investigate, selected state; show the next check on selection |
| Disclosure | “Assumptions” or “Credits”; supplemental details, not information required to make the current choice |
| Icons | One consistent outline icon family, approximately 16–20 px; no decorative icon collections |

Use visible focus rings, native semantics, and accessible names for icon-only controls. Make touch targets at least 44 × 44 px. Preserve keyboard alternatives to globe gestures and component manipulation.

## 6. Writing and helper text

Keep text when it does at least one of these jobs:

1. Explains what the app will do next.
2. Clarifies an ambiguous input, unit, or choice.
3. Explains a consequence that affects a decision.
4. Supplies evidence, uncertainty, or a useful next action.
5. Establishes the opening's voice through a short, relevant supporting sentence.

Remove text that merely repeats a nearby label, reassures without adding information, or explains implementation details. Visual balance is a reason to consider a supporting paragraph, not a reason to invent filler.

### Placement rules

- Allow one supporting paragraph under the landing headline.
- Use one concise helper line per field only when needed; do not automatically populate every field with help.
- Keep examples close to the relevant workload choice.
- Explain the consequence of scheduling flexibility once, beside that choice.
- Keep the demo qualification next to the candidate results. Do not repeat the same disclaimer on every card.
- Move longer assumptions and attribution to disclosures. Keep decision-critical limitations visible.
- Give errors a concrete correction: “Enter a whole number greater than zero.”
- Keep accessible descriptions even when visible hints are shortened or removed.

### Selected copy treatment

| Surface | Practical guidance |
| --- | --- |
| Landing support | “Describe your construction project to explore locations for its supporting data center.” |
| Intake introduction | “Tell us what you are building, which robots will work, and when you need results.” |
| Workload examples | One short example per option; do not turn technical choices into marketing copy. |
| Scheduling | “Flexible processing jobs can run when power is available.” |
| Results introduction | “Compare the tradeoffs, then select an area to see what needs checking.” |

Use this direct, informative voice consistently across screens. Shorten it where task density requires, while retaining information needed to understand a choice or its consequence. Do not substitute the longer Editorial balance treatment on the landing page.

## 7. Intake and evidence conventions

The workflow is construction inputs → estimated facility → five location requirements → candidate comparison. Start with construction type and extent, robot roles/counts, operating schedule, and update deadlines. Offer precision, duration, growth, and existing infrastructure as follow-up inputs. See [input specification](construction-project-inputs.md).

Owners do not enter rack counts or complex dimensions. Offer “unknown” where appropriate, display important profile assumptions, and ask follow-up questions that materially change the estimate. Do not turn robot count into a fixed kW or land-area multiplier. Separate construction fleet quantities from computing-module delivery and investigation vehicles.

The facility preview shows options or ranges for compute, storage, power, heat rejection, and complete footprint. Distinguish owner input, model assumption, equipment specification, and computed output. Until implemented, show the sizing stage as planned and label any sample result “Illustrative reference — not calculated from your project.” Never present the legacy reference facility as an interactive estimate.

The requirement view explains why each site constraint exists. The comparison view records the facility version and any site-specific layout changes. Keep the existing visual direction; older HTML copy mockups are historical visual references where their intake conflicts with this workflow.

Candidate feedback must distinguish observations, derived estimates, modeled results, assumptions, and missing evidence. Never hide a critical conflict inside an average score. Use “candidate,” “screening,” and “requires measurement” where appropriate. Preserve a smaller base-integrated installation as a possible outcome.

### Construction intake alternatives

[The construction intake mock](../design-reference/mars-construction-intake.html) incorporates the construction-owner inputs in two interactive alternatives. Neither alternative has been selected yet.

- **Guided brief:** project, robots, operations, and review steps, with a persistent project summary and Mars illustration.
- **Project worksheet:** project and fleet editing in one view, with expandable schedule/output details and a brief summary.

Both use editable example values, known/range/unknown quantity controls, robot roles and active counts, requested outputs, deadlines, and a pending five-factor handoff. They are interaction prototypes, not the complete request-schema implementation. Detailed map selection, multi-phase schedules, technical profiles, sizing, and feasibility remain outside this mock. The earlier copy-balance mock remains a historical visual reference.

## 8. Extending the style to later screens

- **Candidate comparison:** use the same solid body typography and quiet panel surfaces. Align factors and units. Keep conflicts and unknowns in separate fields.
- **3D layout editing:** keep upright translucent component footprints, with move and rotation controls anchored to the selected object. Distinguish camera navigation from object manipulation. Highlight the affected geometry and explain the issue in the inspector.
- **Investigation planning:** connect each task to a location, an unresolved question, and the decision it may change. Use the existing card and button system.
- **Findings:** show what changed, the supporting observation, and the affected candidate or layout. Retain prior assessments for comparison.

Use the cinematic display treatment sparingly on these task-heavy screens. Carry continuity through color, typography families, spacing, and component behavior rather than repeating the landing headline style everywhere.

## 9. Motion, resilience, and review

The globe moves in response to the user; do not add automatic spinning, looping effects, or unrequested audio. Use brief transitions to preserve spatial continuity, and respect reduced-motion preferences. If imagery cannot load, show an honest fallback state without implying the visual is a real terrain assessment.

Before shipping a screen, check:

- The approved fonts, color tokens, and component treatments are used consistently.
- One main action is clear; supporting copy adds information rather than repetition.
- Text and controls remain legible at narrow widths and browser zoom.
- Focus, keyboard access, touch targets, and contrast are verified in the actual implementation.
- Unknowns, conflicts, and positive screening results are distinguishable without color.
- Camera controls and component controls do not compete for the same gesture unexpectedly.
- Back, edit, and close preserve user input as intended.
- Scientific-looking imagery and measurements have appropriate provenance and scope.

## References

- [Project plan](project-plan.md)
- [Reference facility scenario](reference-facility.md)
- [Buildable terrain requirements](requirements/buildable-terrain.md)
- [Solar conditions](requirements/solar-conditions.md)
- [Thermal conditions](requirements/thermal-conditions.md)
- [Investigation routes](requirements/investigation-routes.md)

The approved direction combines the Mission brief composition, Cinematic outline typography, and Practical guidance copy from the helper-text comparison.
