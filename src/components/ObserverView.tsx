import { useRef, useEffect, useCallback, useState } from 'react';
import './ObserverView.css';
import { API_URL } from '../config';
import type { Token, Prop, RevealZone } from '../types';

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
  campaignName?: string;
  sessionName?: string;
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
  campaignName,
  sessionName
}: ObserverViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const tokenImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [hoveredToken, setHoveredToken] = useState<Token | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [draggedToken, setDraggedToken] = useState<Token | null>(null);

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
      const currentImageUrl = getCurrentImageUrl(token);
      if (currentImageUrl && !tokenImagesRef.current.has(token.id)) {
        const img = new Image();
        img.onload = () => {
          tokenImagesRef.current.set(token.id, img);
          drawCanvas();
        };
        // Prepend API_URL if the image URL is relative
        img.src = currentImageUrl.startsWith('http') ? currentImageUrl : `${API_URL}${currentImageUrl}`;
      }
    });
  }, [tokens]);

  // Load prop images
  useEffect(() => {
    props.forEach(prop => {
      const currentImageUrl = getCurrentImageUrl(prop);
      if (currentImageUrl && !tokenImagesRef.current.has(prop.id)) {
        const img = new Image();
        img.onload = () => {
          tokenImagesRef.current.set(prop.id, img);
          drawCanvas();
        };
        // Prepend API_URL if the image URL is relative
        img.src = currentImageUrl.startsWith('http') ? currentImageUrl : `${API_URL}${currentImageUrl}`;
      }
    });
  }, [props]);

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
        const propImg = tokenImagesRef.current.get(prop.id);
        
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
    // Use dragged token if currently dragging, otherwise use tokens from props
    const tokensToRender = draggedToken 
      ? tokens.map(t => t.id === draggedToken.id ? draggedToken : t)
      : tokens;
      
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
      
      // Draw circle background/border
      ctx.beginPath();
      ctx.arc(token.x, token.y, token.radius, 0, Math.PI * 2);
      ctx.fillStyle = token.color || 'rgba(0, 100, 255, 0.5)';
      ctx.fill();
      ctx.strokeStyle = token.color ? token.color.replace('0.5', '0.8') : 'rgba(0, 50, 200, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Add gold highlight if it's this token's turn
      if (isCurrentTurn) {
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'gold';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (token.actor?.player) {
        // Add blue highlight for other player characters
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = isPlayerToken ? '#a855f7' : '#4da6ff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      
      // Draw token image if available
      const currentImageUrl = getCurrentImageUrl(token);
      if (currentImageUrl) {
        const tokenImg = tokenImagesRef.current.get(token.id);
        if (tokenImg && tokenImg.complete) {
          ctx.save();
          
          // Apply horizontal flip if token is facing left
          const facing = token.currentlyFacing || 'right';
          if (facing === 'left') {
            ctx.translate(token.x, token.y);
            ctx.scale(-1, 1);
            ctx.translate(-token.x, -token.y);
          }
          
          ctx.beginPath();
          ctx.arc(token.x, token.y, token.radius - 1, 0, Math.PI * 2);
          ctx.clip();
          
          const imgSize = (token.radius - 1) * 2;
          ctx.drawImage(
            tokenImg,
            token.x - token.radius + 1,
            token.y - token.radius + 1,
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
  }, [backgroundImage, transform, tokens, props, showGrid, gridColumns, gridRows, selectedTokenId, currentActorId, imageLoaded, draggedToken]);

  // Draw fog of war
  const drawFog = useCallback(() => {
    const canvas = fogCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // For players: show fog if 'on' or 'off-gm', hide only if 'off-all'
    const shouldDrawFog = (fogEnabled !== 'off-all' || lightingCondition === 'dim' || lightingCondition === 'darkness');
    if (!shouldDrawFog) return;

    // Use GM-controlled player fog opacity, modified by lighting conditions
    let fogOpacity = playerFogOpacity;
    if (lightingCondition === 'dim') {
      fogOpacity = Math.min(playerFogOpacity, 0.6); // Dim light - partial obscurement
    } else if (lightingCondition === 'darkness') {
      fogOpacity = playerFogOpacity; // Use player fog opacity for darkness
    }

    // Fill entire canvas with fog
    ctx.fillStyle = `rgba(0, 0, 0, ${fogOpacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate grid cell size in pixels for fog reveal radius
    let gridCellSize = 20; // Default fallback
    if (imageRef.current && gridColumns > 0 && gridRows > 0) {
      const img = imageRef.current;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const imgWidth = img.width * scale;
      const imgHeight = img.height * scale;
      const cellWidth = imgWidth / gridColumns;
      const cellHeight = imgHeight / gridRows;
      // Use average of width and height for square-ish cells
      gridCellSize = (cellWidth + cellHeight) / 2;
    }

    // Only clear fog around active player tokens and revealed path if there are light sources
    const activePlayerTokens = tokens.filter(token => token.active && token.actor?.player === true);
    
    // Helper function to parse light radius from tags (e.g., "light[30]" -> 30)
    const parseLightRadius = (tags?: string): number | null => {
      if (!tags) return null;
      const match = tags.match(/light\[(\d+)\]/i);
      return match ? parseInt(match[1], 10) : null;
    };

    // Helper function to get effective tags from token/prop considering active state
    const getEffectiveTags = (item: Token | Prop): string | undefined => {
      if (item.activeState && item.states) {
        const activeStateObj = item.states.find(s => s.name === item.activeState);
        // If a state is active, only use that state's tags (even if undefined)
        // Don't fall back to base tags when a state is explicitly selected
        return activeStateObj?.tags;
      }
      // No active state, use base tags
      return item.tags;
    };

    // Collect light sources from tokens and props with light tags
    const lightSources: Array<{ x: number; y: number; radius: number }> = [];
    const gridCellDistance = 5; // 5 feet per grid square (standard D&D)
    
    // Check all tokens for light tags
    tokens.forEach(token => {
      if (token.x !== undefined && token.y !== undefined && token.x !== null && token.y !== null) {
        const effectiveTags = getEffectiveTags(token);
        const lightRadius = parseLightRadius(effectiveTags);
        if (lightRadius) {
          // Convert feet to grid squares
          const lightRadiusSquares = lightRadius / gridCellDistance;
          lightSources.push({ x: token.x, y: token.y, radius: lightRadiusSquares });
        }
      }
    });
    
    // Check all props for light tags
    props.forEach(prop => {
      if (prop.x !== undefined && prop.y !== undefined) {
        const effectiveTags = getEffectiveTags(prop);
        const lightRadius = parseLightRadius(effectiveTags);
        if (lightRadius) {
          // Convert feet to grid squares
          const lightRadiusSquares = lightRadius / gridCellDistance;
          lightSources.push({ x: prop.x, y: prop.y, radius: lightRadiusSquares });
        }
      }
    });
    
    if (activePlayerTokens.length > 0 || revealedPath.length > 0 || lightSources.length > 0 || revealZones.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      
      // Reveal fog along the path tokens have traveled
      if (revealedPath.length > 0) {
        let effectiveRevealDistance = fogRevealDistance;
        if (lightingCondition === 'darkness') {
          effectiveRevealDistance = fogRevealDistance * 0.5;
        }
        
        revealedPath.forEach(point => {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.scale(transform.scale, transform.scale);
          ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);
          
          const gradient = ctx.createRadialGradient(
            point.x, point.y, 0,
            point.x, point.y, gridCellSize * effectiveRevealDistance
          );
          gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
          gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(point.x, point.y, gridCellSize * effectiveRevealDistance, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.restore();
        });
      }
      
      activePlayerTokens.forEach(token => {
        // Skip tokens without positions
        if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return;
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scale, transform.scale);
        ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);
        
        // Adjust reveal distance based on lighting condition
        let effectiveRevealDistance = fogRevealDistance;
        if (lightingCondition === 'darkness') {
          effectiveRevealDistance = fogRevealDistance * 0.5;
        }
        
        // Create gradient for smooth fog reveal using grid cell size
        const gradient = ctx.createRadialGradient(
          token.x, token.y, 0, 
          token.x, token.y, gridCellSize * effectiveRevealDistance
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(token.x, token.y, gridCellSize * effectiveRevealDistance, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      });
      
      // Reveal fog around light sources (props with lighting effects)
      lightSources.forEach(light => {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scale, transform.scale);
        ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

        const gradient = ctx.createRadialGradient(
          light.x, light.y, 0,
          light.x, light.y, gridCellSize * light.radius
        );
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
        // Check if any active player token is in the zone
        const playerInZone = activePlayerTokens.some(token => {
          if (token.x === undefined || token.y === undefined) return false;
          return (
            token.x >= zone.x &&
            token.x <= zone.x + zone.width &&
            token.y >= zone.y &&
            token.y <= zone.y + zone.height
          );
        });

        // Reveal if player is in zone, or if zone is permanent and has been revealed
        if (playerInZone || (zone.permanent && permanentlyRevealedZones.has(zone.id))) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.scale(transform.scale, transform.scale);
          ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

          // Clear fog in this rectangular zone
          ctx.fillStyle = 'rgba(0, 0, 0, 1)';
          ctx.fillRect(zone.x, zone.y, zone.width, zone.height);

          ctx.restore();
        }
      });
      
      ctx.restore();
    }
  }, [tokens, props, transform, fogEnabled, fogRevealDistance, playerFogOpacity, lightingCondition, revealedPath, gridColumns, gridRows, imageRef, revealZones, permanentlyRevealedZones]);

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

  // Calculate grid distance between two positions
  const getGridDistance = useCallback((x1: number, y1: number, x2: number, y2: number): number => {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0) {
      return 0;
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

    // Convert to grid coordinates
    const gridX1 = Math.floor((x1 - offsetX) / cellWidth);
    const gridY1 = Math.floor((y1 - offsetY) / cellHeight);
    const gridX2 = Math.floor((x2 - offsetX) / cellWidth);
    const gridY2 = Math.floor((y2 - offsetY) / cellHeight);

    // Calculate Manhattan distance (grid squares)
    return Math.abs(gridX2 - gridX1) + Math.abs(gridY2 - gridY1);
  }, [gridColumns, gridRows]);

  // Check if a position is occupied by another token
  const isPositionOccupied = useCallback((x: number, y: number, excludeTokenId?: string): boolean => {
    return tokens.some(token => {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return false;
      
      if (excludeTokenId && token.id === excludeTokenId) {
        return false;
      }
      // Check if positions are the same (with small tolerance for floating point comparison)
      const dx = Math.abs(token.x - x);
      const dy = Math.abs(token.y - y);
      return dx < 1 && dy < 1;
    });
  }, [tokens]);

  // Check if user can move a token
  const canMoveToken = useCallback((token: Token): boolean => {
    // GM can move any token
    if (userRole === 'gm') return true;
    // Players can only move their own tokens
    if (userRole === 'player') return token.actor?.player === true;
    // No auth = no movement
    return false;
  }, [userRole]);

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

  // Handle mouse down to start dragging
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

    // Check if clicking on a movable token
    const activeTokens = tokens.filter(token => token.active);
    for (const token of activeTokens) {
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;
      
      const dx = worldPos.x - token.x;
      const dy = worldPos.y - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= token.radius && canMoveToken(token)) {
        // Store the token being dragged
        setDraggedToken(token);
        return;
      }
    }
  }, [tokens, transform, canMoveToken, screenToWorld]);

  // Handle mouse up to finish dragging
  const handleMouseUp = useCallback(() => {
    // Keep draggedToken for a moment to let polling update before clearing
    // This prevents the token from snapping back while waiting for the poll
    setTimeout(() => {
      setDraggedToken(null);
    }, 100);
  }, []);

  // Handle mouse move to detect token hovers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse position to canvas coordinates
    const canvasX = (mouseX / rect.width) * canvas.width;
    const canvasY = (mouseY / rect.height) * canvas.height;

    const worldPos = screenToWorld(canvasX, canvasY);

    // Handle dragging with grid-based movement
    if (draggedToken && draggedToken.x !== undefined && draggedToken.y !== undefined) {
      // Snap mouse position to grid
      const snappedPos = snapToGrid(worldPos.x, worldPos.y);

      // Calculate grid distance from current position
      const distance = getGridDistance(draggedToken.x, draggedToken.y, snappedPos.x, snappedPos.y);

      // Only allow movement of exactly 1 grid square
      if (distance !== 1) {
        return; // Don't move if distance is not exactly 1
      }

      // Check if position is occupied by another token
      if (isPositionOccupied(snappedPos.x, snappedPos.y, draggedToken.id)) {
        return; // Don't move to occupied position
      }

      // Update token position in tokens array
      const deltaX = snappedPos.x - draggedToken.x;
      const updatedToken = { ...draggedToken, x: snappedPos.x, y: snappedPos.y };
      if (deltaX > 0) {
        updatedToken.currentlyFacing = 'right';
      } else if (deltaX < 0) {
        updatedToken.currentlyFacing = 'left';
      }

      // Update the token in the dragged state
      setDraggedToken(updatedToken);

      // Save to backend immediately and await response
      (async () => {
        try {
          const response = await fetch(`${API_URL}/api/update-token-position`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              tokenId: updatedToken.id,
              x: updatedToken.x,
              y: updatedToken.y,
              currentlyFacing: updatedToken.currentlyFacing
            })
          });
          
          if (!response.ok) {
            console.error('Failed to save token position:', await response.text());
          } else {
            console.log('Token position saved:', updatedToken.id, updatedToken.x, updatedToken.y);
          }
        } catch (error) {
          console.error('Failed to save token position:', error);
        }
      })();

      return;
    }

    // Check if mouse is over any token (for hover effect)
    const activeTokens = tokens.filter(token => token.active);
    let foundToken: Token | null = null;

    for (const token of activeTokens) {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;
      
      const dx = worldPos.x - token.x;
      const dy = worldPos.y - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= token.radius) {
        foundToken = token;
        break;
      }
    }

    setHoveredToken(foundToken);
    setMousePos(foundToken ? { x: mouseX, y: mouseY } : null);
  }, [tokens, transform, draggedToken, screenToWorld, snapToGrid, getGridDistance, isPositionOccupied]);

  const handleMouseLeave = useCallback(() => {
    setHoveredToken(null);
    setMousePos(null);
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
            left: `${mousePos.x}px`,
            top: `${mousePos.y - 20}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="token-hover-header">
            {hoveredToken.imageUrl && (
              <img 
                src={hoveredToken.imageUrl.startsWith('http') ? hoveredToken.imageUrl : `${API_URL}${hoveredToken.imageUrl}`}
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
        </div>
      )}
    </div>
  );
}
