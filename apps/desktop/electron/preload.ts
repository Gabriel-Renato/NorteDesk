import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
  };
  sourceId: string | null;
  thumbnailDataUrl: string | null;
}

const api = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  setCaptureDisplay: (payload: { bounds: DisplayInfo['bounds']; sourceId: string }) =>
    ipcRenderer.invoke('session:setCaptureDisplay', payload),
  setSessionActive: (active: boolean) => ipcRenderer.invoke('session:setActive', active),
  setControlGranted: (granted: boolean) =>
    ipcRenderer.invoke('session:setControlGranted', granted),
  applyInput: (event: unknown) => ipcRenderer.invoke('input:apply', event),
  releaseAllInput: () => ipcRenderer.invoke('input:releaseAll'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  onEmergencyEnd: (cb: () => void) => {
    const listener = (_event: IpcRendererEvent) => cb();
    ipcRenderer.on('session:emergency-end', listener);
    return () => ipcRenderer.removeListener('session:emergency-end', listener);
  },
};

contextBridge.exposeInMainWorld('nortedesk', api);
