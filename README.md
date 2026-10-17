# AudioDeck

**Local audio playlists inside VS Code.**

A minimalist audio player that lives in the VS Code sidebar, with practical controls for listening without leaving your workspace.

Add a folder of audio, press play, and keep coding. Adjust the speed, loop a section, jump back five seconds, and come back tomorrow exactly where you stopped.

## Contents

- [Features](#features)
- [A typical listening flow](#a-typical-listening-flow)
- [Shortcuts](#shortcuts)
- [Settings](#settings)
- [Installation and development](#installation-and-development)
  - [Install a packaged build](#install-a-packaged-build)
  - [Check command-line access](#check-command-line-access)
  - [Develop locally](#develop-locally)
  - [Validate and package a release](#validate-and-package-a-release)
  - [CI artifacts and releases](#ci-artifacts-and-releases)
- [How it works](#how-it-works)
- [Inspiration and credits](#inspiration-and-credits)

## Features

| | |
|---|---|
| **Playlist** | Add files or whole folders (recursive, natural order: `Track 2` before `Track 10`). Click to play, drag to reorder, hover × to remove. Remembered across restarts. |
| **Transport** | Play/pause, previous/next, skip back/forward (default 5 s), seek bar. |
| **Speed** | 0.25×–3× with pitch preserved — fine 0.05 steps below 1× (0.75, 0.8, 0.85…). Click the value to reset to 1×. |
| **A–B loop** | Click once to set A, again to set B — that section repeats. Third click clears. Shown as a band on the seek bar. |
| **Bookmarks** | Mark useful moments in a track, jump back to them, or remove them. Saved per audio file. |
| **Repeat / shuffle** | Repeat playlist → repeat track → off. Shuffle on/off. |
| **Resume** | Each audio file remembers its last position (shown next to the track). |
| **Background play** | Keeps playing when the sidebar is hidden. Status bar shows the track; click it to play/pause. |
| **Explorer** | Right-click audio files or folders → *Play in AudioDeck* / *Add to AudioDeck*. |

Formats: **MP3**, WAV, OGG/Opus, FLAC, WebM. (AAC/M4A are not decoded by VS Code's built-in Chromium, so they show a clear error instead of playing.)

## A typical listening flow

1. Right-click a folder of audio → **Play in AudioDeck**.
2. Want to hear a moment again → `Ctrl+Alt+←`.
3. Need more detail → `Ctrl+Alt+[` a couple of times (0.9×, 0.85×).
4. Want to repeat a section → `Ctrl+Alt+L` at the start, `Ctrl+Alt+L` at the end, then `Ctrl+Alt+L` again to clear the loop.

## Shortcuts

Global (work from the editor; rebind in *Keyboard Shortcuts*):

| Action | Keys |
|---|---|
| Play / pause | `Ctrl+Alt+Space` |
| Skip back / forward | `Ctrl+Alt+←` / `Ctrl+Alt+→` |
| Previous / next track | `Ctrl+Alt+,` / `Ctrl+Alt+.` |
| Slower / faster | `Ctrl+Alt+[` / `Ctrl+Alt+]` |
| A–B loop (set A → set B → clear) | `Ctrl+Alt+L` |

Inside the player panel: `Space` play/pause · `←/→` skip · `Shift+←/→` prev/next · `[` `]` speed · `=` reset speed · `L` A–B loop · `B` bookmark · `Esc` clear loop · `M` mute · `R` repeat · `S` shuffle.

## Settings

| Setting | Default | |
|---|---|---|
| `audioDeck.skipSeconds` | `5` | Seconds for skip back/forward |
| `audioDeck.resumePosition` | `true` | Resume each file where you left off |
| `audioDeck.statusBar` | `true` | Show track + play/pause in the status bar |

## Installation and development

### Install a packaged build

Download [audio-deck-0.3.0.vsix](https://github.com/costinEEST/audiodeck-vscode/releases/latest/download/audio-deck-0.3.0.vsix) from the latest GitHub Release. In VS Code or Kiro, open **Extensions → ··· → Install from VSIX…** and select the downloaded file.

You can also install it from the terminal into VS Code or Kiro IDE:

```bash
code --install-extension audio-deck-0.3.0.vsix
kiro --install-extension audio-deck-0.3.0.vsix
```

`kiro` here is the Kiro IDE launcher, not the separate `kiro-cli` AI-agent command.

### Check command-line access

On macOS or Linux, check whether the VS Code and Kiro IDE launchers are on `PATH`:

```bash
command -v code
command -v kiro
```

On Windows PowerShell:

```powershell
Get-Command code
Get-Command kiro
```

On Windows Command Prompt:

```bat
where code
where kiro
```

Each successful command prints the launcher location. A "not found" or "not recognized" result means that launcher is not on `PATH`. In VS Code or Kiro on macOS, open the Command Palette and run the relevant **Shell Command: Install ... command in PATH** action. On Windows and Linux, reinstall with the launcher's `PATH` option enabled or add its installation directory to `PATH`, then open a new terminal.

### Develop locally

Use Node.js 20.19 or newer. After cloning the repository, install the exact dependencies recorded in `package-lock.json`:

```bash
npm ci
```

Press `F5` in VS Code to compile the extension and launch an Extension Development Host. During development, use:

```bash
npm run watch     # recompile TypeScript when files change
npm run lint      # lint TypeScript and webview JavaScript
npm run compile   # compile src/ into out/
```

Use `npm install <package> --save-dev` only when intentionally adding or updating a development dependency; commit the resulting `package.json` and `package-lock.json` changes.

### Validate and package a release

Before committing or opening a pull request, run:

```bash
npm run check
```

This runs Oxlint, compiles TypeScript, and checks the webview JavaScript syntax. To produce an installable VSIX, run:

```bash
npm run check && npm run package
```

`npm run package` also compiles automatically and creates `audio-deck-<version>.vsix` in the repository root. The version and filename come from `package.json`; update its `version` field before preparing a new release.

### CI artifacts and releases

The CI workflow runs automatically for every pull request and every push to `main`. It performs a clean dependency install, runs `npm run check`, packages the extension, and uploads a versioned workflow artifact such as **audio-deck-0.3.0.vsix** for 14 days.

To build an artifact without pushing code, open **Actions → CI → Run workflow** on GitHub. After the run succeeds, download the versioned `.vsix` file directly from the workflow run's **Artifacts** section. Workflow artifacts are temporary and expire after 14 days.

For a permanent, directly downloadable `.vsix`, publish a GitHub Release by pushing a version tag. `package.json` is the single source of truth for the version; the tag, README filename, and generated VSIX must all match it. For the current version `0.3.0` (already set in `package.json`):

```bash
# Run this first for a future release, using its new version:
# npm version 0.3.1 --no-git-tag-version
# Update README.md if the displayed filename changed, then commit the changes.
git tag -a v0.3.0 -m "Release AudioDeck 0.3.0"
git push origin main
git push origin v0.3.0
```

The `v0.3.0` tag triggers the release job, which creates the GitHub Release and attaches `audio-deck-0.3.0.vsix`. If the tag does not equal `v` plus the version in `package.json`, or the README does not mention the matching filename, the workflow fails instead of publishing an ambiguously versioned release.

## How it works

- `src/extension.ts` — a `WebviewViewProvider` in its own activity-bar container (`retainContextWhenHidden` keeps audio alive), commands, keybindings, status bar, folder scanning, and persistence in `globalState`.
- `media/player.js` / `player.css` — plain HTML/CSS/JS UI themed with VS Code's CSS variables; no frameworks, no runtime dependencies.
- Selected local audio is exposed to the webview through VS Code's protected resource URLs. The allow-list is limited to folders represented in the playlist, so large files stream without loading the entire track into extension-host memory.

## Inspiration and credits

AudioDeck was influenced by [Plyr](https://github.com/manyeya/plyr), particularly its always-available sidebar player, persistent playlist, background playback, status-bar integration, drag-to-reorder interaction, and controls that follow the active VS Code theme.

AudioDeck takes a deliberately quieter direction focused on convenient local audio playback, including fine-grained speed control, configurable skipping, saved positions, bookmarks, and A–B section looping. No source code or visual assets were copied from Plyr; it is credited for the product ideas and interaction patterns that helped shape AudioDeck.
