import type { Token, Prop, RevealZone } from '../types';
import { parseLightRadius, getEffectiveTags } from './lightTags';

/**
 * Determines if a point on the canvas is revealed (not under fog)
 * This is the shared logic used by both MapCanvas and ObserverView
 */
export const isPointRevealed = (
  x: number,
  y: number,
  tokens: Token[],
  props: Prop[],
  revealedPath: Array<{ x: number; y: number }>,
  revealZones: RevealZone[],
  permanentlyRevealedZones: Set<string>,
  fogEnabled: string,
  lightingCondition: string,
  fogRevealDistance: number,
  gridColumns: number,
  gridRows: number,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
): boolean => {
  // If fog is completely off, everything is revealed
  if (fogEnabled === 'off-all' && lightingCondition === 'bright') {
    return true;
  }

  // Calculate grid cell size for distance calculations
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const scaledImgWidth = imageWidth * scale;
  const scaledImgHeight = imageHeight * scale;
  const cellWidth = scaledImgWidth / gridColumns;
  const cellHeight = scaledImgHeight / gridRows;
  const gridCellSize = (cellWidth + cellHeight) / 2;

  // Adjust reveal distance based on lighting condition
  let effectiveRevealDistance = fogRevealDistance;
  if (lightingCondition === 'darkness') {
    effectiveRevealDistance = fogRevealDistance * 0.5;
  }

  const gridCellDistance = 5; // 5 feet per grid square

  // Check if point is revealed by active player tokens
  const activePlayerTokens = tokens.filter(token => token.active && token.actor?.player === true);
  for (const token of activePlayerTokens) {
    if (token.x !== undefined && token.y !== undefined && token.x !== null && token.y !== null) {
      const dx = x - token.x;
      const dy = y - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= gridCellSize * effectiveRevealDistance) {
        return true;
      }
    }
  }

  // Check if point is revealed by revealed path
  // Note: revealedPath stores grid coordinates, so we need to convert them to pixel coordinates
  for (const gridPoint of revealedPath) {
    // Convert grid coordinates to pixel coordinates
    const offsetX = (canvasWidth - scaledImgWidth) / 2;
    const offsetY = (canvasHeight - scaledImgHeight) / 2;
    const pixelX = offsetX + (gridPoint.x + 0.5) * cellWidth;
    const pixelY = offsetY + (gridPoint.y + 0.5) * cellHeight;

    const dx = x - pixelX;
    const dy = y - pixelY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= gridCellSize * effectiveRevealDistance) {
      return true;
    }
  }

  // Check if point is revealed by light sources (tokens or props with light tags)
  const allItems = [...tokens, ...props];
  for (const item of allItems) {
    if (item.x !== undefined && item.y !== undefined && item.x !== null && item.y !== null) {
      const effectiveTags = getEffectiveTags(item);
      const lightRadius = parseLightRadius(effectiveTags);
      if (lightRadius) {
        const lightRadiusSquares = lightRadius / gridCellDistance;
        const dx = x - item.x;
        const dy = y - item.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= gridCellSize * lightRadiusSquares) {
          return true;
        }
      }
    }
  }

  // Check if point is in a reveal zone
  for (const zone of revealZones) {
    // Check if any active player token is in the zone (making it active)
    const playerInZone = activePlayerTokens.some(token => {
      if (token.x === undefined || token.y === undefined) return false;
      return token.x >= zone.x && token.x <= zone.x + zone.width && token.y >= zone.y && token.y <= zone.y + zone.height;
    });

    // Check if point is in this zone (if zone is active or permanent)
    if (playerInZone || (zone.permanent && permanentlyRevealedZones.has(zone.id))) {
      if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) {
        return true;
      }
    }
  }

  // Point is not revealed - it's under fog
  return false;
};
