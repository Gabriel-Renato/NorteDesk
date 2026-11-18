import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatSessionCode, normalizeSessionCode, parseControlEvent } from '@nortedesk/protocol';
import { SignalingClient, type ConnectionStatus } from '../lib/signaling';
import { WebRtcSession, type QualityPreset } from '../lib/webrtc';
import { ControlSender } from '../lib/control-sender';
import type { DisplayInfo } from '../../electron/preload';

type Role = 'idle' | 'host' | 'guest';

interface IncomingRequest {
  sessionId: string;
  requestId: string;
  guestDisplayName: string;
}

function signalingUrl(): string {
  return import.meta.env.VITE_SIGNALING_URL || 'ws://127.0.0.1:8787';
}

function statusClass(s: ConnectionStatus): string {
  if (s === 'conectado') return 'ok';
  if (s === 'conectando') return 'warn';
  if (s === 'erro') return 'err';
  return '';
}

export function App() {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('desconectado');
  const [role, setRole] = useState<Role>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [guestCode, setGuestCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [waitingAccept, setWaitingAccept] = useState(false);
  const [controlGranted, setControlGranted] = useState(false);
  const [webrtcState, setWebrtcState] = useState<string>('novo');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedDisplay, setSelectedDisplay] = useState<DisplayInfo | null>(null);
  const [quality, setQuality] = useState<QualityPreset>('media');
  const [nativeInfo, setNativeInfo] = useState<string>('');
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const signalingRef = useRef<SignalingClient | null>(null);
  const rtcRef = useRef<WebRtcSession | null>(null);
  const controlRef = useRef<ControlSender | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const roleRef = useRef<Role>('idle');

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const endSessionLocal = useCallback(async (reason: string) => {
    setMessage(reason);
    setIncoming(null);
    setWaitingAccept(false);
    setControlGranted(false);
    setPeerName(null);
    setHasRemoteVideo(false);
    setWebrtcState('encerrado');
    controlRef.current?.setEnabled(false);
    await rtcRef.current?.close();
    await window.nortedesk?.setControlGranted(false);
    await window.nortedesk?.setSessionActive(false);
    await window.nortedesk?.releaseAllInput();
    setRole('idle');
    setSessionId(null);
    setCode(null);
    setCodeExpiresAt(null);
  }, []);

  useEffect(() => {
    const client = new SignalingClient(signalingUrl());
    signalingRef.current = client;
    client.onStatus = setConnStatus;
    client.connect();

    const rtc = new WebRtcSession(client);
    rtcRef.current = rtc;
    controlRef.current = new ControlSender(rtc, () => {
      const video = videoRef.current;
      return {
        elementWidth: video?.clientWidth ?? 0,
        elementHeight: video?.clientHeight ?? 0,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
      };
    });

    rtc.onRemoteStream = (stream) => {
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      }
      setHasRemoteVideo(true);
    };
    rtc.onConnectionState = (state) => {
      setWebrtcState(state);
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        void endSessionLocal(
          state === 'failed'
            ? 'Falha na conexão WebRTC. Em redes diferentes, configure TURN.'
            : 'Conexão WebRTC encerrada.',
        );
      }
    };
    rtc.onLocalStreamEnded = () => {
      const sid = sessionIdRef.current;
      if (sid) client.send({ type: 'session.end', sessionId: sid, reason: 'captura_encerrada' });
      void endSessionLocal('Captura de tela encerrada.');
    };
    rtc.onControlMessage = (data) => {
      const parsed = parseControlEvent(data);
      if (!parsed.ok) return;
      void window.nortedesk?.applyInput(parsed.data);
    };

    const unsub = client.subscribe((msg) => {
      switch (msg.type) {
        case 'host.registered':
        case 'host.code_refreshed':
          setCode(msg.code);
          setCodeExpiresAt(msg.expiresAt);
          setSessionId(msg.sessionId);
          setRole('host');
          setError(null);
          break;
        case 'host.incoming_request':
          setIncoming({
            sessionId: msg.sessionId,
            requestId: msg.requestId,
            guestDisplayName: msg.guestDisplayName,
          });
          break;
        case 'guest.request_sent':
          setSessionId(msg.sessionId);
          setWaitingAccept(true);
          setMessage('Solicitação enviada. Aguardando aceite...');
          break;
        case 'session.accepted':
          setWaitingAccept(false);
          setIncoming(null);
          setSessionId(msg.sessionId);
          setPeerName(msg.peerDisplayName);
          setRole(msg.role);
          setMessage(
            msg.role === 'host'
              ? 'Solicitação aceita. Selecione o monitor e inicie o compartilhamento.'
              : 'Acesso aceito. Aguardando transmissão da tela...',
          );
          void window.nortedesk?.setSessionActive(true);
          if (msg.role === 'host') {
            void window.nortedesk?.listDisplays().then((list) => {
              setDisplays(list ?? []);
              if (list?.[0]) setSelectedDisplay((prev) => prev ?? list[0] ?? null);
            });
          }
          if (msg.role === 'guest') {
            void rtc.startAsGuest(msg.sessionId);
          }
          break;
        case 'session.rejected':
          setWaitingAccept(false);
          setIncoming(null);
          setError(
            msg.reason === 'timeout'
              ? 'A solicitação expirou sem resposta.'
              : 'A solicitação foi recusada.',
          );
          setRole('idle');
          setSessionId(null);
          break;
        case 'permission.control_changed':
          setControlGranted(msg.granted);
          // Guest apenas envia eventos; host aplica via módulo nativo.
          if (roleRef.current === 'guest') {
            controlRef.current?.setEnabled(msg.granted);
          } else if (roleRef.current === 'host') {
            void window.nortedesk?.setControlGranted(msg.granted);
            if (!msg.granted) void window.nortedesk?.releaseAllInput();
          }
          break;
        case 'session.state':
          setControlGranted(msg.controlGranted);
          break;
        case 'session.ended':
          void endSessionLocal(humanEndReason(msg.reason));
          break;
        case 'error':
          setError(msg.message);
          if (msg.code === 'codigo_invalido_ou_expirado') {
            setWaitingAccept(false);
          }
          break;
        default:
          break;
      }
    });

    void window.nortedesk?.getInfo().then((info) => {
      if (info?.nativeInput) {
        setNativeInfo(
          info.nativeInput.ok
            ? 'Módulo nativo de entrada carregado.'
            : `Entrada nativa: ${info.nativeInput.detail}`,
        );
      }
    });

    const offEmergency = window.nortedesk?.onEmergencyEnd(() => {
      const sid = sessionIdRef.current;
      if (sid) client.send({ type: 'session.end', sessionId: sid, reason: 'atalho_emergencia' });
      void endSessionLocal('Sessão encerrada pelo atalho de emergência.');
    });

    return () => {
      unsub();
      offEmergency?.();
      client.disconnect();
      void rtc.close();
    };
  }, [endSessionLocal]);

  useEffect(() => {
    controlRef.current?.setEnabled(controlGranted && role === 'guest');
  }, [controlGranted, role]);

  const codeTtlLabel = useMemo(() => {
    if (!codeExpiresAt) return null;
    const remaining = Math.max(0, codeExpiresAt - now);
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [codeExpiresAt, now]);

  async function startHost(): Promise<void> {
    setError(null);
    setMessage(null);
    const list = await window.nortedesk?.listDisplays();
    setDisplays(list ?? []);
    if (list?.[0]) setSelectedDisplay(list[0]);
    signalingRef.current?.send({ type: 'host.register', displayName: 'Usuário local' });
  }

  async function copyCode(): Promise<void> {
    if (!code) return;
    await window.nortedesk?.writeClipboard(code);
    setMessage('Código copiado.');
  }

  function refreshCode(): void {
    signalingRef.current?.send({ type: 'host.refresh_code' });
  }

  function requestAccess(): void {
    setError(null);
    const normalized = normalizeSessionCode(guestCode);
    if (normalized.length !== 9) {
      setError('Informe um código de 9 dígitos.');
      return;
    }
    if (!guestName.trim()) {
      setError('Informe um nome para identificação (não é identidade verificada).');
      return;
    }
    setRole('guest');
    signalingRef.current?.send({
      type: 'guest.request',
      code: normalized,
      displayName: guestName.trim(),
    });
  }

  async function acceptIncoming(): Promise<void> {
    if (!incoming) return;
    signalingRef.current?.send({
      type: 'host.accept',
      sessionId: incoming.sessionId,
      requestId: incoming.requestId,
    });
  }

  function rejectIncoming(): void {
    if (!incoming) return;
    signalingRef.current?.send({
      type: 'host.reject',
      sessionId: incoming.sessionId,
      requestId: incoming.requestId,
    });
    setIncoming(null);
  }

  async function startSharing(): Promise<void> {
    if (!sessionId || !selectedDisplay?.sourceId) {
      setError('Selecione um monitor para compartilhar.');
      return;
    }
    setError(null);
    await window.nortedesk.setCaptureDisplay({
      bounds: selectedDisplay.bounds,
      sourceId: selectedDisplay.sourceId,
    });
    await window.nortedesk.setSessionActive(true);
    try {
      await rtcRef.current?.startAsHost(sessionId, quality);
      setMessage('Compartilhamento iniciado.');
    } catch {
      setError('Não foi possível iniciar a captura de tela.');
      await window.nortedesk.setSessionActive(false);
    }
  }

  function toggleControl(granted: boolean): void {
    if (!sessionId) return;
    signalingRef.current?.send({
      type: 'permission.set_control',
      sessionId,
      granted,
    });
  }

  function endSession(): void {
    if (sessionId) {
      signalingRef.current?.send({
        type: 'session.end',
        sessionId,
        reason: 'encerrado_pelo_usuario',
      });
    }
    void endSessionLocal('Sessão encerrada.');
  }

  async function onQualityChange(value: QualityPreset): Promise<void> {
    setQuality(value);
    if (role === 'host') await rtcRef.current?.setQuality(value);
  }

  return (
    <>
      {(role === 'host' && peerName) || (role === 'guest' && peerName) ? (
        <div className="banner" role="status">
          <div>
            <strong>Sessão ativa</strong>
            {' — '}
            {role === 'host'
              ? `Compartilhando tela com “${peerName}” (nome informado, não verificado).`
              : `Visualizando a tela de “${peerName}”.`}
            {controlGranted
              ? ' Controle de mouse/teclado autorizado.'
              : ' Controle desativado.'}
          </div>
          <button type="button" className="danger" onClick={endSession}>
            Encerrar sessão
          </button>
        </div>
      ) : null}

      <div className="app">
        <header className="header">
          <div>
            <h1 className="brand">NorteDesk</h1>
            <p className="subtitle">Suporte remoto consentido — visualização e controle sob autorização.</p>
          </div>
          <div className={`status-pill ${statusClass(connStatus)}`}>
            <span className="dot" />
            Servidor: {connStatus}
          </div>
        </header>

        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert info">{message}</div> : null}

        {role === 'idle' || (role === 'host' && !peerName) || (role === 'guest' && !peerName && !waitingAccept) ? (
          <div className="grid">
            <section className="panel">
              <h2>Receber suporte</h2>
              <p className="help">
                Gere um código temporário. O atendente usará esse código e você precisará aceitar a
                solicitação. O código sozinho não concede acesso.
              </p>
              {code ? (
                <>
                  <div className="code-row">
                    <div className="code">{formatSessionCode(code)}</div>
                    <button type="button" className="secondary" onClick={() => void copyCode()}>
                      Copiar
                    </button>
                  </div>
                  <div className="meta">
                    Validade restante: {codeTtlLabel ?? '—'}
                    {' · '}
                    <button type="button" className="secondary" onClick={refreshCode}>
                      Novo código
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => void startHost()} disabled={connStatus !== 'conectado'}>
                  Receber suporte
                </button>
              )}
            </section>

            <section className="panel">
              <h2>Oferecer suporte</h2>
              <p className="help">
                Informe o código do outro computador e um nome. A identidade não é verificada.
              </p>
              <div className="field">
                <label htmlFor="guestName">Seu nome</label>
                <input
                  id="guestName"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  maxLength={64}
                  placeholder="Ex.: Ana — suporte"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="guestCode">Código do outro computador</label>
                <input
                  id="guestCode"
                  value={guestCode}
                  onChange={(e) => setGuestCode(e.target.value)}
                  placeholder="000 000 000"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                onClick={requestAccess}
                disabled={connStatus !== 'conectado' || waitingAccept}
              >
                Solicitar acesso
              </button>
            </section>
          </div>
        ) : null}

        {role === 'host' && peerName ? (
          <section className="panel">
            <h2>Sessão como receptor</h2>
            <p className="help">
              Participante: <strong>{peerName}</strong> (nome informado, não verificado). Selecione o
              monitor e inicie o compartilhamento. O controle permanece desativado até você autorizar.
            </p>

            <div className="displays">
              {displays.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`display-card ${selectedDisplay?.id === d.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDisplay(d)}
                >
                  {d.thumbnailDataUrl ? <img src={d.thumbnailDataUrl} alt="" /> : <div style={{ height: 80 }} />}
                  <span>{d.label}</span>
                </button>
              ))}
            </div>

            <div className="actions">
              <label>
                Qualidade{' '}
                <select
                  value={quality}
                  onChange={(e) => void onQualityChange(e.target.value as QualityPreset)}
                >
                  <option value="baixa">Baixa (720p / 10 fps)</option>
                  <option value="media">Média (900p / 15 fps)</option>
                  <option value="alta">Alta (1080p / 20 fps)</option>
                </select>
              </label>
              <button type="button" onClick={() => void startSharing()}>
                Iniciar compartilhamento
              </button>
              {!controlGranted ? (
                <button type="button" className="secondary" onClick={() => toggleControl(true)}>
                  Autorizar controle
                </button>
              ) : (
                <button type="button" className="secondary" onClick={() => toggleControl(false)}>
                  Revogar controle
                </button>
              )}
              <button type="button" className="danger" onClick={endSession}>
                Encerrar
              </button>
            </div>
            <div className="meta">
              WebRTC: {webrtcState}
              {nativeInfo ? ` · ${nativeInfo}` : ''}
            </div>
          </section>
        ) : null}

        {role === 'guest' && (waitingAccept || peerName) ? (
          <section className="panel">
            <h2>Sessão como atendente</h2>
            {waitingAccept ? (
              <p className="help">Aguardando o usuário local aceitar a solicitação...</p>
            ) : (
              <>
                <p className="help">
                  Computador remoto: <strong>{peerName}</strong>. Controle:{' '}
                  {controlGranted ? 'autorizado' : 'somente visualização'}.
                </p>
                <div className="viewer-wrap">
                  <video
                    ref={videoRef}
                    tabIndex={0}
                    autoPlay
                    playsInline
                    muted
                    onFocus={() => controlRef.current?.setViewerFocused(true)}
                    onBlur={() => controlRef.current?.setViewerFocused(false)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      controlRef.current?.onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.focus();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const button =
                        e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
                      controlRef.current?.onMouseDown(
                        button,
                        e.clientX - rect.left,
                        e.clientY - rect.top,
                      );
                    }}
                    onMouseUp={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const button =
                        e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
                      controlRef.current?.onMouseUp(
                        button,
                        e.clientX - rect.left,
                        e.clientY - rect.top,
                      );
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    onWheel={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      controlRef.current?.onWheel(
                        e.deltaX,
                        e.deltaY,
                        e.clientX - rect.left,
                        e.clientY - rect.top,
                      );
                    }}
                    onKeyDown={(e) => {
                      if (!controlGranted) return;
                      e.preventDefault();
                      controlRef.current?.onKeyDown(e.code, e.key);
                    }}
                    onKeyUp={(e) => {
                      if (!controlGranted) return;
                      e.preventDefault();
                      controlRef.current?.onKeyUp(e.code, e.key);
                    }}
                  />
                  {!hasRemoteVideo ? (
                    <div className="viewer-overlay">Aguardando vídeo remoto...</div>
                  ) : null}
                </div>
                <div className="session-bar">
                  <div className="meta">WebRTC: {webrtcState}</div>
                  <button type="button" className="danger" onClick={endSession}>
                    Encerrar sessão
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        <p className="footnote">
          Atalho de emergência (global): Ctrl+Shift+Alt+Esc encerra a sessão e libera teclas/botões.
          Em redes distintas, STUN sozinho pode falhar — use TURN. Distribuição Windows sem assinatura
          de código pode exibir avisos do SmartScreen.
        </p>
      </div>

      {incoming ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h3>Solicitação de acesso</h3>
            <p>
              <strong>{incoming.guestDisplayName}</strong> (nome informado, não verificado) solicita
              ver a sua tela. Você pode autorizar o controle depois, em passo separado.
            </p>
            <div className="actions">
              <button type="button" onClick={() => void acceptIncoming()}>
                Aceitar visualização
              </button>
              <button type="button" className="secondary" onClick={rejectIncoming}>
                Recusar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function humanEndReason(reason: string): string {
  switch (reason) {
    case 'peer_desconectou':
      return 'O outro participante desconectou.';
    case 'codigo_expirado':
      return 'O código expirou.';
    case 'atalho_emergencia':
      return 'Sessão encerrada pelo atalho de emergência.';
    case 'captura_encerrada':
      return 'A captura de tela foi interrompida.';
    default:
      return 'Sessão encerrada.';
  }
}
