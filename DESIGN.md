---
name: Saint Paul Camp Scoring
description: Fast, trustworthy night-time scoring and Kaizen Coins operations on mobile.
colors:
  night-aubergine: "oklch(0.16 0.022 306)"
  surface-plum: "oklch(0.205 0.027 306)"
  raised-plum: "oklch(0.245 0.035 306)"
  structural-border: "oklch(0.34 0.035 306)"
  muted-lavender: "oklch(0.72 0.03 303)"
  score-white: "oklch(0.94 0.012 300)"
  saint-paul-violet: "oklch(0.71 0.15 296)"
  outcome-green: "oklch(0.76 0.14 151)"
  draw-amber: "oklch(0.79 0.13 78)"
  outcome-red: "oklch(0.7 0.17 24)"
typography:
  headline:
    fontFamily: "Segoe UI, Tahoma, Arial, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Segoe UI, Tahoma, Arial, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Segoe UI, Tahoma, Arial, system-ui, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 650
    lineHeight: 1.35
rounded:
  field: "13px"
  control: "14px"
  surface: "17px"
  feature: "18px"
spacing:
  xs: "7px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "34px"
components:
  button-primary:
    backgroundColor: "{colors.saint-paul-violet}"
    textColor: "{colors.night-aubergine}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
    height: "52px"
  input:
    backgroundColor: "{colors.surface-plum}"
    textColor: "{colors.score-white}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "11px 13px"
    height: "50px"
---

# Design System: Saint Paul Camp Scoring

## Overview

**Creative North Star: "The Night Match Desk"**

An athletic operations interface built for scorers and administrators working quickly on phones during a one-night camp. It combines the scan speed of Formula 1 timing screens, the restraint of Nike Training Club, and the organizational clarity of Linear. The interface is dark because the physical scene is a focused volunteer working outdoors or in a dim camp venue at night.

Energy comes from decisive hierarchy, compact timelines, and immediate state feedback, never from decoration. The active task dominates; completed and upcoming work recedes. Generic SaaS dashboards, neon gaming interfaces, decorative glass, and grids of identical metric cards are prohibited.

**Key Characteristics:**

- Egyptian Arabic RTL from the first layout decision.
- Mobile-only, thumb-friendly operational flows.
- Dense enough to scan, calm enough to prevent errors.
- One violet brand voice with explicit semantic states.
- Responsive state transitions without decorative choreography.

## Colors

Use a restrained strategy: purple-tinted near-black neutrals carry the surface, Saint Paul violet marks actions and selection, and semantic colors appear only for operational meaning. The normative values live in the frontmatter and the implementation uses the same OKLCH tokens in `src/styles.css`.

### Primary

- **Saint Paul Violet:** Primary actions, current navigation, selected match state, and the 3px focus-visible outline.

### Secondary

- **Outcome Green:** Confirmed win or successful completion, always paired with an icon and Arabic label.
- **Draw Amber:** Draw selection and caution, always paired with an icon and Arabic label.
- **Outcome Red:** Loss, destructive action, or rejection, always paired with an icon and Arabic label.

### Neutral

- **Night Aubergine:** Root background and primary-button text.
- **Surface Plum:** Inputs, inactive controls, and quiet slot surfaces.
- **Raised Plum:** Active task, editor, and feature surfaces.
- **Warm Score White:** Primary text and critical values.
- **Muted Lavender Grey:** Secondary labels and future slots.

**The One Violet Rule.** Violet is the only brand accent. It signals action or current state, never decoration.

**The Meaning Needs Words Rule.** Win, draw, loss, warning, and success must never rely on color alone.

## Typography

**Display Font:** Segoe UI with Tahoma, Arial, and system sans fallbacks
**Body Font:** The same system stack

**Character:** Athletic through weight and rhythm, not through novelty. Numerals and times must be exceptionally clear, while Egyptian Arabic labels remain natural and compact.

### Hierarchy

- **Display** (700, 3rem, 1): Public NFC balance only.
- **Headline** (700, 1.75rem, 1.25): Screen titles and the active task.
- **Title** (600-700, 1.3rem, compact): Teams, slots, and transaction group labels.
- **Body** (400, 1rem, 1.65): Explanations, history, and errors.
- **Label** (650-800, 0.68-0.84rem, clear): Buttons, states, metadata, and navigation.

**The One Family Rule.** Never introduce a display face into operational UI. Hierarchy comes from size, weight, and spacing.

## Elevation

Flat by default. Depth comes from tonal layering, 1px full borders, and active-state contrast. Only the sticky top bar uses a shadow (`0 10px 35px oklch(0.08 0.02 306 / .25)`).

**The Active Surface Rule.** Only the task the user can act on now earns the strongest surface separation.

## Components

Buttons are at least 52px high with 14px corners; inputs are at least 50px high with 13px corners. Match slots form an RTL time sequence and the current slot expands inline instead of opening a modal. Feature surfaces use 17-18px corners and full borders. Admin navigation is a three-part sticky segmented control. Every interactive component has pressed, focus-visible, disabled, loading, success, and error behavior where relevant.

## Do's and Don'ts

### Do:

- **Do** put the next operational action before summaries or analytics.
- **Do** use large touch targets and short Egyptian Arabic labels.
- **Do** show only the scorer's assigned slots and personal bonus allowance.
- **Do** use skeleton loading and explicit save feedback because the system has no realtime behavior.
- **Do** keep the NFC team page simpler than authenticated operational screens.

### Don't:

- **Don't** build a generic SaaS dashboard or a cluttered grid of identical cards.
- **Don't** use a neon gaming interface, gradients, gradient text, or decorative glass effects.
- **Don't** hide core scoring actions behind modals.
- **Don't** imply permissions through hidden navigation alone.
- **Don't** add realtime indicators, live badges, or notification behaviors the product does not support.
- **Don't** use colored side-stripe accents or decorative charts.
