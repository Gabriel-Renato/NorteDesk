/// <reference types="vite/client" />

import type { DisplayInfo } from '../electron/preload';

interface NorteDeskApi {
  getInfo: () => Promise<{
    version: string;
    platform: string;
    nativeInput: { ok: boolean; detail: string };
  } | null>;
  listDisplays: () => Promise<DisplayInfo[]>;
  setCaptureDisplay: (payload: {
    bounds: DisplayInfo['bounds'];
    sourceId: string;
  }) => Promise<{ ok: boolean }>;
  setSessionActive: (active: boolean) => Promise<{ ok: boolean }>;
  setControlGranted: (granted: boolean) => Promise<{ ok: boolean; granted?: boolean }>;
  applyInput: (event: unknown) => Promise<{ applied: boolean; reason?: string }>;
  releaseAllInput: () => Promise<{ ok: boolean }>;
  writeClipboard: (text: string) => Promise<{ ok: boolean }>;
  onEmergencyEnd: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    nortedesk: NorteDeskApi;
  }
}

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
