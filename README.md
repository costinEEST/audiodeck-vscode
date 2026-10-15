# AudioDeck

**Local audio playlists inside VS Code.**

A minimalist audio player that lives in the VS Code sidebar, with focused tools for learning languages by listening.

Add a folder of lessons, press play, and keep coding. Slow a sentence down, loop it until it sticks, jump back five seconds, and come back tomorrow exactly where you stopped.

## Contents

- [Features](#features)
- [A typical study loop](#a-typical-study-loop)
- [Shortcuts](#shortcuts)
- [Settings](#settings)
- [Installation and development](#installation-and-development)
  - [Install a packaged build](#install-a-packaged-build)
  - [Develop locally](#develop-locally)
  - [Validate and package a release](#validate-and-package-a-release)
  - [GitHub Actions](#github-actions)
- [How it works](#how-it-works)
- [Inspiration and credits](#inspiration-and-credits)

## Features

| | |
|---|---|
| **Playlist** | Add files or whole folders (recursive, natural order: `Lesson 2` before `Lesson 10`). Click to play, drag to reorder, hover × to remove. Remembered across restarts. |
| **Transport** | Play/pause, previous/next, skip back/forward (default 5 s), seek bar. |
| **Speed** | 0.25×–3× with pitch preserved — fine 0.05 steps below 1× (0.75, 0.8, 0.85…). Click the value to reset to 1×. |
| **A–B loop** | Click once to set A, again to set B — that section repeats. Third click clears. Shown as a band on the seek bar. |
| **Bookmarks** | Mark useful moments in a lesson, jump back to them, or remove them. Saved per recording. |
| **Repeat / shuffle** | Repeat playlist → repeat track → off. Shuffle on/off. |
| **Resume** | Each recording remembers its last position (shown next to the track). |
| **Background play** | Keeps playing when the sidebar is hidden. Status bar shows the track; click it to play/pause. |
| **Explorer** | Right-click audio files or folders → *Play in AudioDeck* / *Add to AudioDeck*. |

Formats: **MP3**, WAV, OGG/Opus, FLAC, WebM. (AAC/M4A are not decoded by VS Code's built-in Chromium, so they show a clear error instead of playing.)

## A typical study loop

1. Right-click your course folder → **Play in AudioDeck**.
2. Hear a phrase you didn't catch → `Ctrl+Alt+←`.
3. Still too fast → `Ctrl+Alt+[` a couple of times (0.9×, 0.85×).
4. Want to drill it → `Ctrl+Alt+L` at the start, `Ctrl+Alt+L` at the end; shadow it until it's yours, then `Ctrl+Alt+L` to release.

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

In VS Code, open **Extensions → ··· → Install from VSIX…** and select the generated `audio-deck-<version>.vsix` file.

You can also install it from the terminal:

```bash
code --install-extension audio-deck-0.3.0.vsix
```

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

### GitHub Actions

The CI workflow runs automatically for every pull request and every push to `main`. It performs a clean dependency install, runs `npm run check`, packages the extension, and uploads the VSIX as the **audio-deck-vsix** workflow artifact for 14 days.

To build an artifact without pushing code, open **Actions → CI → Run workflow** on GitHub. After the run succeeds, download **audio-deck-vsix** from the workflow run's **Artifacts** section.

## How it works

- `src/extension.ts` — a `WebviewViewProvider` in its own activity-bar container (`retainContextWhenHidden` keeps audio alive), commands, keybindings, status bar, folder scanning, and persistence in `globalState`.
- `media/player.js` / `player.css` — plain HTML/CSS/JS UI themed with VS Code's CSS variables; no frameworks, no runtime dependencies.
- Selected local audio is exposed to the webview through VS Code's protected resource URLs. The allow-list is limited to folders represented in the playlist, so large lessons stream without loading the entire file into extension-host memory.

## Inspiration and credits

AudioDeck was most influenced by these open-source VS Code audio players:

1. [Plyr](https://github.com/manyeya/plyr) — the strongest architectural influence: an always-available sidebar player, persistent playlists, background playback, status-bar integration, drag-to-reorder, and controls that follow the active VS Code theme.
2. [BeatBox](https://github.com/pinkpixel-dev/beatbox) — demonstrated how a local music player can feel at home in the Activity Bar and remain convenient during focused coding sessions.
3. [RetroAmp](https://github.com/gearscrafter/retroamp) — inspired the compact, recognizable transport-first experience and the idea that a complete local playlist can live inside a persistent VS Code sidebar.

AudioDeck takes a deliberately quieter direction focused on local recordings and language practice, including fine-grained speed control, configurable skipping, saved positions, bookmarks, and A–B phrase looping. No source code or visual assets were copied from these projects; they are credited for the product ideas and interaction patterns that helped shape AudioDeck.
