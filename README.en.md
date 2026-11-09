![dsh-obsidian-memo: an Obsidian sticky-note wall inside DeepSeek Harness.](docs/assets/cover.png)

# dsh-obsidian-memo

**An Obsidian notes plugin for DeepSeek Harness.**

Capture thoughts, revisit them, and let AI move an idea forward — while every note stays a plain Markdown file in your Obsidian vault.

Harness sidebar panel · local Markdown · uses your default model · one-click project draft

[What it is](#what-it-is) · [Install](#install) · [Usage](#usage) · [Data & privacy](#data--privacy) · [FAQ](#faq) · [简体中文](README.md)

![DeepSeek Harness 0.2.x](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-111?style=flat-square) [![MIT](https://img.shields.io/badge/MIT-open%20source-111?style=flat-square)](LICENSE) ![version 0.14.2](https://img.shields.io/badge/version-0.14.2-111?style=flat-square) [![Star](https://img.shields.io/github/stars/cavenzhong/dsh-obsidian-memo?style=flat-square&color=111&label=Star)](https://github.com/cavenzhong/dsh-obsidian-memo/stargazers)

## What it is

While working with AI in DeepSeek Harness, some thoughts are worth keeping but don't deserve a project yet.

dsh-obsidian-memo adds a notes entry to the Harness sidebar and turns one of your Obsidian folders into a pastel sticky-note wall. Jot down a thought, a reference image, or something you're working through; when you want a second opinion, use Harness's default model to look at it from another angle.

**Capture → revisit → get feedback → open a project / archive it**

There is no second notebook: each sticky note is a `.md` file in the folder you choose, images are vault attachments, and archiving simply moves the file.

**A good fit if**

- Your notes already live in Obsidian and you want to capture new thoughts while working.
- You don't want a project for every idea, but want to expand one when it matters.
- You're happy to let AI weigh in, as long as notes stay local Markdown.

**Probably not for you if**

- You want a replacement for Obsidian's search, backlinks, and plugin ecosystem.
- You need the full wall experience on a phone (this is desktop-first).

## Highlights

- **See what's on your mind at a glance.** Subfolders get stable colors; filter by date, sort by created or modified time; light and dark themes are both covered.
- **Capture text and images together.** A bottom composer takes notes anytime; paste, drag in, or pick multiple images, compressed to WebP by default.
- **Read and edit in place.** Click a card to read, double-click to edit Markdown; pin the right-hand panel to tidy up while keeping the wall in view, and tick off tasks directly.
- **From one line to the next step.** Four AI personas offer a different angle; "Open project" drafts a structured project document and links it back to the note.
- **Notes still belong to Obsidian.** Existing frontmatter is preserved and nothing is imported or migrated; apart from model calls you explicitly trigger, the plugin does not go online, and it keeps no separate API key.

## A closer look

### Capture: the title is the filename

![Quick capture: a title, an optional body, and a reference image](docs/assets/capture.png)

Type a line and press `Enter` to create a note. Press `Tab` to expand the body and `⌘ / Ctrl + Enter` to submit. Paste or drag images straight into the composer; the title becomes the Markdown filename, and the body, images, and later comments all live in the same note.

### Revisit: text, tasks, and AI comments together

![The reading panel: sticky-note wall on the left, pinned note and AI comments on the right](docs/assets/reader.png)

The right panel shows the full note, collapsible comments, and checkable tasks. Pin it to work side by side with the wall; drag its edge to resize, and the body and comments scroll independently.

## Install

**Requirements**

- **DeepSeek Harness** `0.2.2-rc.1` or a later `0.2.x` (developed and verified on `0.2.2-rc.1`; the desktop app and Web GUI use the same channel).
- A local **Obsidian vault**. The plugin reads and writes that folder directly and does not require an Obsidian community plugin.
- No build step and no runtime dependencies; you do not need Node, pnpm, or a separate API key.

**1. Get the source**

```bash
git clone https://github.com/cavenzhong/dsh-obsidian-memo.git
```

A ZIP download works too. Note the absolute path of the folder.

**2. Install inside DeepSeek Harness**

Ask the agent in Harness to call the `plugin_manager` tool, replacing the path with your own:

```text
action: install_bundle
target: link:/absolute/path/to/dsh-obsidian-memo
```

`link:` refers to the local source folder, so keep it in place after installing. Open the notes entry in the Harness sidebar. If you previously installed the old package name (`dsh-sticky-notes`), remove that package first.

**3. Pick folders and start writing**

Click the gear in the top-right corner, set the vault root and notes folder, and save. Project and archive folders can be added later.

| Setting | Required | Notes |
| --- | --- | --- |
| Vault root | Yes | Your Obsidian vault, e.g. `~/Documents/MyVault`. |
| Notes folder | Yes | The folder you want on the wall, e.g. `Inbox`. |
| Project folder | For projects | Where generated project documents are stored. |
| Archive folders | No | Add several; the archive button lists these targets. |
| Image folder | No | Defaults to `_attachments/` inside the notes folder; must be inside the vault and not a dot-hidden folder. |
| Image processing | No | WebP compression is on by default: quality 70, max edge 2048px. Adjustable or off. |
| AI personas & budget | No | Four comment personas, prompts, callout style, and token budget (default "high"). |

All folders must live in the same Obsidian vault. Notes from subfolders are included by default and can be toggled in the header.

**Update, disable, uninstall**

- **Update:** `git pull`, then run the install command again, or disable and re-enable the plugin.
- **Disable:** switch it off on the Plugins page; notes and settings stay put.
- **Uninstall:** remove the plugin on the Plugins page. With a `link:` install the source folder is not deleted, so its `data/settings.json` stays there (already covered by `.gitignore`) and can be cleaned up manually; **notes and attachments in Obsidian are untouched**.

## Usage

### Quick capture

The floating composer sits below the wall. Type an idea as the new `.md` filename and press `Enter`; the title is not duplicated into the body. Press `Tab` to expand the body; clearing it collapses the composer again. A failed submit (duplicate name, overly long filename) keeps your draft and images.

Paste, drag, or use the plus button to attach up to 8 images. They are compressed to static WebP by default; keep originals and animation in settings. New notes reuse the frontmatter of the Obsidian Default Template configured for the current folder.

### Read, edit, and tidy

- Click a card to open the reading panel; double-click the title or body to edit, and press `⌘ / Ctrl + S` to save.
- Saves are version-checked. If Obsidian, an AI comment, or another edit changed the note meanwhile, the save is refused and your draft is kept.
- Tick tasks in reading mode; they are written back as `[ ]` / `[x]` while preserving line breaks and frontmatter.
- Click the pin to keep the panel open on the right; re-entering restores the last note.
- Header controls switch the date range, include/exclude subfolders, and sort by created time, modified time, or filename.

### Four AI perspectives

Click an emoji on a card to ask Harness's current default model about that note. Prompts, callout style, and token budget are configurable.

| Perspective | What you get |
| --- | --- |
| 😈 Sharp | Punctures self-persuasion with one useful, clear-eyed line. |
| ✨ Other side | Reconsiders the note from an angle you hadn't tried. |
| 🧭 Practical | A judgment, the evidence behind it, and the cheapest next step. |
| 😇 Honest | Meets where you are and offers one piece of pressure-free encouragement. |

Comments are appended to the Markdown as Obsidian callouts, so they remain readable in Obsidian. If the same emoji already has a comment, the plugin asks before adding another.

### Open a project, archive, open in Obsidian

- **Open project:** enter a project name; AI creates `<name>/<name>.md` in the project folder with needs, current state, findings, next steps, and open questions, then writes the link back to the source note's `PROJECTS` field.
- **Archive:** moves the Markdown file to the chosen archive folder, with a 6-second undo.
- **Open in Obsidian:** the host opens `obsidian://open?path=<absolute note path>`. Only existing files inside the vault are allowed, and nothing is written.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Create note | `Enter` in the title field |
| Expand / collapse body | `Tab` / `Esc` |
| Submit note | `⌘ / Ctrl + Enter` |
| Back from body to title | `Shift + Tab` |
| Save edit | `⌘ / Ctrl + S` |
| Read / edit | Click a card / double-click title or body |
| Open date-range menu | Hover the calendar icon, or focus it and press `↓` |
| Close menu / panel | `Esc` |

## Data & privacy

- **Notes and images stay in your vault.** The plugin reads and writes the Obsidian folder you choose; it does not import, copy, or maintain a second library.
- **Settings live in the plugin's own `data/settings.json`.** Nothing is written to the DSH profile config or to your Obsidian vault.
- **No separate API key.** AI uses Harness's current default model and is called only when you click a comment or Open project; it does not start a conversation or write chat logs.
- **No telemetry.** The plugin makes no analytics or tracking calls. Remote images inside notes are loaded by the browser, as with any Markdown file.
- **Model calls send the relevant note content to your configured model provider.** That content is the input for the requested comment or project document and is limited to the current note.
- **File boundaries are enforced.** Note, archive, project, and image paths must stay inside the vault; the image folder cannot be a dot-hidden folder; existing files are written atomically and new notes never overwrite a same-name file.
- **Frontmatter is preserved.** Only "Open project" touches frontmatter, updating `PROJECTS`, and an existing non-empty value is never overwritten.
- **Concurrent edits are guarded by a version check.** There is no cross-process file lock; an external write in the very short window between check and write can still race.

## Compatibility & limits

| Item | Notes |
| --- | --- |
| DeepSeek Harness | `>=0.2.2-rc.1 <0.3.0` (`engines.dsh`); developed and verified on 0.2.2-rc.1. |
| Runtime | DSH desktop app or Web GUI. Verified on macOS; Windows/Linux path and open logic is implemented but untested. |
| Obsidian | A local vault, iCloud is fine. No Obsidian community plugin required. |
| Themes | Follows the DSH light and dark themes. |
| Scale | The wall renders 50 notes first and loads more on scroll; hundreds of notes remain usable. |
| Not included | Full-text search, drag-and-drop ordering, batch actions, a dedicated mobile layout, and real-time file watching (external changes are picked up by a 4–30 second poll). |

- Local images support PNG / JPEG / GIF / WebP / SVG / AVIF, up to 8 MB each; card thumbnails only load images up to 1.5 MB (larger ones still open in the reading panel).
- Quick capture accepts up to 8 images: 32 MB each / 64 MB total before compression, 8 MB each / 16 MB total after.
- AI input is capped at 12,000 characters; comments at 4,000 and project documents at 24,000; truncation is reported.
- The plugin is desktop-first; touch devices are not specifically adapted, and the date-range menu has limitations there.

## FAQ

**The notes entry is missing from the sidebar.**

Make sure the plugin is installed and enabled, then restart or refresh DSH. Also check whether the old package name (`dsh-sticky-notes`) is still installed — remove it before installing this one.

**The panel opens but the wall is empty.**

Check the vault root and notes folder in settings, whether the date filter is on and excludes your notes (click the calendar icon to turn it off), whether subfolders are hidden, and whether the folder actually contains `.md` files.

**No AI comment appears.**

Confirm that DSH has a default model configured. If the model spends its whole budget on reasoning, the plugin shows a hint and points you to the budget setting; a shorter prompt can help too. Provider or network errors are reported in a toast.

**It says the filename is duplicated or saving failed.**

The title is the Markdown filename, so names must be unique in the folder. Choose another title or handle the existing file; the draft and selected images are kept on failure and cleared only after success.

**"Open in Obsidian" does nothing.**

Obsidian must be installed and the `obsidian://` protocol registered; only existing files inside the vault can be opened. Otherwise a failure toast is shown and no files are changed.

**Will it damage my notes?**

It won't restructure them: editing replaces only the body after frontmatter, comments are appended at the end, and Open project only updates `PROJECTS`. Obsidian block IDs are hidden in the plugin's display but kept in the file. If an external edit happened meanwhile, the save is refused by the version check.

**Does uninstalling delete my notes?**

No. Notes and attachments remain in your Obsidian vault. Uninstalling removes only the plugin registration; with a `link:` install the source folder and its `data/settings.json` remain and can be cleaned up manually.

**Is this an official Obsidian plugin?**

No. It is a third-party DeepSeek Harness plugin, not affiliated with DeepSeek or Obsidian, and it does not require an Obsidian community plugin; it only reads and writes the local vault you choose.

## Feedback & contributing

- Found a bug or want different behavior? Open an [issue](https://github.com/cavenzhong/dsh-obsidian-memo/issues). Please include the DSH version, plugin version, OS, Obsidian version, steps to reproduce, expected and actual results, and screenshots or logs if possible.
- Pull requests are welcome. The plugin is plain JavaScript with no runtime dependencies and no build step; run `pnpm test` and mention the result in the PR.
- Known issues and deferred items are tracked in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md); search it before filing.

## Development

```bash
cd dsh-obsidian-memo
pnpm test        # unit tests + mock-ctx integration tests + client pure-function tests (281 currently)
```

| Path | Contents |
| --- | --- |
| `lib/index.js` | Host half: RPC routes and business composition. |
| `lib/client.js` | Client half: single-file browser bundle, no build step. |
| `lib/capture.js` / `lib/notes.js` | Note and attachment creation, Markdown parsing and writing. |
| `lib/settings.js` / `lib/scan.js` | Settings, folder scanning and caches. |
| `lib/ai.js` / `lib/obsidian.js` | Model calls and the system opener. |
| `test/` | Tests, run directly with `node --test`. |
| `docs/` | Guide, implementation contract, changelog, known issues. |

See the [usage and development guide](docs/GUIDE.md) (Chinese) for full behavior and the HMR workflow, and the [implementation contract](docs/CONTRACT.md) for API and UX specifications.

## Credits & license

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for its open plugin APIs, and to [Obsidian](https://obsidian.md) for keeping notes as local Markdown.

Released under the [MIT](LICENSE) license, © cavenzhong. This is a third-party plugin with no affiliation to DeepSeek or Obsidian; their names and marks belong to their respective owners.
