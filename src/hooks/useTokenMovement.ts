import { useCallback } from 'react';
import { validateTokenMove } from '../utils/tokenMovement';
import type { ValidatedMove } from '../utils/tokenMovement';
import type { Token, Prop } from '../types';

interface UseTokenMovementOptions {
  gridCellDistance?: number;
  props?: Prop[];
  skipSnapping?: boolean; // If true, caller handles snapping
}

/**
 * Custom hook for token movement validation and state management
 * Provides a unified interface for validating token moves in both GM and player views
 */
export const useTokenMovement = (tokens: Token[], options: UseTokenMovementOptions = {}) => {
  const gridCellDistance = options.gridCellDistance || 60;
  const props = options.props || [];
  const skipSnapping = options.skipSnapping || false;

  /**
   * Validate if a token can move to a target position
   * Returns the new position with facing direction if valid, null otherwise
   */
  const validateMove = useCallback(
    (token: Token, targetX: number, targetY: number): ValidatedMove | null => {
      return validateTokenMove(token, targetX, targetY, tokens, {
        gridCellDistance,
        props,
        skipSnapping,
      });
    },
    [tokens, gridCellDistance, props, skipSnapping]
  );

  /**
   * Apply a validated move to a token (returns updated token)
   */
  const applyMove = useCallback(
    (token: Token, validatedMove: ValidatedMove): Token => {
      return {
        ...token,
        x: validatedMove.x,
        y: validatedMove.y,
        currentlyFacing: validatedMove.currentlyFacing,
      };
    },
    []
  );

  return {
    validateMove,
    applyMove,
  };
};
