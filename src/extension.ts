import * as vscode from "vscode";
import * as path from "node:path";

const AUDIO_EXT = [
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".m4a",
  ".aac",
  ".webm",
];
const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
};
const STATE_KEY = "audioDeck.state";
const LEGACY_STATE_KEY = "linguaPlayer.state";
const MAX_TRACKS = 10_000;

interface Track {
  path: string;
  name: string;
}

interface PlayerState {
  tracks: Track[];
  index: number;
  volume: number;
  rate: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  positions: Record<string, number>;
  bookmarks: Record<string, number[]>;
}

const DEFAULT_STATE: PlayerState = {
  tracks: [],
  index: -1,
  volume: 1,
  rate: 1,
  repeat: "all",
  shuffle: false,
  positions: {},
  bookmarks: {},
};

const isAudio = (p: string) =>
  AUDIO_EXT.includes(path.extname(p).toLowerCase());
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeState(value: unknown): PlayerState {
  const raw =
    value && typeof value === "object" ? (value as Partial<PlayerState>) : {};
  const seen = new Set<string>();
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.slice(0, MAX_TRACKS).flatMap((track) => {
        if (
          !track ||
          typeof track.path !== "string" ||
          !path.isAbsolute(track.path) ||
          !isAudio(track.path) ||
          seen.has(track.path)
        ) {
          return [];
        }
        seen.add(track.path);
        return [
          {
            path: track.path,
            name:
              typeof track.name === "string" && track.name.trim()
                ? track.name.slice(0, 500)
                : path.basename(track.path, path.extname(track.path)),
          },
        ];
      })
    : [];
  const positions: Record<string, number> = {};
  const bookmarks: Record<string, number[]> = {};
  for (const track of tracks) {
    const position = raw.positions?.[track.path];
    if (
      typeof position === "number" &&
      Number.isFinite(position) &&
      position >= 0
    )
      positions[track.path] = position;
    const marks = raw.bookmarks?.[track.path];
    if (Array.isArray(marks))
      bookmarks[track.path] = [
        ...new Set(
          marks
            .filter(
              (mark) =>
                typeof mark === "number" && Number.isFinite(mark) && mark >= 0,
            )
            .map((mark) => Math.round(mark * 10) / 10),
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, 100);
  }
  const volume =
    typeof raw.volume === "number" && Number.isFinite(raw.volume)
      ? Math.min(1, Math.max(0, raw.volume))
      : DEFAULT_STATE.volume;
  const rate =
    typeof raw.rate === "number" && Number.isFinite(raw.rate)
      ? Math.min(3, Math.max(0.25, raw.rate))
      : DEFAULT_STATE.rate;
  const index = Number.isInteger(raw.index)
    ? Math.min(tracks.length - 1, Math.max(-1, raw.index as number))
    : tracks.length
      ? 0
      : -1;
  return {
    tracks,
    index,
    volume,
    rate,
    repeat: ["off", "all", "one"].includes(raw.repeat ?? "")
      ? raw.repeat!
      : DEFAULT_STATE.repeat,
    shuffle: raw.shuffle === true,
    positions,
    bookmarks,
  };
}

class PlayerProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private queue: unknown[] = [];
  private status: vscode.StatusBarItem;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.status.command = "audioDeck.togglePlay";
    ctx.subscriptions.push(this.status);
  }

  // ---------- state ----------
  get state(): PlayerState {
    return normalizeState(
      this.ctx.globalState.get(STATE_KEY) ??
        this.ctx.globalState.get(LEGACY_STATE_KEY),
    );
  }

  private async save(patch: Partial<PlayerState>) {
    await this.ctx.globalState.update(
      STATE_KEY,
      normalizeState({ ...this.state, ...patch }),
    );
  }

  private async saveFromWebview(value: unknown) {
    const incoming = normalizeState(value);
    const existing = new Map(
      this.state.tracks.map((track) => [track.path, track]),
    );
    incoming.tracks = incoming.tracks.flatMap((track) =>
      existing.has(track.path) ? [existing.get(track.path)!] : [],
    );
    if (incoming.index >= incoming.tracks.length)
      incoming.index = incoming.tracks.length - 1;
    await this.ctx.globalState.update(STATE_KEY, incoming);
  }

  private config() {
    const c = vscode.workspace.getConfiguration("audioDeck");
    return {
      skipSeconds: c.get<number>("skipSeconds", 5),
      resumePosition: c.get<boolean>("resumePosition", true),
    };
  }

  // ---------- webview ----------
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: this.resourceRoots(media),
    };
    view.webview.html = this.html(view.webview, media);

    view.webview.onDidReceiveMessage(
      (m) => this.onMessage(m),
      undefined,
      this.ctx.subscriptions,
    );
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
      this.status.hide();
    });
  }

  private post(msg: unknown) {
    if (this.view && this.ready) {
      this.view.webview.postMessage(msg);
    } else {
      this.queue.push(msg);
    }
  }

  /** Make sure the view exists (opening it if needed), then send. */
  async send(msg: unknown) {
    if (!this.view) {
      this.queue.push(msg);
      await vscode.commands.executeCommand("audioDeck.view.focus");
      return;
    }
    this.post(msg);
  }

  pushConfig() {
    this.post({ type: "config", config: this.config() });
  }

  private async onMessage(m: any) {
    switch (m.type) {
      case "ready": {
        this.ready = true;
        this.view!.webview.postMessage({
          type: "init",
          state: this.state,
          config: this.config(),
        });
        const pending = this.queue;
        this.queue = [];
        pending.forEach((q) => this.view!.webview.postMessage(q));
        break;
      }
      case "save":
        await this.saveFromWebview(m.state);
        break;
      case "load":
        await this.loadAudio(m.index, m.path);
        break;
      case "pickFiles":
        await this.pickFiles();
        break;
      case "pickFolder":
        await this.pickFolder();
        break;
      case "now":
        this.updateStatus(m.name, m.playing);
        break;
      case "reveal":
        vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(m.path),
        );
        break;
    }
  }

  private async loadAudio(index: number, filePath: string) {
    const track = this.state.tracks.find(
      (candidate) => candidate.path === filePath,
    );
    if (!track) {
      this.post({
        type: "loadError",
        index,
        path: filePath,
        message: "The track is not in the playlist.",
      });
      return;
    }
    const uri = vscode.Uri.file(filePath);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const mime = MIME[path.extname(filePath).toLowerCase()] ?? "audio/mpeg";
      if (!(stat.type & vscode.FileType.File))
        throw new Error("Not a regular file");
      this.refreshResourceRoots();
      const src = this.view?.webview.asWebviewUri(uri).toString();
      if (!src) throw new Error("Player view is not available");
      this.post({ type: "audio", index, path: filePath, mime, src });
    } catch (e: any) {
      this.post({
        type: "loadError",
        index,
        path: filePath,
        message: e?.message ?? String(e),
      });
    }
  }

  private resourceRoots(
    media = vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
  ): vscode.Uri[] {
    const roots = new Map<string, vscode.Uri>([[media.toString(), media]]);
    for (const track of this.state.tracks) {
      const root = vscode.Uri.file(path.dirname(track.path));
      roots.set(root.toString(), root);
    }
    return [...roots.values()];
  }

  private refreshResourceRoots() {
    if (this.view)
      this.view.webview.options = {
        enableScripts: true,
        localResourceRoots: this.resourceRoots(),
      };
  }

  private updateStatus(name: string | null, playing: boolean) {
    const enabled = vscode.workspace
      .getConfiguration("audioDeck")
      .get<boolean>("statusBar", true);
    if (!name || !enabled) {
      this.status.hide();
      return;
    }
    const short = name.length > 32 ? name.slice(0, 31) + "…" : name;
    this.status.text = `${playing ? "$(debug-pause)" : "$(play)"} ${short}`;
    this.status.tooltip = `${name}\nClick to ${playing ? "pause" : "play"}`;
    this.status.show();
  }

  // ---------- adding audio ----------
  async addUris(uris: vscode.Uri[], play = false) {
    const files: string[] = [];
    for (const uri of uris) {
      files.push(...(await collectAudio(uri)));
    }
    if (!files.length) {
      vscode.window.showInformationMessage("AudioDeck: no audio files found.");
      return;
    }
    const tracks = [...this.state.tracks];
    const known = new Set(tracks.map((t) => t.path));
    let firstIndex = -1;
    for (const f of files) {
      if (!known.has(f)) {
        tracks.push({ path: f, name: path.basename(f, path.extname(f)) });
        known.add(f);
      }
      if (firstIndex < 0) {
        firstIndex = tracks.findIndex((t) => t.path === f);
      }
    }
    await this.save({ tracks });
    this.refreshResourceRoots();
    await this.send({ type: "tracks", tracks, play: play ? firstIndex : -1 });
  }

  async pickFiles() {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Add to playlist",
      filters: { Audio: AUDIO_EXT.map((e) => e.slice(1)) },
    });
    if (uris?.length) {
      await this.addUris(uris);
    }
  }

  async pickFolder() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: "Add folder",
    });
    if (uris?.length) {
      await this.addUris(uris);
    }
  }

  async clear() {
    const pick = await vscode.window.showWarningMessage(
      "Clear the whole playlist?",
      { modal: true },
      "Clear",
    );
    if (pick === "Clear") {
      await this.save({ tracks: [], index: -1 });
      await this.send({ type: "tracks", tracks: [], play: -1 });
    }
  }

  // ---------- html ----------
  private html(webview: vscode.Webview, media: vscode.Uri) {
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "player.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "player.js"));
    const nonce = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 36).toString(36),
    ).join("");
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `media-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>AudioDeck</title>
</head>
<body>
  <section class="now" aria-label="Now playing">
    <div class="title" id="title">Nothing playing</div>
    <div class="seek">
      <div class="seek-track" id="seekTrack">
        <div class="seek-loop" id="seekLoop" hidden></div>
        <div class="seek-fill" id="seekFill"></div>
        <input type="range" id="seek" min="0" max="1000" value="0" step="1" aria-label="Seek" />
      </div>
      <div class="times"><span id="cur">0:00</span><span id="dur">0:00</span></div>
    </div>

    <div class="controls">
      <button class="icon" id="prev" data-tooltip="Previous track · Shift+←" aria-label="Previous track"></button>
      <button class="icon" id="back" data-tooltip="Skip back · ←" aria-label="Skip back"></button>
      <button class="icon play" id="play" data-tooltip="Play · Space" aria-label="Play"></button>
      <button class="icon" id="fwd" data-tooltip="Skip forward · →" aria-label="Skip forward"></button>
      <button class="icon" id="next" data-tooltip="Next track · Shift+→" aria-label="Next track"></button>
    </div>

    <div class="tools">
      <div class="speed" title="Playback speed (Ctrl+Alt+[ / ])">
        <button class="chip" id="slower" data-tooltip="Slow down · [" aria-label="Slower">−</button>
        <button class="chip rate" id="rate" data-tooltip="Reset speed to 1× · =" aria-label="Reset speed to 1×">1×</button>
        <button class="chip" id="faster" data-tooltip="Speed up · ]" aria-label="Faster">+</button>
      </div>
      <button class="chip" id="ab" data-tooltip="Set or clear an A–B phrase loop · L" aria-label="Set or clear an A–B phrase loop">A–B</button>
      <button class="chip" id="mark" data-tooltip="Bookmark this moment · B" aria-label="Bookmark the current moment">+ Mark</button>
      <button class="chip icon-chip" id="repeat" data-tooltip="Change repeat mode · R" aria-label="Repeat mode"></button>
      <button class="chip icon-chip" id="shuffle" data-tooltip="Toggle shuffle · S" aria-label="Shuffle"></button>
      <div class="vol">
        <button class="chip icon-chip" id="mute" data-tooltip="Mute or unmute · M" aria-label="Mute"></button>
        <input type="range" id="volume" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
      </div>
    </div>
    <div class="bookmarks" id="bookmarks" hidden aria-label="Bookmarks"></div>
  </section>

  <section class="list" aria-label="Playlist">
    <header>
      <span id="count">Playlist</span>
      <div class="list-actions">
        <button class="link" id="addFiles">+ Files</button>
        <button class="link" id="addFolder">+ Folder</button>
      </div>
    </header>
    <ol id="tracks"></ol>
    <div class="empty" id="empty">
      <p>Your playlist is empty.</p>
      <p><button class="primary" id="emptyAdd">Add audio files</button></p>
      <p class="hint">Or right-click files / folders in the Explorer → <em>Play in AudioDeck</em>.</p>
    </div>
  </section>

  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

async function collectAudio(uri: vscode.Uri): Promise<string[]> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      entries.sort((a, b) => collator.compare(a[0], b[0]));
      const out: string[] = [];
      for (const [name, type] of entries) {
        if (name.startsWith(".")) {
          continue;
        }
        const child = vscode.Uri.joinPath(uri, name);
        if (type & vscode.FileType.Directory) {
          out.push(...(await collectAudio(child)));
        } else if (isAudio(name)) {
          out.push(child.fsPath);
        }
      }
      return out;
    }
    return isAudio(uri.fsPath) ? [uri.fsPath] : [];
  } catch {
    return [];
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  const provider = new PlayerProvider(ctx);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("audioDeck.view", provider, {
      // keep audio playing while the sidebar is hidden
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const control = (name: string) => () =>
    provider.send({ type: "command", name });
  const fromExplorer =
    (play: boolean) => (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const list = uris?.length ? uris : uri ? [uri] : [];
      return list.length ? provider.addUris(list, play) : provider.pickFiles();
    };

  const reg = (id: string, fn: (...a: any[]) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("audioDeck.addFiles", () => provider.pickFiles());
  reg("audioDeck.addFolder", () => provider.pickFolder());
  reg("audioDeck.addFromExplorer", fromExplorer(false));
  reg("audioDeck.playFromExplorer", fromExplorer(true));
  reg("audioDeck.clear", () => provider.clear());
  for (const c of [
    "togglePlay",
    "next",
    "prev",
    "back",
    "forward",
    "speedUp",
    "speedDown",
    "loopAB",
  ]) {
    reg(`audioDeck.${c}`, control(c));
  }

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("audioDeck")) {
        provider.pushConfig();
      }
    }),
  );
}

export function deactivate() {}
