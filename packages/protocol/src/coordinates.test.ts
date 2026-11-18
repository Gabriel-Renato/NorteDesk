import { describe, expect, it } from 'vitest';
import {
  getContentRect,
  elementPointToNormalized,
  normalizedToDisplayPoint,
} from './coordinates.js';

describe('conversão de coordenadas', () => {
  it('calcula letterbox horizontal', () => {
    const rect = getContentRect({
      elementWidth: 800,
      elementHeight: 400,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    // 1920/1080 ≈ 1.777..., altura 400 => largura útil ≈ 711.11
    expect(rect.height).toBe(400);
    expect(rect.width).toBeCloseTo(400 * (1920 / 1080), 1);
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBe(0);
  });

  it('ignora clique na faixa vazia', () => {
    const layout = {
      elementWidth: 800,
      elementHeight: 400,
      videoWidth: 1920,
      videoHeight: 1080,
    };
    expect(elementPointToNormalized(layout, 5, 200)).toBeNull();
  });

  it('mapeia centro do conteúdo para 0.5,0.5', () => {
    const layout = {
      elementWidth: 800,
      elementHeight: 450,
      videoWidth: 1600,
      videoHeight: 900,
    };
    const content = getContentRect(layout);
    const mid = elementPointToNormalized(
      layout,
      content.x + content.width / 2,
      content.y + content.height / 2,
    );
    expect(mid).toEqual({ x: 0.5, y: 0.5 });
  });

  it('aplica escala e limites do monitor', () => {
    const point = normalizedToDisplayPoint(
      { x: 0, y: 0 },
      { x: 100, y: 50, width: 1920, height: 1080, scaleFactor: 1.25 },
      { usePhysicalPixels: true },
    );
    expect(point.x).toBe(Math.round(100 * 1.25));
    expect(point.y).toBe(Math.round(50 * 1.25));

    const br = normalizedToDisplayPoint(
      { x: 1, y: 1 },
      { x: 0, y: 0, width: 100, height: 100, scaleFactor: 1 },
      { usePhysicalPixels: true },
    );
    expect(br).toEqual({ x: 99, y: 99 });
  });
});
