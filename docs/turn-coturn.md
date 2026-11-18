# TURN com coturn (referência)

STUN ajuda a descobrir candidatos públicos, mas **não garante** conectividade entre redes diferentes (NAT simétrico, firewalls corporativos). Nesses casos o tráfego de mídia (e às vezes sinalização de candidatos) passa por um servidor **TURN**, o que **consome banda no servidor**.

## Portas típicas

| Porta | Protocolo | Uso |
|-------|-----------|-----|
| 3478 | UDP/TCP | STUN/TURN |
| 5349 | TLS/DTLS | TURNS (recomendado em produção) |
| 49152–65535 | UDP | Relay de mídia (faixa configurável) |

Libere essas portas no firewall do host TURN e no security group da nuvem.

## Pré-requisitos de rede

- IP público estável ou DNS apontando para o host.
- UDP liberado (melhor latência); TCP/TLS como fallback.
- Não embuta o segredo TURN no aplicativo distribuído. O backend de sinalização emite credenciais temporárias (HMAC / TURN REST).

## Exemplo mínimo `turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=TROQUE_POR_SEGREDO_FORTE
realm=turn.exemplo.com
total-quota=100
stale-nonce=600
no-multicast-peers
no-cli
# Faixa de relay (ajuste conforme o provedor)
min-port=49152
max-port=65535
```

## Variáveis no NorteDesk

No `.env` do servidor de sinalização:

```env
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:turn.exemplo.com:3478?transport=udp,turn:turn.exemplo.com:3478?transport=tcp
TURN_SECRET=TROQUE_POR_SEGREDO_FORTE
TURN_CREDENTIAL_TTL_SECONDS=3600
```

O cliente solicita `ice.config` / recebe a configuração após o aceite. Username no formato `expiry:peerId` e credential HMAC-SHA1 em Base64, compatível com `use-auth-secret` do coturn.

## Custo de banda

Se o caminho direto (host↔guest) falhar, áudio/vídeo (neste MVP, só vídeo) trafegam pelo TURN. Dimensionamento: bitrate configurado × número de sessões simultâneas × fator de overhead.
