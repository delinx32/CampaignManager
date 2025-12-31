import { useRef, useEffect, useCallback, useState } from 'react';
import './ObserverView.css';
import { API_URL } from '../config';
import type { Token, Prop, RevealZone } from '../types';
import { isPointRevealed } from '../utils/fogReveal';
import { renderFog } from '../utils/fogRendering';
import { useTokenMovement } from '../hooks/useTokenMovement';
import { calculateGridCellPixelSize } from '../utils/tokenMovement';
import { useGameWebSocket } from '../hooks/useGameWebSocket';

// Helper function to get the current image URL based on active state
const getCurrentImageUrl = (item: Token | Prop): string | undefined => {
  if (item.activeState && item.states) {
    const state = item.states.find(s => s.name === item.activeState);
    if (state) return state.imageUrl;
  }
  return item.imageUrl;
};

interface ObserverViewProps {
  backgroundImage: string | null;
  tokens: Token[];
  props: Prop[];
  transform: { x: number; y: number; scale: number; rotation: number };
  fogEnabled: 'on' | 'off-all' | 'off-gm';
  fogRevealDistance: number;
  playerFogOpacity: number;
  lightingCondition: 'bright' | 'dim' | 'darkness';
  revealedPath: Array<{ x: number; y: number }>;
  gridColumns: number;
  gridRows: number;
  showGrid: boolean;
  selectedTokenId?: string | null;
  currentActorId?: string | null;
  revealZones?: RevealZone[];
  permanentlyRevealedZones?: Set<string>;
  userRole?: 'gm' | 'player';
  campaign?: string;
  session?: string;
}

export default function ObserverView({ 
  backgroundImage, 
  tokens,
  props,
  transform, 
  fogEnabled, 
  fogRevealDistance,
  playerFogOpacity,
  lightingCondition,
  revealedPath,
  gridColumns,
  gridRows,
  showGrid,
  selectedTokenId,
  currentActorId,
  revealZones = [],
  permanentlyRevealedZones = new Set(),
  userRole,
  campaign = '',
  session = ''
}: ObserverViewProps) {
  const { send: sendWebSocket, subscribe } = useGameWebSocket(campaign, session);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const tokenImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [hoveredToken, setHoveredToken] = useState<Token | null>(null);
  const [hoveredProp, setHoveredProp] = useState<Prop | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [draggedToken, setDraggedToken] = useState<Token | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const clickedTokenRef = useRef<Token | null>(null);
  const optimisticPositions = useRef<Map<string, { x: number; y: number; currentlyFacing?: 'left' | 'right' }>>(new Map());
  const animatingTokenIds = useRef<Set<string>>(new Set());
  const finalAnimationPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Calculate actual pixel-based grid cell size for distance validation
  const pixelGridCellSize = calculateGridCellPixelSize(canvasRef.current, imageRef.current, gridColumns, gridRows);

  // Initialize shared token movement hook
  const { validateMove, applyMove } = useTokenMovement(tokens, { props, gridCellDistance: pixelGridCellSize });

  // Subscribe to WebSocket token movement updates
  useEffect(() => {
    const unsubscribe = subscribe('tokenMoved', (data: any) => {
      console.log('ObserverView: Received tokenMoved event', data);
      // Update tokens array with new position
      // Note: This is from other players/GM, just update our local state
    });

    return unsubscribe;
  }, [subscribe]);

  // Helper function to check if a point is revealed (not under fog)
  const checkPointRevealed = useCallback((x: number, y: number): boolean => {
    if (!imageRef.current || !canvasRef.current) return true;
    
    return isPointRevealed(
      x, y,
      tokens,
      props,
      revealedPath,
      revealZones,
      permanentlyRevealedZones,
      fogEnabled,
      lightingCondition,
      fogRevealDistance,
      gridColumns,
      gridRows,
      canvasRef.current.width,
      canvasRef.current.height,
      imageRef.current.width,
      imageRef.current.height
    );
  }, [fogEnabled, lightingCondition, fogRevealDistance, gridColumns, gridRows, tokens, props, revealedPath, revealZones, permanentlyRevealedZones]);

  // Load background image
  useEffect(() => {
    if (backgroundImage) {
      console.log('ObserverView: Loading background image:', backgroundImage);
      setImageLoaded(false);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        console.log('ObserverView: Background image loaded successfully');
        imageRef.current = img;
        setImageLoaded(true);
      };
      img.onerror = (e) => {
        console.error('ObserverView: Failed to load background image:', backgroundImage, e);
      };
      img.src = backgroundImage;
    } else {
      console.log('ObserverView: No background image provided');
      setImageLoaded(false);
    }
  }, [backgroundImage]);

  // Load token images
  useEffect(() => {
    tokens.forEach(token => {
      // Load base image
      if (token.imageUrl) {
        const baseKey = token.id;
        if (!tokenImagesRef.current.has(baseKey)) {
          const img = new Image();
          img.onload = () => {
            tokenImagesRef.current.set(baseKey, img);
            drawCanvas();
          };
          img.src = `${API_URL}${token.imageUrl}`;
        }
      }
      
      // Load state images
      if (token.states) {
        token.states.forEach(state => {
          if (state.imageUrl) {
            const stateKey = `${token.id}_${state.name}`;
            if (!tokenImagesRef.current.has(stateKey)) {
              const img = new Image();
              img.onload = () => {
                tokenImagesRef.current.set(stateKey, img);
                drawCanvas();
              };
              img.src = `${API_URL}${state.imageUrl}`;
            }
          }
        });
      }
    });
  }, [tokens]);

  // Load prop images
  useEffect(() => {
    props.forEach(prop => {
      // Load base image
      if (prop.imageUrl) {
        const baseKey = prop.id;
        if (!tokenImagesRef.current.has(baseKey)) {
          const img = new Image();
          img.onload = () => {
            tokenImagesRef.current.set(baseKey, img);
            drawCanvas();
          };
          img.src = `${API_URL}${prop.imageUrl}`;
        }
      }
      
      // Load state images
      if (prop.states) {
        prop.states.forEach(state => {
          if (state.imageUrl) {
            const stateKey = `${prop.id}_${state.name}`;
            if (!tokenImagesRef.current.has(stateKey)) {
              const img = new Image();
              img.onload = () => {
                tokenImagesRef.current.set(stateKey, img);
                drawCanvas();
              };
              img.src = `${API_URL}${state.imageUrl}`;
            }
          }
        });
      }
    });
  }, [props]);

  // Clear optimistic positions and animation flags when server confirms them
  useEffect(() => {
    const toRemove: string[] = [];
    optimisticPositions.current.forEach((pos, tokenId) => {
      const serverToken = tokens.find(t => t.id === tokenId);
      if (serverToken && serverToken.x === pos.x && serverToken.y === pos.y) {
        toRemove.push(tokenId);
      }
    });
    
    // Also check finalAnimationPositions - if animation finished and position matches, clear the animation flag
    finalAnimationPositions.current.forEach((finalPos, tokenId) => {
      const serverToken = tokens.find(t => t.id === tokenId);
      if (serverToken && serverToken.x === finalPos.x && serverToken.y === finalPos.y) {
        animatingTokenIds.current.delete(tokenId);
        finalAnimationPositions.current.delete(tokenId);
      }
    });
    
    toRemove.forEach(id => optimisticPositions.current.delete(id));
  }, [tokens]);

  // Set canvas dimensions to match CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    const fogCanvas = fogCanvasRef.current;
    
    if (canvas && fogCanvas) {
      // Set to match the GM view dimensions (1920x1080) for consistent transform coordinates
      canvas.width = 1920;
      canvas.height = 1080;
      fogCanvas.width = 1920;
      fogCanvas.height = 1080;
    }
  }, []);

  // Draw the main canvas with background image
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    console.log('ObserverView: drawCanvas called, canvas:', !!canvas, 'imageRef:', !!imageRef.current);
    if (!canvas) {
      console.log('ObserverView: No canvas element');
      return;
    }
    if (!imageRef.current) {
      console.log('ObserverView: No image loaded yet');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    console.log('ObserverView: Drawing canvas with image');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw a dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();

    // Apply transformations
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

    // Draw background image
    const img = imageRef.current;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width - img.width * scale) / 2;
    const y = (canvas.height - img.height * scale) / 2;
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

    // Restore context state
    ctx.restore();

    // Draw props (first, so tokens appear on top)
    console.log('ObserverView: Drawing props, total:', props.length);
    props.forEach(prop => {
      const currentImageUrl = getCurrentImageUrl(prop);
      console.log('Prop:', prop.id, 'has image:', !!currentImageUrl, 'x:', prop.x, 'y:', prop.y, 'radius:', prop.radius);
      if (prop.x !== undefined && prop.y !== undefined && prop.radius) {
        const propKey = prop.activeState ? `${prop.id}_${prop.activeState}` : prop.id;
        const propImg = tokenImagesRef.current.get(propKey);
        
        if (currentImageUrl && propImg && propImg.complete) {
          // Draw prop with image
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.scale(transform.scale, transform.scale);
          ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);
          
          // Apply rotation and scale from prop properties
          ctx.translate(prop.x, prop.y);
          const propRotation = prop.rotation || 0;
          ctx.rotate((propRotation * Math.PI) / 180);
          const propScale = prop.scale || 1;
          ctx.scale(propScale, propScale);

          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, prop.radius - 1, 0, Math.PI * 2);
          ctx.clip();
          
          const imgSize = (prop.radius - 1) * 2;
          ctx.drawImage(
            propImg,
            -prop.radius + 1,
            -prop.radius + 1,
            imgSize,
            imgSize
          );
          ctx.restore();
          ctx.restore();
        }
      }
    });

    // Draw tokens (on top of props - only active ones for players)
    // Use dragged token if currently dragging, otherwise use tokens from props with optimistic positions
    const tokensToRender = tokens.map(t => {
      if (draggedToken && t.id === draggedToken.id) {
        return draggedToken;
      }
      const optimisticPos = optimisticPositions.current.get(t.id);
      if (optimisticPos) {
        return { ...t, ...optimisticPos };
      }
      return t;
    });
      
    tokensToRender.filter(token => token.active).forEach(token => {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return;
      
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);
      
      // Check if this is the player's token
      const isPlayerToken = selectedTokenId && token.id === selectedTokenId;
      const isCurrentTurn = currentActorId && token.id === currentActorId;
      
      // Use optimistic position if available (from animation), otherwise use token position
      const optimisticPos = optimisticPositions.current.get(token.id);
      const isAnimating = animatingTokenIds.current.has(token.id);
      // If animating, always use optimistic position (never fall back to token position which might be stale)
      const tokenX = isAnimating && optimisticPos ? optimisticPos.x : (optimisticPos?.x ?? token.x);
      const tokenY = isAnimating && optimisticPos ? optimisticPos.y : (optimisticPos?.y ?? token.y);
      const tokenFacing = isAnimating && optimisticPos ? optimisticPos.currentlyFacing : (optimisticPos?.currentlyFacing ?? token.currentlyFacing);
      
      // Draw circle background/border
      ctx.beginPath();
      ctx.arc(tokenX, tokenY, token.radius, 0, Math.PI * 2);
      ctx.fillStyle = token.color || 'rgba(0, 100, 255, 0.5)';
      ctx.fill();
      ctx.strokeStyle = token.color ? token.color.replace('0.5', '0.8') : 'rgba(0, 50, 200, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Add gold highlight if it's this token's turn
      if (isCurrentTurn) {
        ctx.beginPath();
        ctx.arc(tokenX, tokenY, token.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'gold';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (token.actor?.player) {
        // Add blue highlight for other player characters
        ctx.beginPath();
        ctx.arc(tokenX, tokenY, token.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = isPlayerToken ? '#a855f7' : '#4da6ff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      // Add red highlight for selected token (for movement)
      if (selectedToken && selectedToken.id === token.id) {
        ctx.beginPath();
        ctx.arc(tokenX, tokenY, token.radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      
      // Draw token image if available
      const currentImageUrl = getCurrentImageUrl(token);
      if (currentImageUrl) {
        const tokenKey = token.activeState ? `${token.id}_${token.activeState}` : token.id;
        const tokenImg = tokenImagesRef.current.get(tokenKey);
        if (tokenImg && tokenImg.complete) {
          ctx.save();
          
          // Apply horizontal flip if token is facing left
          const facing = tokenFacing || 'right';
          if (facing === 'left') {
            ctx.translate(tokenX, tokenY);
            ctx.scale(-1, 1);
            ctx.translate(-tokenX, -tokenY);
          }
          
          ctx.beginPath();
          ctx.arc(tokenX, tokenY, token.radius - 1, 0, Math.PI * 2);
          ctx.clip();
          
          const imgSize = (token.radius - 1) * 2;
          ctx.drawImage(
            tokenImg,
            tokenX - token.radius + 1,
            tokenY - token.radius + 1,
            imgSize,
            imgSize
          );
          ctx.restore();
        }
      }
      
      ctx.restore();
    });

    // Draw grid if enabled
    if (showGrid && imageRef.current && gridColumns > 0 && gridRows > 0) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      const img = imageRef.current;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const imgWidth = img.width * scale;
      const imgHeight = img.height * scale;
      const startX = (canvas.width - imgWidth) / 2;
      const startY = (canvas.height - imgHeight) / 2;

      // Calculate pixel size of each grid square based on grid coordinates
      const cellWidth = imgWidth / gridColumns;
      const cellHeight = imgHeight / gridRows;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;

      // Draw vertical lines
      for (let i = 0; i <= gridColumns; i++) {
        const x = startX + (i * cellWidth);
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, startY + imgHeight);
        ctx.stroke();
      }

      // Draw horizontal lines
      for (let i = 0; i <= gridRows; i++) {
        const y = startY + (i * cellHeight);
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + imgWidth, y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [backgroundImage, transform, tokens, props, showGrid, gridColumns, gridRows, selectedTokenId, currentActorId, imageLoaded, draggedToken, selectedToken]);

  // Draw fog of war
  const drawFog = useCallback(() => {
    const canvas = fogCanvasRef.current;
    if (!canvas || !imageRef.current) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // For players: show fog if 'on' or 'off-gm', hide only if 'off-all'
    const shouldDrawFog = (fogEnabled !== 'off-all' || lightingCondition === 'dim' || lightingCondition === 'darkness');
    if (!shouldDrawFog) return;

    // Use GM-controlled player fog opacity, modified by lighting conditions
    let fogOpacity = playerFogOpacity;
    if (lightingCondition === 'dim') {
      fogOpacity = Math.min(playerFogOpacity, 0.6);
    } else if (lightingCondition === 'darkness') {
      fogOpacity = playerFogOpacity;
    }

    // Fill entire canvas with fog
    ctx.fillStyle = `rgba(0, 0, 0, ${fogOpacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Use shared fog rendering utility (only if image is loaded)
    if (!imageRef.current) return;
    
    renderFog({
      canvas,
      image: imageRef.current,
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
      gridCellDistance: 5,
    });
  }, [tokens, props, transform, fogEnabled, fogRevealDistance, playerFogOpacity, lightingCondition, revealedPath, gridColumns, gridRows, revealZones, permanentlyRevealedZones]);

  // Redraw when props change
  useEffect(() => {
    drawCanvas();
    drawFog();
  }, [drawCanvas, drawFog]);

  // Helper function to snap coordinates to grid
  const snapToGrid = useCallback((x: number, y: number): { x: number; y: number } => {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0) {
      return { x, y };
    }

    const canvas = canvasRef.current;
    const img = imageRef.current;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const imgWidth = img.width * scale;
    const imgHeight = img.height * scale;
    const offsetX = (canvas.width - imgWidth) / 2;
    const offsetY = (canvas.height - imgHeight) / 2;

    const cellWidth = imgWidth / gridColumns;
    const cellHeight = imgHeight / gridRows;

    // Convert to grid coordinates (relative to image)
    const relX = x - offsetX;
    const relY = y - offsetY;

    // Always snap the center of the image to the center of the nearest cell
    const gridX = Math.round(relX / cellWidth - 0.5);
    const gridY = Math.round(relY / cellHeight - 0.5);
    
    const snappedX = offsetX + (gridX + 0.5) * cellWidth;
    const snappedY = offsetY + (gridY + 0.5) * cellHeight;

    return { x: snappedX, y: snappedY };
  }, [gridColumns, gridRows]);

  // Check if user can move a token
  const canMoveToken = useCallback((token: Token): boolean => {
    // GM can move any token
    if (userRole === 'gm') return true;
    // Players can only move their own tokens
    if (userRole === 'player') return token.actor?.player === true;
    // No auth = no movement
    return false;
  }, [userRole]);

  // Animate token movement along a path
  const animateTokenMovement = useCallback(async (token: Token, path: Array<{ x: number; y: number }>) => {
    if (path.length === 0 || isMoving) return;
    
    setIsMoving(true);
    animatingTokenIds.current.add(token.id);
    
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const previousX = i === 0 ? token.x : path[i - 1].x;
      
      // Determine facing direction
      let currentlyFacing = token.currentlyFacing;
      if (previousX !== undefined && step.x !== previousX) {
        currentlyFacing = step.x > previousX ? 'right' : 'left';
      }
      
      // Update optimistic position for immediate visual feedback
      optimisticPositions.current.set(token.id, {
        x: step.x,
        y: step.y,
        currentlyFacing
      });
      
      // Trigger canvas redraw
      drawCanvas();
      
      // Update position on backend via WebSocket
      sendWebSocket({
        type: 'tokenMoved',
        data: {
          tokenId: token.id,
          x: step.x,
          y: step.y,
          currentlyFacing
        }
      });
      
      // Wait 200ms before next step
      if (i < path.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // Store final position but keep animatingTokenIds set - will be cleared by useEffect when game state updates
    const finalPos = path[path.length - 1];
    finalAnimationPositions.current.set(token.id, { x: finalPos.x, y: finalPos.y });
    
    setIsMoving(false);
    setSelectedToken(null);
  }, [isMoving, drawCanvas, sendWebSocket]);

  // A* pathfinding algorithm
  const findPath = useCallback((startX: number, startY: number, endX: number, endY: number, excludeTokenId?: string): Array<{ x: number; y: number }> => {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0) {
      return [];
    }

    const canvas = canvasRef.current;
    const img = imageRef.current;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const imgWidth = img.width * scale;
    const imgHeight = img.height * scale;
    const offsetX = (canvas.width - imgWidth) / 2;
    const offsetY = (canvas.height - imgHeight) / 2;
    const cellWidth = imgWidth / gridColumns;
    const cellHeight = imgHeight / gridRows;

    // Convert world coordinates to grid coordinates
    const toGridCoord = (x: number, y: number) => ({
      gx: Math.floor((x - offsetX) / cellWidth),
      gy: Math.floor((y - offsetY) / cellHeight)
    });

    // Convert grid coordinates to world coordinates
    const toWorldCoord = (gx: number, gy: number) => ({
      x: offsetX + (gx + 0.5) * cellWidth,
      y: offsetY + (gy + 0.5) * cellHeight
    });

    const start = toGridCoord(startX, startY);
    const end = toGridCoord(endX, endY);

    // Check if a grid position is occupied
    const isGridOccupied = (gx: number, gy: number): boolean => {
      const worldX = offsetX + (gx + 0.5) * cellWidth;
      const worldY = offsetY + (gy + 0.5) * cellHeight;
      return tokens.some(token => {
        if (excludeTokenId && token.id === excludeTokenId) return false;
        if (token.x === undefined || token.y === undefined) return false;
        const dx = Math.abs(token.x - worldX);
        const dy = Math.abs(token.y - worldY);
        return dx < cellWidth * 0.5 && dy < cellHeight * 0.5;
      }) || props.some(prop => {
        if (prop.x === undefined || prop.y === undefined) return false;
        const dx = Math.abs(prop.x - worldX);
        const dy = Math.abs(prop.y - worldY);
        return dx < cellWidth * 0.5 && dy < cellHeight * 0.5;
      });
    };

    // Heuristic: Manhattan distance
    const heuristic = (gx: number, gy: number) => Math.abs(gx - end.gx) + Math.abs(gy - end.gy);

    // A* search
    interface Node {
      gx: number;
      gy: number;
      g: number; // cost from start
      h: number; // heuristic to end
      parent?: Node;
    }

    const openSet: Node[] = [];
    const closedSet = new Set<string>();
    const cameFrom = new Map<string, { gx: number; gy: number }>();

    const startNode: Node = { gx: start.gx, gy: start.gy, g: 0, h: heuristic(start.gx, start.gy) };
    openSet.push(startNode);

    // Max iterations to prevent infinite loops
    let iterations = 0;
    const maxIterations = 10000;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Find node with lowest f = g + h
      let current = openSet[0];
      let currentIndex = 0;
      for (let i = 1; i < openSet.length; i++) {
        const f = openSet[i].g + openSet[i].h;
        const currentF = current.g + current.h;
        if (f < currentF) {
          current = openSet[i];
          currentIndex = i;
        }
      }

      if (current.gx === end.gx && current.gy === end.gy) {
        // Found path - reconstruct it
        const path: Array<{ x: number; y: number }> = [];
        let node: Node | undefined = current;
        while (node) {
          const worldCoord = toWorldCoord(node.gx, node.gy);
          path.unshift(worldCoord);
          const key = `${node.gx},${node.gy}`;
          const parent = cameFrom.get(key);
          if (!parent) break;
          node = { gx: parent.gx, gy: parent.gy, g: 0, h: 0 };
        }
        return path;
      }

      openSet.splice(currentIndex, 1);
      const key = `${current.gx},${current.gy}`;
      closedSet.add(key);

      // Check neighbors (4-directional: up, down, left, right)
      const neighbors = [
        { gx: current.gx, gy: current.gy - 1 },
        { gx: current.gx, gy: current.gy + 1 },
        { gx: current.gx - 1, gy: current.gy },
        { gx: current.gx + 1, gy: current.gy }
      ];

      for (const neighbor of neighbors) {
        // Check bounds
        if (neighbor.gx < 0 || neighbor.gx >= gridColumns || neighbor.gy < 0 || neighbor.gy >= gridRows) {
          continue;
        }

        const neighborKey = `${neighbor.gx},${neighbor.gy}`;
        if (closedSet.has(neighborKey)) continue;

        // Check if occupied
        if (isGridOccupied(neighbor.gx, neighbor.gy)) continue;

        const g = current.g + 1;
        const h = heuristic(neighbor.gx, neighbor.gy);
        const neighborNode: Node = { ...neighbor, g, h };

        // Check if neighbor is already in openSet with worse path
        const existingIndex = openSet.findIndex(n => n.gx === neighbor.gx && n.gy === neighbor.gy);
        if (existingIndex >= 0) {
          if (g < openSet[existingIndex].g) {
            openSet[existingIndex] = neighborNode;
            cameFrom.set(neighborKey, { gx: current.gx, gy: current.gy });
          }
        } else {
          openSet.push(neighborNode);
          cameFrom.set(neighborKey, { gx: current.gx, gy: current.gy });
        }
      }
    }

    // No path found
    return [];
  }, [tokens, props, gridColumns, gridRows]);

  // Helper to convert screen to world coordinates
  const screenToWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Translate to origin
    let worldX = screenX - centerX;
    let worldY = screenY - centerY;
    
    // Apply inverse rotation
    const angle = -(transform.rotation * Math.PI) / 180;
    const rotatedX = worldX * Math.cos(angle) - worldY * Math.sin(angle);
    const rotatedY = worldX * Math.sin(angle) + worldY * Math.cos(angle);
    
    // Apply inverse scale and translation
    worldX = rotatedX / transform.scale - transform.x + centerX;
    worldY = rotatedY / transform.scale - transform.y + centerY;

    return { x: worldX, y: worldY };
  }, [transform]);

  // Helper to convert world to screen coordinates
  const worldToScreen = useCallback((worldX: number, worldY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Apply transformation (inverse of screenToWorld)
    let x = worldX - centerX + transform.x;
    let y = worldY - centerY + transform.y;
    
    // Apply scale
    x *= transform.scale;
    y *= transform.scale;
    
    // Apply rotation
    const angle = (transform.rotation * Math.PI) / 180;
    const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
    const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
    
    // Translate to canvas position
    const screenX = rotatedX + centerX;
    const screenY = rotatedY + centerY;

    return { x: screenX, y: screenY };
  }, [transform]);

  // Handle mouse down to start dragging or prepare for click
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse position to canvas coordinates
    const canvasX = (mouseX / rect.width) * canvas.width;
    const canvasY = (mouseY / rect.height) * canvas.height;

    const worldPos = screenToWorld(canvasX, canvasY);

    // If a token is selected and user clicks the map, move token along path
    if (selectedToken && selectedToken.x !== undefined && selectedToken.y !== undefined && !isMoving) {
      const activeTokens = tokens.filter(token => token.active);
      let clickedOnToken = false;
      
      for (const token of activeTokens) {
        if (token.x === undefined || token.y === undefined) continue;
        const dx = worldPos.x - token.x;
        const dy = worldPos.y - token.y;
        if (Math.sqrt(dx * dx + dy * dy) <= token.radius) {
          clickedOnToken = true;
          // If clicking on the same selected token, deselect it
          if (token.id === selectedToken.id) {
            setSelectedToken(null);
            return;
          }
          // If clicking on a different token that can be moved, select it
          if (canMoveToken(token)) {
            setSelectedToken(token);
            setHoveredToken(null);
            setHoveredProp(null);
            return;
          }
          break;
        }
      }
      
      if (!clickedOnToken) {
        for (const prop of props) {
          if (prop.x === undefined || prop.y === undefined) continue;
          const dx = worldPos.x - prop.x;
          const dy = worldPos.y - prop.y;
          if (Math.sqrt(dx * dx + dy * dy) <= prop.radius) {
            clickedOnToken = true;
            break;
          }
        }
      }
      
      // Clicked on empty space - move selected token
      if (!clickedOnToken) {
        const path = findPath(selectedToken.x, selectedToken.y, worldPos.x, worldPos.y, selectedToken.id);
        if (path.length > 0) {
          animateTokenMovement(selectedToken, path);
        }
        return;
      }
    }

    // Check if clicking on a token (when no token is selected)
    const activeTokens = tokens.filter(token => token.active);
    for (const token of activeTokens) {
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;
      
      const dx = worldPos.x - token.x;
      const dy = worldPos.y - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= token.radius) {
        // If user can move this token, select it for movement
        if (canMoveToken(token)) {
          setSelectedToken(token);
          setHoveredToken(null);
          setHoveredProp(null);
          clickedTokenRef.current = null;
          return;
        }
        
        // Otherwise, store for info panel display
        clickedTokenRef.current = token;
        setIsDragging(false);
        return;
      }
    }

    // Check if clicking on a prop (if no token was clicked)
    for (const prop of props) {
      if (prop.x === undefined || prop.y === undefined) continue;
      
      const dx = worldPos.x - prop.x;
      const dy = worldPos.y - prop.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= prop.radius) {
        // Calculate screen position and show prop panel
        const propScreenPos = worldToScreen(prop.x, prop.y);
        const screenX = (propScreenPos.x / canvas.width) * rect.width;
        const screenY = (propScreenPos.y / canvas.height) * rect.height;
        setMousePos({ x: screenX, y: screenY });
        setHoveredProp(prop);
        setHoveredToken(null);
        setSelectedToken(null);
        return;
      }
    }
    
    setSelectedToken(null);
  }, [tokens, props, screenToWorld, worldToScreen, canMoveToken, selectedToken, findPath, isMoving, animateTokenMovement]);

  // Handle mouse up to finish dragging or show info panel
  const handleMouseUp = useCallback(() => {
    const canvas = canvasRef.current;
    
    // If we didn't drag and clicked on a token, show the info panel
    if (!isDragging && clickedTokenRef.current && canvas) {
      const token = clickedTokenRef.current;
      // Only show info if token is revealed (not under fog)
      if (token.x !== undefined && token.y !== undefined && checkPointRevealed(token.x, token.y)) {
        // Calculate screen position of the token center
        const tokenScreenPos = worldToScreen(token.x, token.y);
        const rect = canvas.getBoundingClientRect();
        const screenX = (tokenScreenPos.x / canvas.width) * rect.width;
        const screenY = (tokenScreenPos.y / canvas.height) * rect.height;
        setMousePos({ x: screenX, y: screenY });
        setHoveredToken(token);
        setHoveredProp(null);
      }
    }
    
    // If we were dragging, store the optimistic position
    if (isDragging && draggedToken) {
      optimisticPositions.current.set(draggedToken.id, {
        x: draggedToken.x!,
        y: draggedToken.y!,
        currentlyFacing: draggedToken.currentlyFacing
      });
    }
    
    // Clear drag state immediately
    setDraggedToken(null);
    setIsDragging(false);
    clickedTokenRef.current = null;
  }, [isDragging, draggedToken, worldToScreen, isPointRevealed]);

  // Handle mouse move for dragging
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current || !draggedToken) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse position to canvas coordinates
    const canvasX = (mouseX / rect.width) * canvas.width;
    const canvasY = (mouseY / rect.height) * canvas.height;

    const worldPos = screenToWorld(canvasX, canvasY);

    // Snap mouse position to grid
    const snappedPos = snapToGrid(worldPos.x, worldPos.y);

    // Validate the move using shared logic
    if (draggedToken.x !== undefined && draggedToken.y !== undefined) {
      const validatedMove = validateMove(draggedToken, snappedPos.x, snappedPos.y);

      // If move is not valid, don't proceed
      if (!validatedMove) {
        return;
      }

      // Mark that we're dragging
      setIsDragging(true);

      // Apply the validated move to the token
      const updatedToken = applyMove(draggedToken, validatedMove);
      setDraggedToken(updatedToken);

      // Fog reveal is now handled server-side in the update-token-position endpoint
      // Save to backend immediately via WebSocket
      sendWebSocket({
        type: 'tokenMoved',
        data: {
          tokenId: updatedToken.id,
          x: updatedToken.x,
          y: updatedToken.y,
          currentlyFacing: updatedToken.currentlyFacing
        }
      });
    }
  }, [draggedToken, screenToWorld, snapToGrid, validateMove, applyMove]);

  const handleMouseLeave = useCallback(() => {
    // Don't close the panel on mouse leave - only close button should close it
  }, []);

  return (
    <div className="player-view-container">
      <canvas 
        ref={canvasRef} 
        className="player-background-canvas" 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      <canvas ref={fogCanvasRef} className="player-fog-canvas" />
      
      {hoveredToken && mousePos && (
        <div 
          className="token-hover-card"
          style={{
            position: 'absolute',
            left: `${mousePos.x}px`,
            top: mousePos.y < 200 ? `${mousePos.y + 20}px` : `${mousePos.y - 20}px`,
            transform: mousePos.y < 200 ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)',
            pointerEvents: 'auto'
          }}
        >
          <button
            className="token-hover-close"
            onClick={(e) => {
              e.stopPropagation();
              setHoveredToken(null);
              setMousePos(null);
            }}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: 'rgba(0, 0, 0, 0.7)',
              border: '1px solid #666',
              borderRadius: '3px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '16px',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0'
            }}
            title="Close"
          >
            ×
          </button>
          <div className="token-hover-header">
            {hoveredToken.imageUrl && (
              <img 
                src={`${API_URL}${hoveredToken.imageUrl}`}
                alt={hoveredToken.actor?.name || 'Token'}
                className="token-hover-image"
              />
            )}
            <div className="token-hover-name">
              {hoveredToken.actor?.name || 'Unknown'}
            </div>
          </div>
          
          {hoveredToken.actor && (
            <div className="token-hover-stats">
              <div className="token-hover-stat">
                <span className="stat-label">Initiative:</span>
                <span className="stat-value">{hoveredToken.actor.initiative ?? 0}</span>
              </div>
              <div className="token-hover-stat">
                <span className="stat-label">HP:</span>
                <span className="stat-value">{hoveredToken.actor.hp ?? 0}</span>
              </div>
              <div className="token-hover-stat">
                <span className="stat-label">AC:</span>
                <span className="stat-value">{hoveredToken.actor.ac ?? 0}</span>
              </div>
            </div>
          )}
          
          {/* State thumbnails - only show if user is GM or owner */}
          {hoveredToken.states && hoveredToken.states.length > 0 && (userRole === 'gm' || hoveredToken.actor?.player) && (
            <div style={{
              display: 'flex',
              gap: '4px',
              marginTop: '8px',
              padding: '8px',
              borderTop: '1px solid #666',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}>
              {/* Base state button */}
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const response = await fetch(`${API_URL}/api/update-token-state`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({
                        tokenId: hoveredToken.id,
                        activeState: undefined
                      })
                    });
                    if (!response.ok) {
                      console.error('Failed to update token state:', await response.text());
                    }
                  } catch (error) {
                    console.error('Failed to update token state:', error);
                  }
                }}
                style={{
                  width: '40px',
                  height: '40px',
                  padding: '2px',
                  border: !hoveredToken.activeState ? '2px solid #6fa86f' : '1px solid #666',
                  background: !hoveredToken.activeState ? '#4a7c4a' : '#444',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Base state"
              >
                <img
                  src={`${API_URL}${hoveredToken.imageUrl}`}
                  alt="Base"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '2px'
                  }}
                />
              </button>
              
              {/* State buttons */}
              {hoveredToken.states
                .filter(state => userRole === 'gm' || state.playerInteractible)
                .map((state) => (
                <button
                  key={state.name}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const response = await fetch(`${API_URL}/api/update-token-state`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          tokenId: hoveredToken.id,
                          activeState: state.name
                        })
                      });
                      if (!response.ok) {
                        console.error('Failed to update token state:', await response.text());
                      }
                    } catch (error) {
                      console.error('Failed to update token state:', error);
                    }
                  }}
                  style={{
                    width: '40px',
                    height: '40px',
                    padding: '2px',
                    border: hoveredToken.activeState === state.name ? '2px solid #6fa86f' : '1px solid #666',
                    background: hoveredToken.activeState === state.name ? '#4a7c4a' : '#444',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={state.name}
                >
                  <img
                    src={`${API_URL}${state.imageUrl}`}
                    alt={state.name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '2px'
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hoveredProp && mousePos && (hoveredProp.states && hoveredProp.states.length > 0) && (
        <div 
          className="token-hover-card"
          style={{
            position: 'absolute',
            left: `${mousePos.x}px`,
            top: mousePos.y < 200 ? `${mousePos.y + 20}px` : `${mousePos.y - 20}px`,
            transform: mousePos.y < 200 ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)',
            pointerEvents: 'auto'
          }}
        >
          <button
            className="token-hover-close"
            onClick={(e) => {
              e.stopPropagation();
              setHoveredProp(null);
              setMousePos(null);
            }}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: 'rgba(0, 0, 0, 0.7)',
              border: '1px solid #666',
              borderRadius: '3px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '16px',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0'
            }}
            title="Close"
          >
            ×
          </button>
          <div className="token-hover-header">
            {hoveredProp.imageUrl && (
              <img 
                src={`${API_URL}${hoveredProp.imageUrl}`}
                alt={hoveredProp.name || 'Prop'}
                className="token-hover-image"
              />
            )}
            <div className="token-hover-name">
              {hoveredProp.name || 'Unknown'}
            </div>
          </div>
          
          {/* State thumbnails */}
          <div style={{
            display: 'flex',
            gap: '4px',
            marginTop: '8px',
            padding: '8px',
            borderTop: '1px solid #666',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            {/* Base state button */}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const response = await fetch(`${API_URL}/api/update-prop-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                      propId: hoveredProp.id,
                      activeState: undefined
                    })
                  });
                  if (!response.ok) {
                    console.error('Failed to update prop state:', await response.text());
                  }
                } catch (error) {
                  console.error('Failed to update prop state:', error);
                }
              }}
              style={{
                width: '40px',
                height: '40px',
                padding: '2px',
                border: !hoveredProp.activeState ? '2px solid #6fa86f' : '1px solid #666',
                background: !hoveredProp.activeState ? '#4a7c4a' : '#444',
                borderRadius: '4px',
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Base state"
            >
              <img
                src={`${API_URL}${hoveredProp.imageUrl}`}
                alt="Base"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '2px'
                }}
              />
            </button>
            
            {/* State buttons - filter by playerInteractible */}
            {hoveredProp.states
              .filter(state => userRole === 'gm' || state.playerInteractible)
              .map((state) => (
              <button
                key={state.name}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const response = await fetch(`${API_URL}/api/update-prop-state`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({
                        propId: hoveredProp.id,
                        activeState: state.name
                      })
                    });
                    if (!response.ok) {
                      console.error('Failed to update prop state:', await response.text());
                    }
                  } catch (error) {
                    console.error('Failed to update prop state:', error);
                  }
                }}
                style={{
                  width: '40px',
                  height: '40px',
                  padding: '2px',
                  border: hoveredProp.activeState === state.name ? '2px solid #6fa86f' : '1px solid #666',
                  background: hoveredProp.activeState === state.name ? '#4a7c4a' : '#444',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={state.name}
              >
                <img
                  src={`${API_URL}${state.imageUrl}`}
                  alt={state.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '2px'
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
