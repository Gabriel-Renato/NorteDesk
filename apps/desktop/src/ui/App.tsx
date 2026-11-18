import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatSessionCode, normalizeSessionCode, parseControlEvent } from '@nortedesk/protocol';
import { SignalingClient, type ConnectionStatus } from '../lib/signaling';
import {
  resolveSignalingUrl,
  signalingConfigMessage,
} from '../lib/signaling-url';
import { WebRtcSession, type QualityPreset } from '../lib/webrtc';
import { ControlSender } from '../lib/control-sender';
import type { DisplayInfo } from '../../electron/preload';

type Role = 'idle' | 'host' | 'guest';

interface IncomingRequest {
  sessionId: string;
  requestId: string;
  guestDisplayName: string;
}

function statusClass(s: ConnectionStatus): string {
  if (s === 'conectado') return 'ok';
  if (s === 'iniciando') return 'warn';
  if (s === 'erro' || s === 'erro_config') return 'err';
  return '';
}

function statusLabel(s: ConnectionStatus, detail: string | null): string {
  if (s === 'iniciando') return detail || 'Iniciando servidor, aguarde…';
  if (s === 'erro_config') return 'Erro de configuração';
  if (s === 'conectado') return 'Servidor: conectado';
  if (s === 'erro') return detail || 'Erro de conexão';
  return 'Servidor: desconectado';
}

export function App() {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('desconectado');
  const [connDetail, setConnDetail] = useState<string | null>(null);
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
    const resolved = resolveSignalingUrl(import.meta.env.VITE_SIGNALING_URL);
    if (!resolved.ok) {
      setConnStatus('erro_config');
      setConnDetail(signalingConfigMessage(resolved.reason));
      setError(signalingConfigMessage(resolved.reason));
      return;
    }

    const client = new SignalingClient(resolved.url);
    signalingRef.current = client;
    client.onStatus = (status, detail) => {
      setConnStatus(status);
      setConnDetail(detail ?? null);
      // Queda do signaling: interrompe controle imediatamente (não restaura ao reconectar).
      if (status !== 'conectado' && sessionIdRef.current) {
        controlRef.current?.setEnabled(false);
        void window.nortedesk?.setControlGranted(false);
        void window.nortedesk?.releaseAllInput();
        setControlGranted(false);
      }
    };
    client.onPeerReset = () => {
      // Novo peerId após reconexão: credenciais/autorização anteriores são inválidas.
      void endSessionLocal(
        'Conexão com o servidor foi restabelecida. A sessão anterior encerrou; é necessário novo aceite e nova autorização de controle.',
      );
    };
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
        // Sempre libera input e revoga controle localmente; nova sessão exige novo aceite.
        void endSessionLocal(
          state === 'failed'
            ? 'Falha na conexão WebRTC. STUN sozinho não garante redes diferentes; configure TURN se necessário.'
            : 'Conexão WebRTC encerrada. Controle remoto foi revogado.',
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
            <strong>Alguém está conectado</strong>
            {' — '}
            {role === 'host'
              ? `${peerName} pode ver sua tela${controlGranted ? ' e controlar o mouse/teclado' : ''}.`
              : `Você está vendo a tela de ${peerName}${controlGranted ? ' (com controle)' : ' (só olhar)'}.`}
          </div>
          <button type="button" className="danger" onClick={endSession}>
            Encerrar agora
          </button>
        </div>
      ) : null}

      <div className="app">
        <header className="topbar">
          <div>
            <h1 className="brand">NorteDesk</h1>
            <p className="tagline">Ajuda remota com o seu consentimento.</p>
          </div>
          <div className={`status-pill ${statusClass(connStatus)}`} title={connDetail ?? undefined}>
            <span className="dot" />
            {statusLabel(connStatus, connDetail)}
          </div>
        </header>

        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert info">{message}</div> : null}

        {role === 'idle' || (role === 'host' && !peerName) || (role === 'guest' && !peerName && !waitingAccept) ? (
          <>
            <h2 className="hero-choice">O que você quer fazer?</h2>
            <div className="grid">
              <section className="panel accent">
                <span className="step">Opção 1</span>
                <h2>Quero receber ajuda</h2>
                <p className="help">
                  Clique abaixo, copie o código e envie para quem vai te ajudar. Nada acontece até você
                  aceitar o pedido.
                </p>
                {code ? (
                  <>
                    <p className="help" style={{ marginBottom: '0.6rem' }}>
                      <strong>Seu código:</strong> envie isto para a outra pessoa
                    </p>
                    <div className="code-row">
                      <div className="code">{formatSessionCode(code)}</div>
                      <button type="button" className="secondary" onClick={() => void copyCode()}>
                        Copiar
                      </button>
                    </div>
                    <div className="meta">
                      Expira em {codeTtlLabel ?? '—'}
                      {' · '}
                      <button type="button" className="secondary" onClick={refreshCode}>
                        Gerar outro
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="big"
                      onClick={() => void startHost()}
                      disabled={connStatus !== 'conectado'}
                    >
                      Gerar meu código
                    </button>
                    {connStatus === 'iniciando' ? (
                      <p className="meta">Conectando ao servidor, aguarde…</p>
                    ) : null}
                    {connStatus === 'erro_config' ? (
                      <p className="meta">{connDetail}</p>
                    ) : null}
                    {connStatus === 'desconectado' || connStatus === 'erro' ? (
                      <p className="meta">Sem conexão com o servidor. Aguarde ou confira a internet.</p>
                    ) : null}
                  </>
                )}
              </section>

              <section className="panel">
                <span className="step">Opção 2</span>
                <h2>Vou ajudar alguém</h2>
                <p className="help">
                  Digite seu nome e o código que a outra pessoa te enviou. Ela ainda precisa aceitar.
                </p>
                <div className="field">
                  <label htmlFor="guestName">Seu nome</label>
                  <input
                    id="guestName"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    maxLength={64}
                    placeholder="Ex.: Ana"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="guestCode">Código recebido</label>
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
                  className="big"
                  onClick={requestAccess}
                  disabled={connStatus !== 'conectado' || waitingAccept}
                >
                  Pedir para ver a tela
                </button>
                {connStatus === 'iniciando' ? (
                  <p className="meta">Conectando ao servidor, aguarde…</p>
                ) : null}
              </section>
            </div>
          </>
        ) : null}

        {role === 'host' && peerName ? (
          <section className="panel">
            <span className="step">Passo seguinte</span>
            <h2>Compartilhar sua tela</h2>
            <p className="help">
              <strong>{peerName}</strong> foi aceito. Escolha o monitor e clique em compartilhar.
              O controle do mouse/teclado só libera se você autorizar depois.
            </p>

            <div className="displays">
              {displays.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`display-card ${selectedDisplay?.id === d.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDisplay(d)}
                >
                  {d.thumbnailDataUrl ? (
                    <img src={d.thumbnailDataUrl} alt="" />
                  ) : (
                    <div style={{ height: 80 }} />
                  )}
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
                  <option value="baixa">Economia</option>
                  <option value="media">Normal</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
              <button type="button" onClick={() => void startSharing()}>
                Compartilhar este monitor
              </button>
              {!controlGranted ? (
                <button type="button" className="secondary" onClick={() => toggleControl(true)}>
                  Permitir controle
                </button>
              ) : (
                <button type="button" className="secondary" onClick={() => toggleControl(false)}>
                  Tirar controle
                </button>
              )}
              <button type="button" className="danger" onClick={endSession}>
                Encerrar
              </button>
            </div>
            <div className="meta">
              Status da tela: {webrtcState}
              {nativeInfo ? ` · ${nativeInfo}` : ''}
            </div>
          </section>
        ) : null}

        {role === 'guest' && (waitingAccept || peerName) ? (
          <section className="panel">
            <h2>Ajudando remotamente</h2>
            {waitingAccept ? (
              <div className="waiting-box">
                Pedido enviado. Espere a outra pessoa clicar em <strong>Aceitar</strong>.
              </div>
            ) : (
              <>
                <p className="help">
                  Tela de <strong>{peerName}</strong>.{' '}
                  {controlGranted
                    ? 'Você pode usar mouse e teclado (clique na tela abaixo).'
                    : 'Por enquanto só dá para ver. Peça para a pessoa permitir o controle.'}
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
                    <div className="viewer-overlay">Aguardando a tela aparecer…</div>
                  ) : null}
                </div>
                <div className="session-bar">
                  <div className="meta">Conexão: {webrtcState}</div>
                  <button type="button" className="danger" onClick={endSession}>
                    Encerrar
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        <p className="footnote">
          Emergência: Ctrl+Shift+Alt+Esc encerra na hora. Só compartilhe o código com quem você confia.
        </p>
      </div>

      {incoming ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h3>Alguém quer ver sua tela</h3>
            <p>
              <strong>{incoming.guestDisplayName}</strong> pediu acesso. O nome não é verificado.
              Você pode liberar o controle depois, se quiser.
            </p>
            <div className="actions">
              <button type="button" onClick={() => void acceptIncoming()}>
                Aceitar
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
