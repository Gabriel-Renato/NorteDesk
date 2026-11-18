import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ControlEvent, DisplayBounds } from '@nortedesk/protocol';
import { parseControlEvent } from '@nortedesk/protocol';
import { InputController } from './input-controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// WSL / GPUs problemáticas: evita janela preta/em branco.
app.disableHardwareAcceleration();
Menu.setApplicationMenu(null);

let mainWindow: BrowserWindow | null = null;
let selectedDisplay: DisplayBounds | null = null;
let sessionActive = false;
let controlGranted = false;

const inputController = new InputController({
  getDisplay: () => selectedDisplay,
  isControlAllowed: () => sessionActive && controlGranted,
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    title: 'NorteDesk',
    show: false,
    backgroundColor: '#f3f5f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[nortedesk] falha ao carregar UI', { code, desc, url });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (isDev && url.startsWith('http://localhost:5173')) ||
      url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}]`, message);
  });

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
    // DevTools sob demanda (F12) — não abrir sozinho pra não cobrir a UI.
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      if (!sessionActive) {
        callback(null as unknown as Electron.Streams);
        return;
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length) {
        callback(null as unknown as Electron.Streams);
        return;
      }

      const preferredId = (globalThis as { __nortedeskSourceId?: string }).__nortedeskSourceId;
      const chosen =
        (preferredId ? sources.find((s) => s.id === preferredId) : undefined) ?? sources[0]!;

      callback({ video: chosen });
    } catch {
      callback(null as unknown as Electron.Streams);
    }
  });
}

function registerIpc(): void {
  const senderOk = (event: Electron.IpcMainInvokeEvent): boolean => {
    const wc = event.sender;
    if (!mainWindow || wc.id !== mainWindow.webContents.id) return false;
    const url = wc.getURL();
    if (isDev) return url.startsWith('http://localhost:5173');
    return url.startsWith('file://');
  };

  ipcMain.handle('app:getInfo', (event) => {
    if (!senderOk(event)) return null;
    return {
      version: app.getVersion(),
      platform: process.platform,
      nativeInput: inputController.getAvailability(),
    };
  });

  ipcMain.handle('displays:list', async (event) => {
    if (!senderOk(event)) return [];
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 },
    });

    return displays.map((d, index) => {
      const source =
        sources.find((s) => s.display_id && s.display_id === String(d.id)) ??
        sources[index] ??
        sources[0];
      return {
        id: d.id,
        label: `Monitor ${index + 1} (${d.size.width}×${d.size.height} @ ${Math.round(d.scaleFactor * 100)}%)`,
        bounds: {
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
          scaleFactor: d.scaleFactor,
        } satisfies DisplayBounds,
        sourceId: source?.id ?? null,
        thumbnailDataUrl: source?.thumbnail.toDataURL() ?? null,
      };
    });
  });

  ipcMain.handle(
    'session:setCaptureDisplay',
    (event, payload: { bounds: DisplayBounds; sourceId: string }) => {
      if (!senderOk(event)) return { ok: false };
      selectedDisplay = payload.bounds;
      (globalThis as { __nortedeskSourceId?: string }).__nortedeskSourceId = payload.sourceId;
      return { ok: true };
    },
  );

  ipcMain.handle('session:setActive', (event, active: boolean) => {
    if (!senderOk(event)) return { ok: false };
    sessionActive = active;
    if (!active) {
      controlGranted = false;
      inputController.setEnabled(false);
      void inputController.releaseAll();
      selectedDisplay = null;
      delete (globalThis as { __nortedeskSourceId?: string }).__nortedeskSourceId;
    }
    return { ok: true };
  });

  ipcMain.handle('session:setControlGranted', (event, granted: boolean) => {
    if (!senderOk(event)) return { ok: false };
    controlGranted = Boolean(granted) && sessionActive;
    inputController.setEnabled(controlGranted);
    if (!controlGranted) {
      void inputController.releaseAll();
    }
    return { ok: true, granted: controlGranted };
  });

  ipcMain.handle('input:apply', async (event, raw: unknown) => {
    if (!senderOk(event)) return { applied: false, reason: 'origem_invalida' };
    const parsed = parseControlEvent(raw);
    if (!parsed.ok) return { applied: false, reason: 'evento_invalido' };
    return inputController.handleEvent(parsed.data as ControlEvent);
  });

  ipcMain.handle('input:releaseAll', async (event) => {
    if (!senderOk(event)) return { ok: false };
    await inputController.releaseAll();
    return { ok: true };
  });

  ipcMain.handle('clipboard:writeText', async (event, text: string) => {
    if (!senderOk(event)) return { ok: false };
    if (typeof text !== 'string' || text.length > 64) return { ok: false };
    const { clipboard } = await import('electron');
    clipboard.writeText(text);
    return { ok: true };
  });
}

function registerEmergencyShortcut(): void {
  // Ctrl+Shift+Alt+Esc — atalho global de emergência para encerrar sessão
  const ok = globalShortcut.register('CommandOrControl+Shift+Alt+Escape', () => {
    controlGranted = false;
    sessionActive = false;
    inputController.setEnabled(false);
    void inputController.releaseAll();
    mainWindow?.webContents.send('session:emergency-end');
  });
  if (!ok) {
    console.warn('[nortedesk] falha ao registrar atalho de emergência');
  }
}

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  registerIpc();
  createWindow();
  registerEmergencyShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  void inputController.releaseAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void inputController.releaseAll();
});

// Bloquear permissões sensíveis não necessárias
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = permission === 'media' || permission === 'display-capture';
    callback(allow);
  });
});
