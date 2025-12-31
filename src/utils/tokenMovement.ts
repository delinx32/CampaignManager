import type { Token, Prop } from '../types';

/**
 * Calculate the pixel size of one grid cell based on canvas and image dimensions
 * Used to convert between pixel distances and grid cell distances
 */
export const calculateGridCellPixelSize = (
  canvas: HTMLCanvasElement | null,
  image: HTMLImageElement | null,
  gridColumns: number,
  gridRows: number
): number => {
  if (!canvas || !image || gridColumns <= 0 || gridRows <= 0) {
    return 1; // Fallback to 1 to avoid division by zero
  }
  
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const imgWidth = image.width * scale;
  const imgHeight = image.height * scale;
  const cellWidth = imgWidth / gridColumns;
  const cellHeight = imgHeight / gridRows;
  
  // Use average of width and height for a balanced cell size
  return (cellWidth + cellHeight) / 2;
};

/**
 * Snap a world position to the nearest grid cell
 */
export const snapToGrid = (x: number, y: number, gridCellDistance: number = 60): { x: number; y: number } =>
{
    return {
        x: Math.round(x / gridCellDistance) * gridCellDistance,
        y: Math.round(y / gridCellDistance) * gridCellDistance
    };
};

/**
 * Calculate grid distance between two positions (Manhattan/Chebyshev hybrid)
 * Returns the number of grid squares away, considering both orthogonal and diagonal movement
 */
export const getGridDistance = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    gridCellDistance: number = 60
): number =>
{
    const dx = Math.abs(x2 - x1) / gridCellDistance;
    const dy = Math.abs(y2 - y1) / gridCellDistance;
    // Use Chebyshev distance (max of dx, dy) for grid-based movement
    return Math.max(dx, dy);
};

/**
 * Check if a position is occupied by another token (or props if checking collisions)
 */
export const isPositionOccupied = (
    targetX: number,
    targetY: number,
    tokenId: string,
    tokens: Token[],
    checkProps?: { x: number; y: number; radius: number }[]
): boolean =>
{
    // Check token collision
    for (const token of tokens)
    {
        if (token.id === tokenId) continue; // Skip the moving token
        if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;

        const dx = targetX - token.x;
        const dy = targetY - token.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Use token radius for collision (assuming it's set)
        if (distance < 30)
        {
            // Approximate collision radius
            return true;
        }
    }

    // Check prop collision if provided
    if (checkProps)
    {
        for (const prop of checkProps)
        {
            const dx = targetX - prop.x;
            const dy = targetY - prop.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < prop.radius)
            {
                return true;
            }
        }
    }

    return false;
};

/**
 * Calculate facing direction based on movement
 */
export const calculateFacingDirection = (
    currentX: number,
    newX: number,
    currentFacing: 'left' | 'right' = 'right'
): 'left' | 'right' =>
{
    if (newX > currentX)
    {
        return 'right';
    } else if (newX < currentX)
    {
        return 'left';
    }
    return currentFacing; // No horizontal movement
};

/**
 * Validate if a token can move to a target position
 * Returns the validated position with facing direction, or null if move is invalid
 */
export interface ValidatedMove
{
    x: number;
    y: number;
    currentlyFacing: 'left' | 'right';
}

export const validateTokenMove = (
    token: Token,
    targetX: number,
    targetY: number,
    tokens: Token[],
    options?: {
        gridCellDistance?: number;
        allowProps?: boolean;
        props?: Prop[];
        skipSnapping?: boolean; // If true, assumes targetX/targetY are already snapped
    }
): ValidatedMove | null =>
{
    const gridCellDistance = options?.gridCellDistance || 60;
    const skipSnapping = options?.skipSnapping || false;

    // Snap to grid only if not already snapped
    const snapped = skipSnapping
        ? { x: targetX, y: targetY }
        : snapToGrid(targetX, targetY, gridCellDistance);

    // Validate token has current position
    if (token.x === undefined || token.y === undefined || token.x === null || token.y === null)
    {
        return null;
    }

    // Check distance is exactly 1 grid square
    const distance = getGridDistance(token.x, token.y, snapped.x, snapped.y, gridCellDistance);
    console.log('Validating move for token', token.id, 'from (', token.x, ',', token.y, ') to (', snapped.x, ',', snapped.y, ') - distance:', distance);
    if (distance !== 1)
    {
        return null;
    }

    // Check collision
    const props = options?.props || [];
    if (isPositionOccupied(snapped.x, snapped.y, token.id, tokens, props))
    {
        return null;
    }

    // Calculate facing direction
    const currentlyFacing = calculateFacingDirection(token.x, snapped.x, token.currentlyFacing || 'right');

    return {
        x: snapped.x,
        y: snapped.y,
        currentlyFacing
    };
};
