import { useRef, useEffect, useCallback, useState } from 'react';
import './ObserverView.css';
import { API_URL } from '../config';
import type { Token, Prop } from '../types';

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
  currentActorId
}: ObserverViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const tokenImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [hoveredToken, setHoveredToken] = useState<Token | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Load background image
  useEffect(() => {
    if (backgroundImage) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageRef.current = img;
        drawCanvas();
      };
      img.src = backgroundImage;
    }
  }, [backgroundImage]);

  // Load token images
  useEffect(() => {
    tokens.forEach(token => {
      if (token.imageUrl && !tokenImagesRef.current.has(token.id)) {
        const img = new Image();
        img.onload = () => {
          tokenImagesRef.current.set(token.id, img);
          drawCanvas();
        };
        // Prepend API_URL if the image URL is relative
        img.src = token.imageUrl.startsWith('http') ? token.imageUrl : `${API_URL}${token.imageUrl}`;
      }
    });
  }, [tokens]);

  // Load prop images
  useEffect(() => {
    props.forEach(prop => {
      if (prop.imageUrl && !tokenImagesRef.current.has(prop.id)) {
        const img = new Image();
        img.onload = () => {
          tokenImagesRef.current.set(prop.id, img);
          drawCanvas();
        };
        // Prepend API_URL if the image URL is relative
        img.src = prop.imageUrl.startsWith('http') ? prop.imageUrl : `${API_URL}${prop.imageUrl}`;
      }
    });
  }, [props]);

  // Set canvas dimensions to match CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    const fogCanvas = fogCanvasRef.current;
    
    if (canvas && fogCanvas) {
      // Set to match the GM view dimensions (1200x800)
      canvas.width = 1200;
      canvas.height = 800;
      fogCanvas.width = 1200;
      fogCanvas.height = 800;
    }
  }, []);

  // Draw the main canvas with background image
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // Draw props (first, so tokens appear on top - only props WITH images show on observer view)
    console.log('ObserverView: Drawing props, total:', props.length);
    props.forEach(prop => {
      console.log('Prop:', prop.id, 'has image:', !!prop.imageUrl, 'x:', prop.x, 'y:', prop.y, 'radius:', prop.radius);
      if (prop.x !== undefined && prop.y !== undefined && prop.radius && prop.imageUrl) {
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

        const propImg = tokenImagesRef.current.get(prop.id);
        if (propImg && propImg.complete) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, prop.radius - 1, 0, Math.PI * 2);
          ctx.clip();
          
          const imgSize = (prop.radius - 1) * 2;
          ctx.drawImage(
            propImg,
            prop.x - prop.radius + 1,
            prop.y - prop.radius + 1,
            imgSize,
            imgSize
          );
          ctx.restore();
        }
        
        ctx.restore();
      }
    });

    // Draw tokens (on top of props - only active ones for players)
    tokens.filter(token => token.active).forEach(token => {
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
      if (token.imageUrl) {
        const tokenImg = tokenImagesRef.current.get(token.id);
        if (tokenImg && tokenImg.complete) {
          ctx.save();
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
  }, [transform, tokens, props, showGrid, gridColumns, gridRows, selectedTokenId, currentActorId]);

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
    if (activePlayerTokens.length > 0 || revealedPath.length > 0) {
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
      
      ctx.restore();
    }
  }, [tokens, transform, fogEnabled, fogRevealDistance, playerFogOpacity, lightingCondition, revealedPath, gridColumns, gridRows, imageRef]);

  // Redraw when props change
  useEffect(() => {
    drawCanvas();
    drawFog();
  }, [drawCanvas, drawFog]);

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

    // Apply inverse transform to get world coordinates
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Translate to origin
    let worldX = canvasX - centerX;
    let worldY = canvasY - centerY;
    
    // Apply inverse rotation
    const angle = -(transform.rotation * Math.PI) / 180;
    const rotatedX = worldX * Math.cos(angle) - worldY * Math.sin(angle);
    const rotatedY = worldX * Math.sin(angle) + worldY * Math.cos(angle);
    
    // Apply inverse scale and translation
    worldX = rotatedX / transform.scale - transform.x + centerX;
    worldY = rotatedY / transform.scale - transform.y + centerY;

    // Check if mouse is over any token
    const activeTokens = tokens.filter(token => token.active);
    let foundToken: Token | null = null;

    for (const token of activeTokens) {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;
      
      const dx = worldX - token.x;
      const dy = worldY - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= token.radius) {
        foundToken = token;
        break;
      }
    }

    setHoveredToken(foundToken);
    setMousePos(foundToken ? { x: mouseX, y: mouseY } : null);
  }, [tokens, transform]);

  const handleMouseLeave = useCallback(() => {
    setHoveredToken(null);
    setMousePos(null);
  }, []);

  return (
    <div className="player-view-container">
      <canvas 
        ref={canvasRef} 
        className="player-background-canvas" 
        onMouseMove={handleMouseMove}
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
