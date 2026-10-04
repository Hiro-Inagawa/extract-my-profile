# Profile extraction procedure

Run the scripts from the skill folder, wherever the agent keeps its skills. Every script takes `--root <dir>`. Without it the root is the environment variable `EXTRACT_MY_PROFILE_ROOT`, else `./profiles` under the current working directory.

The browser steps use a browser tool that can open a page in the user's signed-in session, return the page text and run JavaScript in the page. The tool names below are those of Claude in Chrome, the tool this procedure was built and tested with. Other tools are not verified. Use their equivalents for the same steps and expect to adapt the capture call.

## 1. Prepare

1. Read `PROFILES.md`, the platform's `CURRENT-STATE.md` if one exists, and `APPROVED-PROFILE-TEXTS.md`.
2. Decide the platform key and the list of profile pages. For an existing platform, the pages are the ones named in its snapshots and its "Not read" section. For a new platform, find the profile, settings and documents pages once and record them.
3. Claude in Chrome: load the tools in one ToolSearch call, call `tabs_context_mcp`, then open a new tab with `tabs_create_mcp`. Generic: open a new tab in the signed-in browser.

## 2. Read

For each page:

1. Open the page URL (`navigate`). If the page shows a sign-in form, stop, add the platform to a "signed out" list and move to the next platform. Never sign in.
2. Expand collapsed sections only by clicking "show more" style controls. Never click edit, save, delete or upload controls.
3. In one batch, so both see the same page state, return the page text (`get_page_text`), then run `scripts/browser-capture.js` in the page (`javascript_tool`), written as `await (` + the file's function + `)('<selector>')`. Do not assemble this by hand. `node scripts/capture-call.mjs <selector> [mode]` prints the exact text to paste, with the file's comment block removed, and rejects a selector that contains a single quote or a backslash. The selector is the source element that the page-text tool names in its output (`main`, `body`, `article`). If the page is still loading, wait first, because late content changes the fingerprint.
4. Write the page text unchanged to a scratch file outside the collection, for example `<scratch dir>/<platform>-<page>.txt`. Do not retype, shorten or summarize it.
5. Save it with the page fingerprint. This is required for every real read:

   ```
   node scripts/snapshot.mjs save --platform "<key>" --page <page> --url "<url>" --input "<scratch file>" --expect-sha256 "<fingerprint>"
   ```

   For the first snapshot of a platform that has no folder yet, add `--create`. The folder is created under the root. Then add the platform to `PROFILES.md` (see section 6).

   **When the page-text tool returns nothing or misses content.** Some sites return no text, or hide most content inside web components, where plain text sees only a few lines and values such as an hourly rate can be dropped. On those sites run the capture in composed mode, `await (<file>)('body', 'composed')`, which `node scripts/capture-call.mjs body composed` prints. It reads inside shadow roots, skips icons and screen-reader-only text, and keeps the normalized text in `window.__ppCapture`. Read it with `window.__ppCapture.slice(a, b)` in pieces of 900 characters in one batch, and check each boundary with `JSON.stringify(window.__ppCapture.slice(i - 3, i + 3))`, because the tool output can hide leading and trailing line breaks. Join the pieces into the scratch file and save with the fingerprint from the same run.

   **Before reading.** Expand folded lists with their "show more" style controls. On pages that load sections while scrolling, scroll the real viewport down step by step until the text length stops growing. Capture the text and the fingerprint only after that.

   **Settled pages only.** The capture function reads the page every second until three reads in a row are identical, and only then fingerprints it. Some lists load after the rest of the page, and an early capture records them as empty. The result reports `settled`. With `settled: false` the page never stopped changing, so capture again. A browser tab that is not on screen may stop rendering: bring it to the front first, and compare the character count with the last snapshot. A much shorter capture means the page was not drawn yet.

   **Content without text.** Links shown only as icons never appear in the page text. Before recording such a field as empty, open its editor, read the stored values, and close it without saving. Note this under Not read in the platform's `CURRENT-STATE.md`.

   **Every page, not only the profile page.** A read is complete only when every page, tab and editor that holds profile data has been read: settings, preferences, job preferences, availability, communications, visibility, documents, and editors whose values the profile page does not show. Open an editor to read it and leave by Cancel or by leaving the page. Record selection states (pressed buttons, switches, radio options) in the platform's Settings section when they are not in the page text. A platform whose pages fail is recorded as such under Not read.

   **An empty field is checked twice.** When a field that held approved values reads empty, confirm it on screen or in its editor before recording a loss. Values that sit behind a control often look lost in a snapshot while they are present.

   Exit 1 with "does not match the page fingerprint" means the copy differs from the page. Nothing is saved. Capture the page again. The snapshot header records `capture_check: browser-sha256 <hash>`. A snapshot with `capture_check: none` was not checked against the page.

   Page names are short lowercase words: `profile`, `experience`, `skills`, `preferences`, `documents`, `settings`.

## 3. Compare

```
node scripts/diff.mjs --platform "<key>"
```

An unexpected change, such as experience rewritten after a resume upload, goes to the user under "Needs the owner" with the diff summary.

## 4. Record

Write `CURRENT-STATE.md` from `references/CURRENT-STATE-TEMPLATE.md`:

- Header lines exactly as in the template. `Last snapshot` names the newest snapshot file of the main profile page. `Category` is the first folder of the platform key, or `None` when the key has one segment.
- Field values come from the snapshot text, with the platform's own wording. Do not improve, shorten or reorder them.
- Existing facts that the read did not touch, such as decisions or upload notes, stay and move into the matching section. Nothing is dropped during a conversion.
- Add one change history entry with the date, what was read or changed, the snapshot file and the diff result.

## 5. Check

```
node scripts/check-approved.mjs --platform "<key>"
node scripts/validate.mjs --platform "<key>"
```

`missing` and `differs` results are reported to the user. They are not fixed during a read. A fix is a separate change that needs the user's approval, unless the text is already approved for that platform.

## 6. Registry

1. In `PROFILES.md`, the platform's line sits under `## Verified`. It is a Markdown link whose target is the platform key followed by `/CURRENT-STATE.md`, for example `- [Aquent](contract/aquent/CURRENT-STATE.md), verified 2026-01-15, open items`. The date after `verified` must equal `Last verified` in the file. A platform folder without a `CURRENT-STATE.md` is listed under `## Registered` with its folder in backticks, and that folder must exist. Wrap a link target that contains spaces in angle brackets.
2. Run `node scripts/validate.mjs` once more for the whole collection when several platforms were read.

## Applying an approved change

1. Confirm the change is approved: the text is in `APPROVED-PROFILE-TEXTS.md` for this platform, or the user approved this exact change in chat in this session.
2. Snapshot the page first (section 2).
3. Make the change in the browser. Where a platform offers it, turn off notifications to the user's network for the change.
4. Reload, read and snapshot the page again, then run `diff.mjs` and `check-approved.mjs`. The diff must show exactly the approved change.
5. Record it in `CURRENT-STATE.md` (change history with the approval source).
