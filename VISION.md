# Silo — Product Vision

> North-star doc. Read this before TODO.md/AUDIT.md — it explains **why** Silo exists and where the AI system is going. Pairs with [`README.md`](README.md) (what's built) and [`TODO.md`](TODO.md) (what's next).

## The thesis

**Most AI products act *for* you. Silo's AI decides *with* you.** It turns everything you've saved into the right next action, surfaced at the moment you can actually take it.

## The problem: a decision gap, not an execution gap

Today's AI is great when you already know what to ask — power users run tight ask→act→refine loops and compound the benefit. But most lost productivity isn't from inability to execute; it's **inaction**: things we saved and forgot, options we never noticed, decisions we never got around to making. Nobody opens a chat app and asks "what should I be doing right now?" — not out of inability, but because that habit doesn't exist.

So instead of waiting for the question, **Silo volunteers the answer**: *"You have 45 free minutes after your 2pm. That ramen place you saved is 8 minutes from where you'll be — want it on the calendar?"*

## The Context Ladder

The recommendation quality is gated by context. We climb three layers, in order:

| Layer | Context | Status |
|---|---|---|
| **L1 — Saved intent** | Everything you've captured: links, reels, screenshots, notes — auto-classified, tagged, geocoded, schedulable. This is the *"what you want to do"* corpus. | ✅ **Shipped.** This is the app today (extractor, classifier, stacks, calendar, map). |
| **L2 — Living context** | What's actually happening in your life: calendar free/busy, current + upcoming location, (later) email signals. *"When and where you can do it."* | 🟡 **Partial.** Calendar two-way via expo-calendar; place fields + geocoding shipped; the condition/trigger engine types are already reserved in `lib/types.ts` (the `BucketCondition` block). Email triage is roadmap — on-device first. |
| **L3 — Ambient** | OMI-style continuous audio/conversation context: hear a restaurant recommendation in a conversation, it's saved and resurfaced later. | 🔭 **Far roadmap.** Opt-in only, on-device transcription only. Revisit after L2 proves the recommendation loop. |

## The product loop

```
capture (share/screenshot/note)
  → enrich (classify, tag, geocode, embed)
    → trigger (free slot + proximity + time-of-day + season — L2)
      → recommend ("3 things you could actually do today")
        → act (one-tap schedule / open / done)
          → feedback (done/archived/snoozed trains the ranking)
```

The **bucket-list trigger engine** (types reserved in `lib/types.ts`) is the L2 centerpiece: every saved item can carry conditions (near a place, free evening, right season, needs another person), and the engine fires recommendations when conditions are actually met — instead of letting saves rot in a list.

## Privacy architecture is the moat

The entire context graph — saves, schedule, locations, habits — **lives on-device**. The Cloudflare Worker is a thin, keyless-to-the-client proxy; only narrow, ephemeral prompts ever leave the phone, and nothing is stored server-side. This is deliberate:

- It's the only architecture users should accept for L2/L3-grade context.
- It's the Apple-aligned posture (on-device intelligence, App Store-friendly, no data lake to breach).
- It keeps marginal cost ≈ $0/user, so free tier stays free.

## What we deliberately do NOT build

- **Agentic execution** (booking rides, sending emails, buying things). The wedge is *deciding*, not *doing* — recommendation quality compounds; half-working agents erode trust. Revisit only after the recommendation loop retains.
- **Server-side user data.** No accounts, no remote DB, no embeddings warehouse. If a feature requires hoarding user data on a server, redesign the feature.
- **A chat-first interface.** Chat exists (the assistant), but the product is the feed, the calendar, and the nudge — recommendations come to you.

## Roadmap (sequenced)

1. **v1 launch (now):** capture → organize → stream → schedule. Nail the loop manually.
2. **Today view / daily digest:** combine calendar free slots + L1 corpus → "3 things you could actually do today." First real L2 feature; uses `suggest_schedule` infrastructure that already exists.
3. **Trigger engine:** implement the reserved `BucketCondition` evaluator (location proximity, time-of-day, date windows, calendar-free) + local notifications. Saves stop rotting.
4. **Email signals (on-device triage):** extract commitments/intent from mail the user grants access to; feed the trigger engine. Privacy-first design TBD before any code.
5. **L3 ambient (exploratory):** continuous-context capture à la OMI. Only if L2 retention proves the loop, and only opt-in/on-device.

## North-star metric

**Actions taken per week from saved items** (resurfacing rate) — not saves, not opens. Silo wins when things you saved actually happen.
