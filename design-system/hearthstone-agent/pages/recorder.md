# Recorder Window Override

This file adapts the generated master design system to the Windows WPF recorder window.
Where this file differs from `../MASTER.md`, this file takes precedence.

## Product pattern

- Desktop operations dashboard, not a marketing landing page.
- Optimize for readable status, explicit recovery actions and keyboard use.
- Keep one primary action: **Start recording**. Stop is a separate danger action.
- Do not use decorative motion, oversized display text or hover movement.

## Typography

- UI: Segoe UI, using the Windows system installation.
- Identifiers, counters and event rows: Consolas.
- Body text: 14 px minimum; helper text: 12 px minimum.

## Color and state

- Retain the master dark palette and green accent.
- Status is always expressed with both color and text.
- Warning and error states include a recovery instruction.
- Keyboard focus uses a visible cyan or green border.

## Layout

- Minimum window size: 960 × 680.
- 20–28 px page gutters, 16–20 px card padding and an 8 px spacing rhythm.
- Left column contains configuration, metrics and recent events.
- Right column contains recorder controls, current match details and safety boundaries.
- Long paths and identifiers wrap or trim without forcing horizontal scrolling.

## Interaction

- Native WPF controls remain keyboard reachable.
- Buttons have a minimum height of 40 px and disabled states are visibly muted.
- Settings become read-only while recording.
- Closing the window stops and flushes the current recording session.
- No input automation is exposed in v0.1.
