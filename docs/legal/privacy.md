---
title: Silo — Privacy Policy
---

# Privacy Policy

**Last updated: 19 August 2026**

> **This is a draft prepared from how Silo actually works, not legal advice.**
> Have a lawyer review it before you submit to the App Store, and re-check it
> whenever a data flow changes. Every claim below is written to match the code —
> if you change what leaves the device, change this document in the same commit.

Silo is a save-it-later app that helps you actually use the things you save. It
is built so that the interesting parts of your life — what you saved, where you
go, what your week looks like — stay on your phone.

## The short version

- **Your library lives on your device.** Links, notes, screenshots, tags,
  stacks, schedules and places are stored in your device's own storage. We do
  not have a copy.
- **We have no user database of your content.** There is no server holding your
  saves, no analytics product, no advertising SDK, and no data broker.
- **Your location never leaves your phone.** It is used on-device to sort saved
  places by distance and to evaluate location triggers.
- **Some things you choose to process do leave the device**, and they are listed
  explicitly below.

## What Silo stores on your device

Everything you create: saved links and their extracted titles, authors,
descriptions and thumbnail URLs; notes; screenshots you import; tags; stacks;
scheduled dates; place names and coordinates you attach; and usage signals that
drive resurfacing (whether you did something, when you last opened it, how many
times you have done it).

This data is removed when you delete the app, or immediately when you use
**Settings → Delete all data**.

## What leaves your device, and when

### 1. Link and content processing (only when you save something)

When you save a link, Silo sends **the URL** to its own backend (a Cloudflare
Worker that we operate). The Worker fetches that page's public metadata — the
same title, description and preview image a messaging app shows — and returns
it. The Worker does not store the URL or the result.

When you ask Silo to analyse a **screenshot or image**, the image is sent to the
Worker and on to **Google Gemini** to produce a title, category and tags. When
you use the **assistant**, the text of your question and the titles and
descriptions of the saved items relevant to it are sent the same way.

- These requests are processed and discarded. Silo's backend keeps no copy.
- Google processes them as a data processor under its API terms. See
  <https://ai.google.dev/gemini-api/terms>.
- If you never save a link, analyse an image or use the assistant, nothing in
  this section ever runs.

### 2. Sync (optional, off by default)

If you turn on sync to use Silo on more than one device, your saved items are
copied to a database that **the operator of your Silo backend controls** — for
the App Store build, that is us; for a self-hosted build, that is you. Rows are
partitioned by a space key. In pairing-code mode that key is a random code
generated on your device; with an account it is your account id.

Sync is off until you enable it.

### 3. Accounts (optional)

Silo is fully usable signed out. If you create an account, identity is handled
by **Supabase** (<https://supabase.com/privacy>), which stores **your email
address and a user id — nothing else**. Sign in with Apple, Google, or a
six-digit email code. There are no passwords.

Your saves are not sent to the identity provider.

Deleting your account from **Settings → Account → Delete account** erases the
identity record and any synced rows in that space.

### 4. Subscriptions (optional)

If you subscribe, the purchase is made through Apple. Silo uses **RevenueCat**
(<https://www.revenuecat.com/privacy>) to check whether a subscription is
active. RevenueCat receives a pseudonymous app user id and the receipt Apple
issues. **Silo never sees your payment details** — Apple handles payment
entirely.

## Permissions, and why

| Permission | Why | Leaves the device? |
|---|---|---|
| Calendar | Reads your day to suggest free time; writes an event only when you tap Schedule | No |
| Photos | Reads screenshots you pick so they can be titled and filed | Only if you ask for AI analysis |
| Camera | Captures a photo to save | Only if you ask for AI analysis |
| Location (while using) | Sorts saved places by distance; evaluates location triggers | **No** |
| Notifications | Local reminders and nudges | No — these are scheduled on-device; there is no push token and no server |

Every one is optional. Declining any of them leaves the rest of Silo working.

## Children

Silo is not directed at children under 13, and we do not knowingly collect
personal information from them.

## Your rights

Because your library is on your device, you can export it (**Settings → Export
my data**, which produces JSON) or erase it (**Settings → Delete all data**) at
any time, without asking us. If you have an account, you can delete it and its
synced rows from inside the app. For anything else, contact us below.

Depending on where you live you may have additional rights under the GDPR or the
CCPA — including access, correction, deletion and portability. The tools above
satisfy these for on-device data; write to us for anything held server-side.

## Changes

If this policy changes materially we will update the "last updated" date and
note the change in the app's release notes.

## Contact

Questions about privacy: **hello@silo.app**
