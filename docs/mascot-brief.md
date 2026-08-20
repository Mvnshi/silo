# Mascot brief — a face for the assistant

> Hand this to a fresh session. It is written to be actionable without the
> conversation that produced it.

## Read this first: the licence decides the shape of the job

The tool is **Bible Strong Avatar Lab** (<https://avatars.bible-strong.app>,
source at <https://github.com/smontlouis/bible-strong-avatar-lab>). It is a
browser studio that renders procedural 2D avatars as SVG, and it is
**AGPL-3.0**.

That matters because the studio offers two very different kinds of output:

| Path | What you get | Use it? |
|---|---|---|
| **Photo Mode** (button on the canvas) | SVG / PNG snapshots, transparent or solid background | ✅ **Yes.** Static art produced *by* a tool is not a derivative of the tool, the way a drawing made in GIMP is not GPL. |
| **Export tab** | `.avatar.json` + `@bible-strong/avatar-react` / `@bible-strong/avatar-web` | ❌ **No.** Linking an AGPL runtime into Silo puts copyleft obligations on a paid App Store app, including the network-distribution clause. |

So: **export frames, not a renderer.** Do not add either npm package, and do not
copy the renderer source into the repo. If a future feature genuinely needs a
live procedural avatar, that is a licensing conversation with a lawyer first, not
an `npm install`.

There is a second, independent reason the runtime path is a dead end: those
packages are React DOM + SVG + Motion. Silo's app is React Native and has no
`react-native-svg` at all (`expo-image` is the only image dependency). The web
renderer cannot run there — the same mismatch that ruled out Magic UI and
shadcn's RN port. See ROADMAP.md, "Assessed and declined".

**Attribution:** even for static exports, credit the lab in `assets/README.md`
and in `docs/app-store.md` acknowledgements. It is a free tool by
[@_smontlouis](https://x.com/_smontlouis); say so.

## What Silo is, so the mascot fits it

Silo turns links, screenshots and notes into a library that *comes back to you*
at the moment you can act on it. The tagline is **"Use the things you save."**
The north-star metric is actions taken per week, not saves.

The brand is violet — `BRAND[600]` is `#7c3aed`, and `lib/theme.ts` is the only
place a colour may be written. The app icon is three stacked rounded bars, and
the assistant currently uses a `sparkles` glyph everywhere it needs a face.

Tone: calm, competent, a little dry. **Not** a wacky cartoon and not a paperclip.
This thing appears at the moment a user is deciding whether to trust it with
their calendar — it should read as steady, not needy.

Useful coincidence: the lab's default avatar ("Strobi") is already a violet blob
that sits close to Silo's brand. Start there rather than from a mismatched
preset, and tune the hue to match `BRAND[600]` exactly.

## The states to produce

The mascot replaces the `sparkles` glyph in five real places. Each needs its own
frame, and the list is deliberately short — five good frames beat twenty.

| State | Where it renders | What it should read as |
|---|---|---|
| `idle` | the assistant FAB (`components/AssistantProvider.tsx`), 26pt glyph inside a 60pt glass circle | awake, unbothered |
| `thinking` | the thinking bubble (`components/ChatBot.tsx`, beside `ShimmerText`) | working, eyes engaged |
| `done` | after an action applies (`components/assistant/ActionCard.tsx`) | quietly pleased — a nod, not a party |
| `empty` | `EmptyState` in the sheet when the library is empty | patient, waiting |
| `blocked` | the premium / error bubbles | apologetic, still friendly |

The FAB frame is the one that has to survive being small. Check it at 26pt before
committing to any detail: this style is procedural geometry, and eyes that read
at 400px can turn into two grey smudges at 26.

## Driving the studio

The in-app **Browser pane works fine** — no login, no extension needed. Open it
with `preview_start({url: "https://avatars.bible-strong.app/"})`. Claude in
Chrome is only worth it if you separately want the user's logged-in state, which
this site does not use.

Layout: canvas on the left with a head-rotation gizmo (X/Y/Z) and the **Photo
Mode** button; a bottom bar on the right with the avatar picker and five tabs —
avatar name · **Pose** · **Expressions** · **Animations** · **Export**.

The UI is canvas-heavy and most buttons come back unlabelled from `read_page`, so
**drive it by screenshot and coordinates**, not by the accessibility tree. Budget
for that: it is slow, and it is the main cost of this task.

There is a **"Copy instruction for AI"** button in the Export tab. Read what it
gives you, but remember it is pitched at the runtime-integration path this brief
rules out.

## Deliverables

1. `assets/mascot/silo-<state>.png` at **@1x / @2x / @3x**, transparent
   background, square canvas, generous padding so nothing clips when the glass
   FAB rounds it. Five states, so fifteen files.
2. `assets/mascot/silo-<state>.svg` — the source snapshot for each, in case a
   future build adds `react-native-svg` and wants to scale cleanly.
3. `assets/mascot/README.md` — which preset was used, every parameter changed
   from default, the exact hex values, and the lab's licence + attribution. A
   future session must be able to reproduce or extend the set without guessing.
4. Wire `idle` into the assistant FAB behind the existing `sparkles` glyph, as a
   single swap, and screenshot it in the simulator at **26pt in light and dark**.
   Leave the other four states as assets only unless they clearly work.

## Acceptance

- `idle` is legible at 26pt in both appearances. Screenshot both.
- No new npm dependency, and no AGPL code in the repo.
- `npx tsc --noEmit` and `npx expo lint` stay at 0 errors; lint warnings do not
  increase.
- Attribution is present in `assets/README.md`.
- If the mascot does not beat the `sparkles` glyph at FAB size, **say so and ship
  the assets without the swap.** A worse FAB is not an improvement, and this is
  exactly the kind of change that is easy to talk yourself into.

## Out of scope

Animation, Lottie, sprite sheets, and anything that needs a runtime renderer.
Onboarding illustrations. App icon changes — that is a store-listing decision
with screenshots already shot against the current one.
