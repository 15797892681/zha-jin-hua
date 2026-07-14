# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

### Viewport-anchored popovers

Render a popover through `createPortal(..., document.body)` when its position or
outside-click layer is relative to the viewport. Pass the anchor element into
the popover and derive its offset from `anchor.getBoundingClientRect()`.

```tsx
const bottom = window.innerHeight - anchor.getBoundingClientRect().top + 8;

return createPortal(
  <div className="sheet-backdrop" onMouseDown={onClose}>
    <section role="dialog" aria-label="Choose value" style={{ bottom }} />
  </div>,
  document.body,
);
```

This is required for popovers opened from `.action-dock`: the dock uses
`transform` and `backdrop-filter`, while `.game-screen` clips overflow. Keeping
a fixed-position layer beneath those ancestors changes its containing block and
can clip the panel at the bottom of the table.

Keep lightweight popover click layers transparent. Modal dialogs may continue
to use the shared dimmed and blurred dialog backdrop.

---

## Accessibility

<!-- A11y requirements and patterns -->

- Give dialog-like popovers an accessible name with `role="dialog"` and
  `aria-label` or `aria-labelledby`.
- Do not set `aria-modal="true"` on lightweight popovers that leave the table
  visible and support outside-click dismissal.
- Keep all choices and dismissal actions as native keyboard-operable buttons.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Do not assume `position: fixed` is viewport-relative inside a transformed or
  filtered ancestor.
- For anchored popover regressions, test desktop, phone portrait, and phone
  landscape layouts. Assert that every action is in the viewport, the panel is
  above its anchor, and opening it does not add document or panel scrolling.
