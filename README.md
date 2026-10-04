# Extract My Profile

An agent skill that reads your own signed-in profiles on job boards, contract and freelance platforms, employer career portals, marketplaces and LinkedIn, and keeps an exact record of what each profile says.

Each page is saved word for word as a snapshot with a hash. The hash is checked against a fingerprint that the page computes for itself, so a copy that differs from the page is refused. Each platform gets a `CURRENT-STATE.md` written from one fixed template. Scripts compare the latest snapshot with the previous one, check your approved texts against what the profiles show, and validate the whole collection. Reading the page in the browser is the only step that needs the agent. Everything else is computed.

## Who it is for

Anyone who keeps profiles on several platforms and wants to know what each one says today, what changed since the last look, and whether a text they approved is still there. Typical users are freelancers, contractors and job seekers.

## Requirements

- Node 20 or newer. The scripts use only the standard library, there is nothing to install.
- A browser tool for the agent that can (a) open a page in your signed-in browser session, (b) return the page text and (c) run JavaScript in the page. The skill was built and tested with Claude in Chrome on real platforms. The quick start below was also run end to end with the built-in browser of the Claude desktop app. No other browser tool has been verified. The steps in [references/PROCEDURE.md](references/PROCEDURE.md) are written generically with the Claude in Chrome tool names beside them.

## Install

Copy this folder into the skills folder of your agent. For Claude Code that is `~/.claude/skills/extract-my-profile`. The skill is found by the `name` in `SKILL.md`.

Or install it with the skills CLI:

```
npx skills add Hiro-Inagawa/extract-my-profile --global --agent claude-code
```

## Quick start

The example runs on two synthetic profile pages served from your own computer. No account is needed. Run the commands from this folder. Every command accepts `--root <dir>`, and the paths in the steps assume the default `./profiles`.

1. Create an empty collection. Its root is `--root <dir>`, else the environment variable `EXTRACT_MY_PROFILE_ROOT`, else `./profiles` under the current directory.

   ```
   node scripts/init.mjs
   ```

2. Serve the example pages in a second terminal. The server listens on 127.0.0.1 only. Leave it running. An agent may start it as a background process instead.

   ```
   node scripts/serve-example.mjs --port 4173
   ```

3. Ask the agent to open `http://127.0.0.1:4173/demo-platform/profile-v1.html` in a new tab and read it. The agent returns the page text and runs `scripts/browser-capture.js` in the page. The page-text tool names the element it read in a `Source element:` line, and that element is the selector. For the example it is `main`. To get the exact text to paste into the browser tool's JavaScript call, run:

   ```
   node scripts/capture-call.mjs main
   ```

   It prints `await (` + the function from `browser-capture.js` without its comment block + `)('main')`. Paste it as printed, without shortening it. A second argument selects the mode, `innertext` (default) or `composed`. The result holds a fingerprint of eight groups of eight hex characters.

4. The agent writes the page text to a scratch file and saves the snapshot. The page text is everything after the `---` line of the page-text output, unchanged. Leading and trailing blank lines do not matter, because `snapshot.mjs` and the capture function normalize the text the same way: line endings, no-break spaces and zero-width characters, runs of spaces and tabs inside a line, spaces at the start and end of each line, and blank lines at the start and end of the text. Blank lines between lines are kept. `--create` makes the platform folder because `demo-platform` is new.

   ```
   node scripts/snapshot.mjs save --create --platform demo-platform --page profile --url http://127.0.0.1:4173/demo-platform/profile-v1.html --input <scratch file> --expect-sha256 "<fingerprint>"
   ```

   Paste the fingerprint as returned, eight groups separated by spaces, inside double quotes. The script prints one line of JSON with the keys `file`, `sha256`, `previous`, `status` and `capture_check`:

   ```
   {"file":"2026-01-15-0900-profile.txt","sha256":"<64 hex characters>","previous":null,"status":"new","capture_check":"browser-sha256 <64 hex characters>"}
   ```

   `previous` is the file name of the earlier snapshot of the page, or `null` for the first one.

5. Switch the tab to `profile-v2.html`, which differs from v1 in the headline, one skill and the hourly rate. Capture and save it the same way, with the v2 URL and the new fingerprint. The script prints `changed`. A second snapshot of the same page saved within the same minute gets the suffix `-2`, for example `2026-01-15-0900-profile-2.txt`.

6. Compare the two reads.

   ```
   node scripts/diff.mjs --platform demo-platform
   ```

7. Write `profiles/demo-platform/CURRENT-STATE.md` from [references/CURRENT-STATE-TEMPLATE.md](references/CURRENT-STATE-TEMPLATE.md). Set `Category: None`, because the key `demo-platform` has one segment, and set `Last snapshot` to the `file` value printed by the v2 save command, prefixed with `_SNAPSHOTS/`, for example `_SNAPSHOTS/2026-01-15-0900-profile-2.txt`. The template shows the optional suffix as `[-2]`. Write the file name as printed, without brackets. `Last verified` is the date of the read. Then add a line under `## Verified` in `profiles/PROFILES.md`:

   ```
   - [Demo platform](demo-platform/CURRENT-STATE.md), verified YYYY-MM-DD
   ```

   Use the same date as `Last verified` in the state file.

   The minimum a state file needs to pass `validate.mjs`:

   - Line 1 reads `# <name> profile, current state`.
   - The header lines `Last verified`, `Status`, `Owner`, `Profile URL`, `Category` and `Last snapshot`, once each and in that order. `Last verified` is a real `YYYY-MM-DD` date. `Status` and `Owner` are not empty. `Profile URL` is an http or https URL. `Category` is the first folder of the platform key, or `None` when the key has one segment. `Last snapshot` is `None` or `_SNAPSHOTS/<file>` naming an existing snapshot whose hash is correct.
   - The six sections `## What the platform is`, `## Profile`, `## Settings`, `## Not read`, `## Open` and `## Change history`, once each and in that order, with no other `##` section. A section may be empty. `###` subsections are not checked.
   - A matching line under `## Verified` in `PROFILES.md`, with the same date as `Last verified`.

8. Check the result.

   ```
   node scripts/validate.mjs
   node scripts/check-approved.mjs
   ```

   Both exit 0. This step is optional: to try the approved-text check, add the headline to both approved-text files and run `check-approved.mjs` again. The Markdown file holds one `##` section per text, for the reader. The JSON file is what the scripts read. Each text needs an `id`, a `source` of type `inline`, the `text` and the `platforms` it belongs on.

   `APPROVED-PROFILE-TEXTS.md`, after the lines `init.mjs` wrote:

   ```
   ## Headline

   Senior product designer for data tools
   ```

   `APPROVED-PROFILE-TEXTS.json`:

   ```
   {
     "schema": "approved-profile-texts-v1",
     "texts": [
       {
         "id": "headline",
         "source": { "type": "inline" },
         "text": "Senior product designer for data tools",
         "platforms": ["demo-platform"]
       }
     ]
   }
   ```

   `check-approved.mjs` then prints `present` for `headline` on `demo-platform` and exits 0. With the v1 snapshot as the latest one it would print `differs` and exit 1.

Stop the example server with Ctrl+C in its terminal. If an agent started it as a background process, stop the process that runs `serve-example.mjs`. For a real platform, use a key such as `linkedin` or `contract/aquent` and the real page URLs. A key is any folder path below the root, and the first folder serves as the category.

## Scripts

All scripts take `--root`. Exit codes: 0 ok, 1 check failure, 2 usage error.

| Script | Purpose |
| --- | --- |
| `scripts/init.mjs` | Create an empty collection: `PROFILES.md`, `APPROVED-PROFILE-TEXTS.md` and `.json`, a short README and a `.gitignore` for `_SNAPSHOTS/`. Refuses to overwrite any existing file. |
| `scripts/browser-capture.js` | Runs in the page. Fingerprints the text of the source element with the same normalization as the scripts. Mode `composed` reads inside web components and form fields. |
| `scripts/capture-call.mjs [selector] [mode]` | Prints the text to paste into the browser tool's JavaScript call: `browser-capture.js` without its comment block, called on the selector (default `main`) in the mode (`innertext` default, or `composed`). Exit 2 for a bad mode or a selector with a single quote or backslash. |
| `scripts/snapshot.mjs save --platform <key> --page <page> --url <url> --input <file> [--expect-sha256 <fingerprint>] [--create]` | Save a verbatim snapshot with hash. With the fingerprint, refuse a copy that differs from the page. Reports `new`, `unchanged` or `changed`. |
| `scripts/diff.mjs --platform <key> [--page <page>]` | Line diff of the two latest snapshots per page, as Markdown. |
| `scripts/check-approved.mjs [--platform <key>]` | Approved texts against the latest snapshots: `present`, `missing`, `differs`, `no-snapshot`, `unknown-platform`, `source-unresolved`. |
| `scripts/validate.mjs [--platform <key>]` | Template, registry and approved-text file checks. |
| `scripts/serve-example.mjs [--port <n>]` | Static server for the example pages. 127.0.0.1 only, default port 4173. |

## Collection layout

```
profiles/
  PROFILES.md                  registry: ## Verified and ## Registered
  APPROVED-PROFILE-TEXTS.md    your approved texts, one section each
  APPROVED-PROFILE-TEXTS.json  the same texts for the scripts
  contract/aquent/
    CURRENT-STATE.md
    _SNAPSHOTS/2026-01-15-0900-profile.txt
```

A platform is any folder that holds `CURRENT-STATE.md` or a `_SNAPSHOTS` folder, or that is listed in backticks under `## Registered`. Folders whose names start with `__` or `.` are ignored. The JSON file lists texts as `inline` text or as `resume-section`, a heading in a Markdown file such as your resume, with the platforms each text belongs on.

## Privacy

- The skill is read-only by default. The agent opens pages and reads them. It does not type into a profile, save, submit, upload or delete. A change happens only after you approved that exact change.
- You sign in yourself. The agent never types a password and never handles a one-time code. A signed-out platform is listed and skipped.
- Snapshots are private. They can hold your phone number, email address and postal address. They are never pasted into chat and never committed to a public repository. Add this to the `.gitignore` of any repository that contains a collection:

  ```
  _SNAPSHOTS/
  ```

  `init.mjs` writes that line into the `.gitignore` of the collection it creates.
- The scripts make no network requests. The example server accepts connections from the local machine only.

## Limits

- Text only. Images, uploaded files and anything a site shows without text are not captured. Check those on screen.
- Sites change and some hide content behind controls. A snapshot is a record of what the page text showed at that moment.
- Only your own accounts. Check the terms of each platform before you automate reading it.
- The capture was built and tested with Claude in Chrome, and the quick start was run with the built-in browser of the Claude desktop app. Another browser tool needs the same three abilities and may need changes to the capture call.
- `node --test tests` does not work on Node 24 because a folder argument is treated as a module. Use `node --test tests/*.test.mjs`.

## Tests

From this folder:

```
node --test tests/*.test.mjs
```

The suite uses a synthetic collection in `tests/fixtures/PROFILES` and runs the scripts as child processes, through a symlink or junction, and against the example pages. The scripts and tests contain no literal invisible characters (U+00A0, U+200B to U+200D, U+FEFF), only escapes. Keep it that way when editing, because some editors turn escapes into the characters.

## License

MIT. See [LICENSE](LICENSE).
