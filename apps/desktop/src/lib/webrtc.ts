import type { SignalingClient } from './signaling';
import type { ServerToClientMessage } from '@nortedesk/protocol';

export type QualityPreset = 'baixa' | 'media' | 'alta';

const QUALITY: Record<QualityPreset, { width: number; height: number; frameRate: number; maxBitrate: number }> = {
  baixa: { width: 1280, height: 720, frameRate: 10, maxBitrate: 800_000 },
  media: { width: 1600, height: 900, frameRate: 15, maxBitrate: 1_500_000 },
  alta: { width: 1920, height: 1080, frameRate: 20, maxBitrate: 2_500_000 },
};

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export class WebRtcSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private role: 'host' | 'guest' | null = null;
  private sessionId: string | null = null;
  private iceServers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private makingOffer = false;

  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onControlMessage?: (data: unknown) => void;
  onControlOpen?: () => void;
  onLocalStreamEnded?: () => void;

  constructor(private readonly signaling: SignalingClient) {
    signaling.subscribe((msg) => {
      void this.onSignaling(msg);
    });
  }

  setIceServers(servers: IceServer[]): void {
    this.iceServers = servers.length ? servers : this.iceServers;
  }

  async startAsHost(sessionId: string, quality: QualityPreset = 'media'): Promise<void> {
    this.role = 'host';
    this.sessionId = sessionId;
    await this.ensurePc();
    const q = QUALITY[quality];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // Constraints conservadoras; o SO/Electron pode ajustar.
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.frameRate, max: q.frameRate },
      },
      audio: false,
    });
    this.localStream = stream;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        this.onLocalStreamEnded?.();
      });
      this.pc!.addTrack(track, stream);
    });
    await this.applyBitrate(q.maxBitrate);

    this.controlChannel = this.pc!.createDataChannel('control', { ordered: true });
    this.wireControlChannel(this.controlChannel);

    this.makingOffer = true;
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    this.makingOffer = false;
    this.signaling.send({
      type: 'signal.offer',
      sessionId,
      sdp: offer.sdp ?? '',
    });
  }

  async startAsGuest(sessionId: string): Promise<void> {
    this.role = 'guest';
    this.sessionId = sessionId;
    await this.ensurePc();
  }

  async setQuality(quality: QualityPreset): Promise<void> {
    if (!this.localStream || !this.pc) return;
    const q = QUALITY[quality];
    const track = this.localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.frameRate, max: q.frameRate },
      });
    }
    await this.applyBitrate(q.maxBitrate);
  }

  sendControl(payload: unknown): void {
    if (!this.controlChannel || this.controlChannel.readyState !== 'open') return;
    const raw = JSON.stringify(payload);
    if (raw.length > 512) return;
    this.controlChannel.send(raw);
  }

  async close(): Promise<void> {
    try {
      this.controlChannel?.close();
    } catch {
      // ignore
    }
    this.controlChannel = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    this.role = null;
    this.sessionId = null;
  }

  private async ensurePc(): Promise<void> {
    if (this.pc) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.sessionId) return;
      this.signaling.send({
        type: 'signal.ice',
        sessionId: this.sessionId,
        candidate: JSON.stringify(ev.candidate),
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
      });
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.onRemoteStream?.(stream);
    };

    pc.onconnectionstatechange = () => {
      this.onConnectionState?.(pc.connectionState);
      if (pc.connectionState === 'connected' && this.sessionId) {
        this.signaling.send({ type: 'webrtc.ready', sessionId: this.sessionId });
      }
    };

    pc.ondatachannel = (ev) => {
      this.controlChannel = ev.channel;
      this.wireControlChannel(ev.channel);
    };
  }

  private wireControlChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.onControlOpen?.();
    channel.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      if (ev.data.length > 512) return;
      try {
        this.onControlMessage?.(JSON.parse(ev.data));
      } catch {
        // ignore
      }
    };
  }

  private async onSignaling(msg: ServerToClientMessage): Promise<void> {
    if (msg.type === 'ice.config') {
      this.setIceServers(msg.iceServers);
      return;
    }
    if (!this.sessionId || !('sessionId' in msg) || msg.sessionId !== this.sessionId) {
      if (msg.type === 'signal.offer' || msg.type === 'signal.answer' || msg.type === 'signal.ice') {
        // mensagem de outra sessão
      }
    }

    if (msg.type === 'signal.offer') {
      if (this.role !== 'guest') return;
      if (msg.sessionId !== this.sessionId) return;
      await this.ensurePc();
      await this.pc!.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await this.pc!.createAnswer();
      await this.pc!.setLocalDescription(answer);
      this.signaling.send({
        type: 'signal.answer',
        sessionId: msg.sessionId,
        sdp: answer.sdp ?? '',
      });
      return;
    }

    if (msg.type === 'signal.answer') {
      if (this.role !== 'host' || this.makingOffer) return;
      if (msg.sessionId !== this.sessionId) return;
      await this.pc?.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      return;
    }

    if (msg.type === 'signal.ice') {
      if (msg.sessionId !== this.sessionId || !this.pc) return;
      try {
        const candidate = JSON.parse(msg.candidate) as RTCIceCandidateInit;
        await this.pc.addIceCandidate(candidate);
      } catch {
        // candidato inválido / ordem — ignorar
      }
    }
  }

  private async applyBitrate(maxBitrate: number): Promise<void> {
    if (!this.pc) return;
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0]!.maxBitrate = maxBitrate;
      await sender.setParameters(params);
    }
  }
}
