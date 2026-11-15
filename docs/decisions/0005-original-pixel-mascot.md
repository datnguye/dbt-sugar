# 0005. The mascot is an original pixel character

- Status: Accepted
- Date: 2026-11-15

## Context

The mascot carries the run's mood at a glance (waiting, running, worried, alarmed, success, failed) and reacts to events (a node finishing, a test passing, an error). It went through a block-glyph face, a sugar cube and a gummy bear before landing on Dinor Sugar: a pixel dinosaur chasing a pixel dbt logo, which reads well in a terminal-styled page.

## Decision

- Dinor Sugar is drawn from code: a 24×24 sprite built from pixel layers and played frame by frame, no image files.
- Every pose gets one strong, distinct cue (sunglasses, a warning sign, the logo caught or escaping), not a one-pixel change.
- `prefers-reduced-motion` shows the first frame only.
- It is an original character; no recreations of other games' or brands' sprites.

## Consequences

- **Easier:** new poses are data, the page stays a few kilobytes, and it can be tested pixel by pixel.
- **Harder:** detail is limited to 24 pixels.
- **Forbidden:** copying third-party sprites or characters.

## Revisit when

The poses stop being distinguishable at the sizes the page uses (60 px on phones).
