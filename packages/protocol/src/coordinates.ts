export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoLayout {
  /** Tamanho do elemento de vídeo na UI do atendente. */
  elementWidth: number;
  elementHeight: number;
  /** Resolução nativa do stream (fonte). */
  videoWidth: number;
  videoHeight: number;
}

/**
 * Calcula a área útil do vídeo (object-fit: contain) excluindo faixas pretas.
 */
export function getContentRect(layout: VideoLayout): Rect {
  const { elementWidth, elementHeight, videoWidth, videoHeight } = layout;
  if (
    elementWidth <= 0 ||
    elementHeight <= 0 ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const elementRatio = elementWidth / elementHeight;
  const videoRatio = videoWidth / videoHeight;

  if (elementRatio > videoRatio) {
    const width = elementHeight * videoRatio;
    const x = (elementWidth - width) / 2;
    return { x, y: 0, width, height: elementHeight };
  }

  const height = elementWidth / videoRatio;
  const y = (elementHeight - height) / 2;
  return { x: 0, y, width: elementWidth, height };
}

/**
 * Converte ponto no elemento de vídeo (CSS px) para coordenadas normalizadas 0..1
 * na área útil. Retorna null se o clique estiver na faixa vazia (letterbox).
 */
export function elementPointToNormalized(
  layout: VideoLayout,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const content = getContentRect(layout);
  if (content.width <= 0 || content.height <= 0) return null;

  const lx = clientX - content.x;
  const ly = clientY - content.y;
  if (lx < 0 || ly < 0 || lx > content.width || ly > content.height) {
    return null;
  }

  return {
    x: clamp01(lx / content.width),
    y: clamp01(ly / content.height),
  };
}

export interface DisplayBounds {
  /** Origem do monitor no desktop virtual (DIP ou pixels físicos, conforme API). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fator de escala Windows (1 = 100%, 1.25 = 125%, etc.). */
  scaleFactor: number;
}

/**
 * Converte coordenadas normalizadas (0..1) para pixels absolutos do monitor,
 * respeitando origem, limites e escala de exibição.
 *
 * `usePhysicalPixels`: se true, multiplica pela escala (útil quando a API nativa
 * espera coordenadas físicas). No Windows com nut.js/libnut, tipicamente usamos
 * coordenadas de tela do desktop virtual em pixels físicos.
 */
export function normalizedToDisplayPoint(
  normalized: { x: number; y: number },
  display: DisplayBounds,
  options: { usePhysicalPixels?: boolean } = {},
): { x: number; y: number } {
  const scale = options.usePhysicalPixels ? display.scaleFactor : 1;
  const width = display.width * scale;
  const height = display.height * scale;
  const originX = display.x * scale;
  const originY = display.y * scale;

  const x = Math.round(originX + clamp01(normalized.x) * (width - 1));
  const y = Math.round(originY + clamp01(normalized.y) * (height - 1));

  return {
    x: clamp(x, originX, originX + width - 1),
    y: clamp(y, originY, originY + height - 1),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
