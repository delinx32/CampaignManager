import type { Token, Prop, RevealZone } from '../types';
import { getEffectiveTags, parseLightRadius } from './lightTags';

interface FogRenderOptions {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  ctx: CanvasRenderingContext2D;
  transform: { x: number; y: number; scale: number; rotation: number };
  tokens: Token[];
  props: Prop[];
  revealedPath: Array<{ x: number; y: number }>;
  revealZones: RevealZone[];
  permanentlyRevealedZones: Set<string>;
  fogRevealDistance: number;
  lightingCondition: string;
  gridColumns: number;
  gridRows: number;
  gridCellDistance: number;
  testingZone?: string | null;
  onPermanentlyReveal?: (zoneId: string) => void;
}

/**
 * Renders fog of war on the canvas
 * Shared logic used by both MapCanvas and ObserverView
 */
export const renderFog = (options: FogRenderOptions): void => {
  const {
    canvas,
    image,
    ctx,
    transform,
    tokens,
    props,
    revealedPath,
    revealZones,
    permanentlyRevealedZones,
    fogRevealDistance,
    lightingCondition,
    gridColumns,
    gridRows,
    gridCellDistance,
    testingZone,
    onPermanentlyReveal,
  } = options;

  // Calculate grid cell size in pixels for fog reveal radius
  let gridCellSize = 20; // Default fallback
  if (gridColumns > 0 && gridRows > 0) {
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const imgWidth = image.width * scale;
    const imgHeight = image.height * scale;
    const cellWidth = imgWidth / gridColumns;
    const cellHeight = imgHeight / gridRows;
    gridCellSize = (cellWidth + cellHeight) / 2;
  }

  // Collect all light sources (tokens and props with light tags)
  const lightSources: Array<{ x: number; y: number; radius: number }> = [];

  tokens.forEach(token => {
    if (token.x !== undefined && token.y !== undefined && token.x !== null && token.y !== null) {
      const effectiveTags = getEffectiveTags(token);
      const lightRadius = parseLightRadius(effectiveTags);
      if (lightRadius) {
        const lightRadiusSquares = lightRadius / gridCellDistance;
        lightSources.push({ x: token.x, y: token.y, radius: lightRadiusSquares });
      }
    }
  });

  props.forEach(prop => {
    const effectiveTags = getEffectiveTags(prop);
    const lightRadius = parseLightRadius(effectiveTags);
    if (lightRadius) {
      const lightRadiusSquares = lightRadius / gridCellDistance;
      lightSources.push({ x: prop.x, y: prop.y, radius: lightRadiusSquares });
    }
  });

  const activePlayerTokens = tokens.filter(token => token.active && token.actor?.player === true);

  if (activePlayerTokens.length === 0 && revealedPath.length === 0 && lightSources.length === 0 && revealZones.length === 0) {
    return; // Nothing to reveal
  }

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  // Reveal fog along the path tokens have traveled
  if (revealedPath.length > 0) {
    let effectiveRevealDistance = fogRevealDistance;
    if (lightingCondition === 'darkness') {
      effectiveRevealDistance = fogRevealDistance * 0.5;
    }

    revealedPath.forEach(gridPoint => {
      // Convert grid coordinates to pixel coordinates
      let pixelX = gridPoint.x * 50; // Default cell size
      let pixelY = gridPoint.y * 50;

      if (gridColumns > 0 && gridRows > 0) {
        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        const imgWidth = image.width * scale;
        const imgHeight = image.height * scale;
        const cellWidth = imgWidth / gridColumns;
        const cellHeight = imgHeight / gridRows;
        const offsetX = (canvas.width - imgWidth) / 2;
        const offsetY = (canvas.height - imgHeight) / 2;
        pixelX = offsetX + (gridPoint.x + 0.5) * cellWidth;
        pixelY = offsetY + (gridPoint.y + 0.5) * cellHeight;
      }

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      const gradient = ctx.createRadialGradient(pixelX, pixelY, 0, pixelX, pixelY, gridCellSize * effectiveRevealDistance);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, gridCellSize * effectiveRevealDistance, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });
  }

  // Reveal fog around active player tokens
  activePlayerTokens.forEach(token => {
    if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

    let effectiveRevealDistance = fogRevealDistance;
    if (lightingCondition === 'darkness') {
      effectiveRevealDistance = fogRevealDistance * 0.5;
    }

    const gradient = ctx.createRadialGradient(token.x, token.y, 0, token.x, token.y, gridCellSize * effectiveRevealDistance);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(token.x, token.y, gridCellSize * effectiveRevealDistance, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  // Reveal fog around light sources
  lightSources.forEach(light => {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

    const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, gridCellSize * light.radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(light.x, light.y, gridCellSize * light.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  // Reveal fog in reveal zones
  revealZones.forEach(zone => {
    const playerInZone = activePlayerTokens.some(token => {
      if (token.x === undefined || token.y === undefined) return false;
      return token.x >= zone.x && token.x <= zone.x + zone.width && token.y >= zone.y && token.y <= zone.y + zone.height;
    });

    // If permanent zone has been revealed once, keep it revealed (unless testing, which clears it)
    if (playerInZone && zone.permanent && testingZone !== zone.id && onPermanentlyReveal) {
      onPermanentlyReveal(zone.id);
    }

    // Reveal if:
    // - Player is in zone OR
    // - It's permanently revealed (and not being tested) OR
    // - It's being tested (test overrides permanent state to show fresh preview)
    const shouldReveal = playerInZone || (zone.permanent && permanentlyRevealedZones.has(zone.id) && testingZone !== zone.id) || testingZone === zone.id;

    if (shouldReveal) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(zone.x, zone.y, zone.width, zone.height);

      ctx.restore();
    }
  });

  ctx.restore();
};
