---
name: extract-my-profile
description: Use when the user wants to read, record, compare or audit their own signed-in profiles on job boards, contract and freelance platforms, employer career portals, marketplaces or LinkedIn. Saves each page's text word for word as a hashed snapshot, writes a fixed-format CURRENT-STATE.md per platform, diffs against the previous read, checks the user's approved texts against the profiles and validates the collection. Read-only by default.
---

# Extract My Profile

A collection of profiles lives in one root folder, found as `--root <dir>`, else the environment variable `EXTRACT_MY_PROFILE_ROOT`, else `./profiles`. It holds the registry `PROFILES.md`, the approved texts `APPROVED-PROFILE-TEXTS.md` with the machine-readable copy `APPROVED-PROFILE-TEXTS.json`, and one folder per platform with `CURRENT-STATE.md` and `_SNAPSHOTS/`. A platform key is the folder path below the root, for example `linkedin` or `contract/aquent`. A new root is created with `node scripts/init.mjs`.

The scripts make the exact parts deterministic: snapshots, hashes, diffs, the approved-text check and the template check. Reading the page in the browser is the only model step.

## Rules

- **Read-only by default.** Open pages and read them. Never type into a profile, click Save, submit, upload or delete. A change happens only after the user approved that exact change in chat.
- **The user signs in.** Never type a password, never sign in, never handle a one-time code. If a platform is signed out, list it and wait.
- **Snapshots are private.** They can hold phone, email and address. Never paste their contents into chat and never commit them to a public repository.
- **No new wording.** Never write new profile text without the user's approval. Approved texts go in `APPROVED-PROFILE-TEXTS.md` and `.json`.

## Browser

Needs a browser tool that can (a) open a page in the user's signed-in browser session, (b) return the page text and (c) run JavaScript in the page. Built and tested with Claude in Chrome (`mcp__claude-in-chrome__*`). Open pages in a new tab and leave the user's other tabs alone.

| Step | Generic | Claude in Chrome |
| --- | --- | --- |
| Open a page | open URL in the signed-in session | `tabs_create_mcp`, `navigate` |
| Page text | return the page text | `get_page_text` |
| Fingerprint | run `scripts/browser-capture.js` in the page, using the text that `node scripts/capture-call.mjs <selector> [mode]` prints | `javascript_tool` |

## Procedure

Follow [references/PROCEDURE.md](references/PROCEDURE.md). In short:

1. Read `PROFILES.md` and the platform's `CURRENT-STATE.md`.
2. Open each profile page. Read its text and fingerprint the same element in one batch. Get the text to run in the page from `node scripts/capture-call.mjs <selector> [mode]`, where the selector is the element named in the page-text tool's `Source element:` line. Paste it as printed.
3. Save the text to a scratch file, then `node scripts/snapshot.mjs save ... --expect-sha256 "<fingerprint>"`, which refuses a copy that differs from the page. Then `node scripts/diff.mjs ...`.
4. Write `CURRENT-STATE.md` from [references/CURRENT-STATE-TEMPLATE.md](references/CURRENT-STATE-TEMPLATE.md), with values taken from the snapshot.
5. Run `node scripts/check-approved.mjs --platform <key>` and `node scripts/validate.mjs --platform <key>`.
6. Update the platform's line in `PROFILES.md`.

Report what changed on the profile, any `missing` or `differs` approved text and anything the user must do. Do not dump script output.

## Scripts

All take `--root`. Exit codes: 0 ok, 1 check failure, 2 usage error. Node 20 or newer, no packages. See the README for the full table.
