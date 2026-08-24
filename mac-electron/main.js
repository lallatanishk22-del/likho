const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, nativeImage, screen } = require("electron");
const path = require("path");

const SHORTCUT = "Alt+Z";

let popup = null;
let tray = null;
let routeParseOrder = null;

// Electron's main process IS Node.js, so the EXISTING Likho core is
// imported directly, in-process — no subprocess, no stdin/stdout bridge.
// The core is compiled as an ES module (root package.json "type":"module"),
// so it's loaded via dynamic import() from this CommonJS main process.
// Requires `npm run build` to have been run in the repo root first.
async function loadCore() {
  const mod = await import("../dist/src/router.js");
  routeParseOrder = mod.routeParseOrder;
}

function createPopup() {
  const win = new BrowserWindow({
    width: 420,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "popup.html"));
  win.on("blur", () => win.hide());
  return win;
}

function showPopup() {
  if (!popup || popup.isDestroyed()) {
    popup = createPopup();
  }
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + (display.workArea.width - 420) / 2);
  const y = display.workArea.y + 120;
  popup.setPosition(x, y);
  popup.webContents.send("reset");
  popup.show();
  popup.focus();
}

// Small solid-color tray icon, generated inline — no external asset file
// needed for this minimal V1.
function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 30; // R
    buffer[i + 1] = 30; // G
    buffer[i + 2] = 30; // B
    buffer[i + 3] = 255; // A
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

app.whenReady().then(async () => {
  await loadCore();

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Likho");
  tray.on("click", showPopup);

  const registered = globalShortcut.register(SHORTCUT, showPopup);
  if (!registered) {
    console.error(`Failed to register global shortcut ${SHORTCUT}`);
  }

  ipcMain.handle("run-zbill", async () => {
    const text = clipboard.readText();
    if (!text || text.trim().length === 0) {
      return { ok: false, error: "Clipboard is empty. Copy the order text first, then press Enter." };
    }
    try {
      const { parsed } = await routeParseOrder(text);
      return { ok: true, parsed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.on("hide-popup", () => {
    popup?.hide();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// No Dock/menu-bar app window-close-quits-app behavior wanted — this is a
// background utility, stays alive via the tray icon.
app.on("window-all-closed", (event) => {
  event.preventDefault();
});
