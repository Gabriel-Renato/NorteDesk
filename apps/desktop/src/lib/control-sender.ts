import {
  MouseMoveCoalescer,
  elementPointToNormalized,
  type ControlEvent,
} from '@nortedesk/protocol';
import type { WebRtcSession } from './webrtc';

export class ControlSender {
  private readonly coalescer = new MouseMoveCoalescer(1000 / 60);
  private flushTimer: number | null = null;
  private enabled = false;
  private viewerFocused = false;

  constructor(
    private readonly rtc: WebRtcSession,
    private readonly getLayout: () => {
      elementWidth: number;
      elementHeight: number;
      videoWidth: number;
      videoHeight: number;
    },
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.send({ type: 'input.release_all', ts: Date.now() });
    }
  }

  setViewerFocused(focused: boolean): void {
    if (this.viewerFocused && !focused) {
      this.send({ type: 'input.release_all', ts: Date.now() });
    }
    this.viewerFocused = focused;
  }

  onMouseMove(clientX: number, clientY: number): void {
    if (!this.enabled || !this.viewerFocused) return;
    const norm = elementPointToNormalized(this.getLayout(), clientX, clientY);
    if (!norm) return;
    const coalesced = this.coalescer.push(norm.x, norm.y, Date.now());
    if (coalesced) {
      this.send({ type: 'mouse.move', x: coalesced.x, y: coalesced.y, ts: coalesced.ts });
    } else {
      this.scheduleFlush();
    }
  }

  onMouseDown(button: 'left' | 'right' | 'middle', clientX: number, clientY: number): void {
    if (!this.enabled || !this.viewerFocused) return;
    const norm = elementPointToNormalized(this.getLayout(), clientX, clientY);
    if (!norm) return;
    this.flushMoves();
    this.send({ type: 'mouse.down', button, x: norm.x, y: norm.y, ts: Date.now() });
  }

  onMouseUp(button: 'left' | 'right' | 'middle', clientX: number, clientY: number): void {
    if (!this.enabled || !this.viewerFocused) return;
    const norm = elementPointToNormalized(this.getLayout(), clientX, clientY);
    if (!norm) return;
    this.flushMoves();
    this.send({ type: 'mouse.up', button, x: norm.x, y: norm.y, ts: Date.now() });
  }

  onWheel(deltaX: number, deltaY: number, clientX: number, clientY: number): void {
    if (!this.enabled || !this.viewerFocused) return;
    const norm = elementPointToNormalized(this.getLayout(), clientX, clientY);
    if (!norm) return;
    // Normalizar deltas de pixel para "ticks" conservadores
    const tx = Math.max(-50, Math.min(50, Math.round(deltaX / 40)));
    const ty = Math.max(-50, Math.min(50, Math.round(deltaY / 40)));
    if (tx === 0 && ty === 0) return;
    this.send({
      type: 'mouse.wheel',
      deltaX: tx,
      deltaY: ty,
      x: norm.x,
      y: norm.y,
      ts: Date.now(),
    });
  }

  onKeyDown(code: string, key: string): void {
    if (!this.enabled || !this.viewerFocused) return;
    this.send({ type: 'key.down', code, key: key.slice(0, 40), ts: Date.now() });
  }

  onKeyUp(code: string, key: string): void {
    if (!this.enabled || !this.viewerFocused) return;
    this.send({ type: 'key.up', code, key: key.slice(0, 40), ts: Date.now() });
  }

  private scheduleFlush(): void {
    if (this.flushTimer != null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushMoves();
    }, 20);
  }

  private flushMoves(): void {
    const out = this.coalescer.flush();
    if (out) {
      this.send({ type: 'mouse.move', x: out.x, y: out.y, ts: out.ts });
    }
  }

  private send(event: ControlEvent): void {
    this.rtc.sendControl(event);
  }
}
