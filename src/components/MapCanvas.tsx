import { useRef, useState, useEffect, useCallback } from 'react';
import './MapCanvas.css';
import type { Actor, Token, Prop } from '../types';
import TokenCreator from './TokenCreator';
import TokenCard from './TokenCard';
import PropCreator from './PropCreator';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface MapCanvasProps
{
  backgroundImage: string | null;
}

export default function MapCanvas({ backgroundImage }: MapCanvasProps)
{
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1, rotation: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedToken, setDraggedToken] = useState<string | null>(null);
  const [draggedProp, setDraggedProp] = useState<string | null>(null);
  const [draggedItemPosition, setDraggedItemPosition] = useState<{ id: string; x: number; y: number } | null>(null);
  const [revealedPath, setRevealedPath] = useState<Array<{ x: number; y: number }>>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [props, setProps] = useState<Prop[]>([]);

  const [showPropCreator, setShowPropCreator] = useState(false);
  const [editingProp, setEditingProp] = useState<Prop | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [fogEnabled, setFogEnabled] = useState<'on' | 'off-all' | 'off-gm'>('off-gm');
  const [fogRevealDistance, setFogRevealDistance] = useState(3);
  const [playerFogOpacity, setPlayerFogOpacity] = useState(1);
  const [lightingCondition, setLightingCondition] = useState<'bright' | 'dim' | 'darkness'>('bright');
  const [showTokenCreator, setShowTokenCreator] = useState(false);
  const [pendingTokenPosition, setPendingTokenPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingToken, setEditingToken] = useState<Token | null>(null);
  const [gridColumns, setGridColumns] = useState(100);
  const [gridRows, setGridRows] = useState(100);
  const [showGrid, setShowGrid] = useState(true);
  const [draggedActorId, setDraggedActorId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ tokenId: string; field: 'initiative' | 'hp' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [currentActorId, setCurrentActorId] = useState<string | null>(null);
  const [fogRevealRect, setFogRevealRect] = useState<{ start: { x: number; y: number } | null; end: { x: number; y: number } | null }>({ start: null, end: null });
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [hoveredProp, setHoveredProp] = useState<string | null>(null);
  const [scalingProp, setScalingProp] = useState<{ id: string; startX: number; startY: number; startRadius: number } | null>(null);
  const [rotatingProp, setRotatingProp] = useState<{ id: string; centerX: number; centerY: number; startAngle: number; startRotation: number } | null>(null);
  const [showObserverCards, setShowObserverCards] = useState(true);
  const [tokensCollapsed, setTokensCollapsed] = useState(false);
  const [propsCollapsed, setPropsCollapsed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const tokenImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const currentMapFilename = useRef<string | null>(null);
  const isLoadingMapMetadata = useRef<boolean>(false);
  const skipNextSync = useRef<boolean>(false);
  const hoverTimeoutRef = useRef<number | null>(null);
  const justFinishedDragOperation = useRef<boolean>(false);
  const hasLoadedInitialState = useRef<boolean>(false);

  // Refs to track current drag state (fixes stale closure in event handlers)
  const draggedTokenRef = useRef<string | null>(null);
  const draggedPropRef = useRef<string | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  // Sync game state to backend on changes
  useEffect(() =>
  {
    if (!backgroundImage) return; // Don't sync if no map loaded
    if (isLoadingMapMetadata.current) return; // Don't sync while loading
    if (!hasLoadedInitialState.current) return; // Don't sync until initial state is loaded
    if (skipNextSync.current)
    {
      skipNextSync.current = false;
      return; // Skip this sync (token update came from poll)
    }

    // Debounce the sync to avoid spamming the server
    const timeoutId = setTimeout(() =>
    {
      const syncToBackend = async () =>
      {
        const filename = backgroundImage.split('/').pop();
        const state = {
          currentMapFilename: filename,
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
          currentActorId,
          showObserverCards,
          imageDimensions: imageRef.current ? {
            width: imageRef.current.width,
            height: imageRef.current.height
          } : null,
        };

        try
        {
          await fetch(`${API_URL}/api/game-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state })
          });
        } catch (error)
        {
          console.error('Failed to sync game state:', error);
        }
      };

      syncToBackend();
    }, 500); // Wait 500ms before syncing

    return () => clearTimeout(timeoutId);
  }, [backgroundImage, tokens, props, transform, fogEnabled, fogRevealDistance, playerFogOpacity, lightingCondition, revealedPath, gridColumns, gridRows, showGrid, imageLoaded, currentActorId, showObserverCards]);

  // Poll backend for changes from players (new tokens or activation changes)
  useEffect(() =>
  {
    const pollGameState = async () =>
    {
      try
      {
        const response = await fetch(`${API_URL}/api/game-state`);
        if (response.ok)
        {
          const data = await response.json();
          const { state } = data;

          // Update session active state
          if (data.sessionActive !== undefined)
          {
            setIsSessionActive(data.sessionActive);
          }

          // Only update if token count changed or new token IDs appeared (player joined)
          // OR if any token's active state changed (but not while dragging tokens)
          if (state && state.tokens && !draggedTokenRef.current)
          {
            const currentIds = new Set(tokens.map(t => t.id));

            // Check if there are new tokens in backend that we don't have
            const hasNewTokens = state.tokens.some((t: Token) => !currentIds.has(t.id));

            // Check if any token's active state changed
            const activeStateChanged = state.tokens.some((backendToken: Token) =>
            {
              const localToken = tokens.find(t => t.id === backendToken.id);
              return localToken && localToken.active !== backendToken.active;
            });

            if (hasNewTokens || state.tokens.length !== tokens.length || activeStateChanged)
            {
              // Token changes detected, update local state
              skipNextSync.current = true; // Don't sync back the change we just received
              setTokens(state.tokens);
            }

            // Always sync currentActorId from backend to keep it consistent
            if (state.currentActorId !== undefined && state.currentActorId !== currentActorId)
            {
              skipNextSync.current = true;
              setCurrentActorId(state.currentActorId);
            }
            
            // Always sync showObserverCards from backend to keep it consistent
            if (state.showObserverCards !== undefined && state.showObserverCards !== showObserverCards)
            {
              skipNextSync.current = true;
              setShowObserverCards(state.showObserverCards);
            }
          }

          // Sync props from backend (but not while dragging)
          if (state && state.props && !draggedPropRef.current)
          {
            const currentPropIds = new Set(props.map(p => p.id));
            const hasNewProps = state.props.some((p: Prop) => !currentPropIds.has(p.id));



            if (hasNewProps || state.props.length !== props.length)
            {
              skipNextSync.current = true;
              setProps(state.props);
            }
          }
        }
      } catch (error)
      {
        console.error('Failed to poll game state:', error);
      }
    };

    const interval = setInterval(pollGameState, 1000);
    return () => clearInterval(interval);
  }, [tokens, props, currentActorId, showObserverCards]);

  // Load map from backend when background image changes
  useEffect(() =>
  {
    if (!backgroundImage) return;

    // Extract filename from URL
    const filename = backgroundImage.split('/').pop();
    if (!filename) return;

    // Always reload if filename changed, or if we don't have a current filename
    const shouldLoad = !currentMapFilename.current || filename !== currentMapFilename.current;

    if (!shouldLoad) return;

    currentMapFilename.current = filename;
    isLoadingMapMetadata.current = true;

    // Tell backend to load this map
    fetch(`${API_URL}/api/load-map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
      .then(res => res.json())
      .then(data =>
      {
        console.log('Backend loaded map:', data);
        if (data.state)
        {
          // Apply state from backend
          setGridColumns(data.state.gridColumns);
          setGridRows(data.state.gridRows);
          setLightingCondition(data.state.lightingCondition);
          setFogEnabled(data.state.fogEnabled);
          setFogRevealDistance(data.state.fogRevealDistance);
          setShowGrid(data.state.showGrid);
          setTokens(data.state.tokens);
          setProps(data.state.props || []);
          setRevealedPath(data.state.revealedPath);
          if (data.state.showObserverCards !== undefined)
          {
            setShowObserverCards(data.state.showObserverCards);
          }
          
          hasLoadedInitialState.current = true;

          console.log('Loaded', data.state.tokens.length, 'tokens from backend');

          // Clear token images cache
          tokenImagesRef.current.clear();

          setTimeout(() =>
          {
            setImageLoaded(prev => !prev);
            isLoadingMapMetadata.current = false;
          }, 500);
        }
      })
      .catch(err =>
      {
        console.error('Failed to load map from backend:', err);
        isLoadingMapMetadata.current = false;
      });

    // Cleanup: reset the current filename ref when component unmounts
    return () =>
    {
      currentMapFilename.current = null;
    };
  }, [backgroundImage]);

  // Auto-position new player character tokens near party_start prop
  useEffect(() => {
    // Only auto-position in session mode
    if (!isSessionActive) {
      console.log('Auto-positioning skipped: not in session mode');
      return;
    }
    
    // Find tokens without positions (player characters only, and must be active)
    const unpositionedTokens = tokens.filter(t => 
      t.actor?.player && 
      t.active && 
      (t.x === undefined || t.y === undefined || t.x === null || t.y === null)
    );
    
    console.log('Auto-positioning check:', {
      isSessionActive,
      totalTokens: tokens.length,
      playerTokens: tokens.filter(t => t.actor?.player).length,
      activePlayerTokens: tokens.filter(t => t.actor?.player && t.active).length,
      unpositionedTokens: unpositionedTokens.length,
      unpositionedIds: unpositionedTokens.map(t => t.id)
    });
    
    if (unpositionedTokens.length === 0) return;
    
    // Find the party_start prop
    const partyStartProp = props.find(p => 
      p.name?.toLowerCase() === 'party_start'
    );
    
    console.log('Party start prop search:', {
      totalProps: props.length,
      propNames: props.map(p => p.name),
      foundPartyStart: !!partyStartProp,
      partyStartPosition: partyStartProp ? { x: partyStartProp.x, y: partyStartProp.y } : null
    });
    
    if (!partyStartProp || partyStartProp.x === undefined || partyStartProp.y === undefined) {
      console.log('⚠️ No party_start prop found or it has no position. Create a prop named "party_start" to enable auto-positioning.');
      return; // No party_start prop, let tokens be positioned manually
    }
    
    console.log('Found party_start at', partyStartProp.x, partyStartProp.y);
    console.log('Unpositioned tokens:', unpositionedTokens.length);
    
    // Track positions as we assign them
    const assignedPositions = new Set<string>();
    
    // Helper function to check if a grid position is occupied
    const isOccupied = (x: number, y: number) => {
      const posKey = `${x},${y}`;
      if (assignedPositions.has(posKey)) return true;
      
      return tokens.some(t => 
        t.x === x && t.y === y && t.x !== undefined && t.y !== undefined
      );
    };
    
    // Helper function to find nearest unoccupied grid square
    const findNearestUnoccupied = (startX: number, startY: number): { x: number, y: number } => {
      // Start from the party_start position
      if (!isOccupied(startX, startY)) {
        return { x: startX, y: startY };
      }
      
      // Search in expanding squares around the start position
      for (let radius = 1; radius <= 10; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            // Only check positions on the edge of the current radius square
            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
              const x = startX + dx;
              const y = startY + dy;
              
              // Check if within grid bounds
              if (x >= 0 && x < gridColumns && y >= 0 && y < gridRows) {
                if (!isOccupied(x, y)) {
                  return { x, y };
                }
              }
            }
          }
        }
      }
      
      // Fallback to party_start position if no free space found
      return { x: startX, y: startY };
    };
    
    // Position each unpositioned token
    const updatedTokens = [...tokens];
    let hasChanges = false;
    
    unpositionedTokens.forEach(token => {
      const position = findNearestUnoccupied(partyStartProp.x!, partyStartProp.y!);
      const tokenIndex = updatedTokens.findIndex(t => t.id === token.id);
      
      if (tokenIndex !== -1) {
        updatedTokens[tokenIndex] = {
          ...updatedTokens[tokenIndex],
          x: position.x,
          y: position.y
        };
        assignedPositions.add(`${position.x},${position.y}`);
        console.log(`Positioned token ${token.actor?.name || token.id} at (${position.x}, ${position.y})`);
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      setTokens(updatedTokens);
    }
  }, [tokens, props, gridColumns, gridRows, isSessionActive]);

  // Load background image
  useEffect(() =>
  {
    console.log('MapCanvas received backgroundImage:', backgroundImage);
    if (backgroundImage)
    {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Enable CORS
      img.onload = () =>
      {
        console.log('✅ Image loaded successfully, size:', img.width, 'x', img.height);
        imageRef.current = img;
        console.log('imageRef.current set to:', imageRef.current);

        setImageLoaded(prev => !prev); // Toggle to force re-render

        // Force immediate redraw
        setTimeout(() =>
        {
          console.log('Force redraw after image load');
          const canvas = canvasRef.current;
          if (canvas && imageRef.current)
          {
            const ctx = canvas.getContext('2d');
            if (ctx)
            {
              ctx.fillStyle = '#00ff00'; // Green to show this code ran
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(imageRef.current, 0, 0);
              console.log('✅✅✅ Image drawn in immediate callback');
            }
          }
        }, 100);
      };
      img.onerror = (error) =>
      {
        console.error('❌ Image failed to load:', error);
        console.error('Attempted URL:', backgroundImage);
      };
      console.log('Setting img.src to:', backgroundImage);
      img.src = backgroundImage;
    }
  }, [backgroundImage]);

  // Load token images
  useEffect(() =>
  {
    tokens.forEach(token =>
    {
      if (token.imageUrl && !tokenImagesRef.current.has(token.id))
      {
        const img = new Image();
        img.onload = () =>
        {
          tokenImagesRef.current.set(token.id, img);
          // Trigger re-render by updating imageLoaded state
          setImageLoaded(prev => !prev);
        };
        img.onerror = (e) =>
        {
          console.error('Failed to load token image:', token.imageUrl, e);
        };
        // Prepend API_URL if the image URL is relative
        img.src = token.imageUrl.startsWith('http') ? token.imageUrl : `${API_URL}${token.imageUrl}`;
      }
    });
  }, [tokens]);

  // Load prop images
  useEffect(() =>
  {
    props.forEach(prop =>
    {
      if (prop.imageUrl && !tokenImagesRef.current.has(prop.id))
      {
        const img = new Image();
        img.onload = () =>
        {
          tokenImagesRef.current.set(prop.id, img);
          // Trigger re-render by updating imageLoaded state
          setImageLoaded(prev => !prev);
        };
        img.onerror = (e) =>
        {
          console.error('Failed to load prop image:', prop.imageUrl, e);
        };
        // Prepend API_URL if the image URL is relative
        img.src = prop.imageUrl.startsWith('http') ? prop.imageUrl : `${API_URL}${prop.imageUrl}`;
      }
    });
  }, [props]);

  // Set canvas dimensions to match CSS size
  useEffect(() =>
  {
    const canvas = canvasRef.current;
    const fogCanvas = fogCanvasRef.current;

    if (canvas && fogCanvas)
    {
      // Use a 16:9 aspect ratio at high resolution
      canvas.width = 1920;
      canvas.height = 1080;
      fogCanvas.width = 1920;
      fogCanvas.height = 1080;
    }
  }, []);

  // Draw the main canvas with background image
  const drawCanvas = useCallback(() =>
  {
    const canvas = canvasRef.current;
    if (!canvas)
    {
      console.log('❌ Canvas ref is null');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx)
    {
      console.log('❌ Could not get canvas context');
      return;
    }

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
    if (imageRef.current)
    {
      const img = imageRef.current;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const x = (canvas.width - img.width * scale) / 2;
      const y = (canvas.height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    }

    // Restore context state
    ctx.restore();

    // Draw props (first, so tokens appear on top)

    props.forEach(prop =>
    {
      // Skip props without position/size
      if (prop.x === undefined || prop.y === undefined || !prop.radius) return;
      console.log('Drawing prop:', prop);
      console.log("window dragged prop:" + (window as any).draggedProp);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      console.log('Drawing dragged prop (ref):', draggedPropRef.current);
      console.log('draggedItemPosition:', draggedItemPosition);
      console.log('prop.id:', prop.id, 'prop.x:', prop.x, 'prop.y:', prop.y);

      // Use prop's actual position (updated during drag in pointer move)
      // Use live drag position if this prop is being dragged
      const propX = (draggedItemPosition?.id === prop.id) ? draggedItemPosition.x : prop.x;
      const propY = (draggedItemPosition?.id === prop.id) ? draggedItemPosition.y : prop.y;

      console.log('Using propX:', propX, 'propY:', propY);




      // Draw prop image if available (props with images show on all views)
      if (prop.imageUrl)
      {
        const propImg = tokenImagesRef.current.get(prop.id);
        if (propImg && propImg.complete)
        {
          ctx.save();
          
          // Apply rotation and scale if set
          ctx.translate(propX, propY);
          if (prop.rotation) {
            ctx.rotate((prop.rotation * Math.PI) / 180);
          }
          const propScale = prop.scale || 1;
          ctx.scale(propScale, propScale);
          
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
        }
      }
      else
      {
        // Draw circle background/border with rotation and scale
        ctx.save();
        ctx.translate(propX, propY);
        if (prop.rotation) {
          ctx.rotate((prop.rotation * Math.PI) / 180);
        }
        const propScale = prop.scale || 1;
        ctx.scale(propScale, propScale);
        
        ctx.beginPath();
        ctx.arc(0, 0, prop.radius, 0, Math.PI * 2);
        ctx.fillStyle = prop.color || 'rgba(102, 102, 102, 0.5)';
        ctx.fill();
        ctx.strokeStyle = prop.color ? prop.color.replace('0.5', '0.8') : 'rgba(80, 80, 80, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        console.log('Drawing fallback icon for prop:', prop, draggedItemPosition);
        // Draw a simple icon or fallback for props without images
        ctx.beginPath();
        ctx.arc(0, 0, prop.radius * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = prop.color || '#888';
        ctx.fill();
        ctx.font = `${Math.floor(prop.radius)}px serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', 0, 0);
        ctx.restore();
      }

      ctx.restore();
    });

    // Draw tokens (on top of props)
    tokens.forEach(token =>
    {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return;
      
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      // Apply opacity for inactive tokens
      if (!token.active)
      {
        ctx.globalAlpha = 0.4;
      }

      // Use live drag position if this token is being dragged
      const tokenX = (draggedItemPosition?.id === token.id) ? draggedItemPosition.x : token.x;
      const tokenY = (draggedItemPosition?.id === token.id) ? draggedItemPosition.y : token.y;

      // Draw circle background/border
      ctx.beginPath();
      ctx.arc(tokenX, tokenY, token.radius, 0, Math.PI * 2);
      ctx.fillStyle = token.color || 'rgba(0, 100, 255, 0.5)';
      ctx.fill();
      ctx.strokeStyle = token.color ? token.color.replace('0.5', '0.8') : 'rgba(0, 50, 200, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Add gold highlight if this is the current actor
      if (token.id === currentActorId)
      {

        ctx.beginPath();
        ctx.arc(tokenX, tokenY, token.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'gold';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (token.actor?.player)
      {
        // Add blue highlight for player characters (when not their turn)
        ctx.beginPath();
        ctx.arc(tokenX, tokenY, token.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#4da6ff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw token image if available
      if (token.imageUrl)
      {
        const tokenImg = tokenImagesRef.current.get(token.id);
        if (tokenImg && tokenImg.complete)
        {
          ctx.save();
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
    if (showGrid && imageRef.current && gridColumns > 0 && gridRows > 0)
    {
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
      for (let i = 0; i <= gridColumns; i++)
      {
        const x = startX + (i * cellWidth);
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, startY + imgHeight);
        ctx.stroke();
      }

      // Draw horizontal lines
      for (let i = 0; i <= gridRows; i++)
      {
        const y = startY + (i * cellHeight);
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + imgWidth, y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [transform, tokens, props, imageLoaded, showGrid, gridColumns, gridRows, currentActorId]);

  // Draw fog of war
  const drawFog = useCallback(() =>
  {
    const canvas = fogCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Determine if fog should be drawn for GM view
    // Always draw fog if 'on' or 'off-gm', only skip if 'off-all' (unless lighting forces it)
    const shouldDrawFog = (fogEnabled !== 'off-all' || lightingCondition === 'dim' || lightingCondition === 'darkness');
    if (!shouldDrawFog) return;

    // Adjust fog opacity based on lighting condition and GM view mode
    let fogOpacity = 1;
    if (lightingCondition === 'dim')
    {
      fogOpacity = 0.6; // Dim light - partial obscurement
    } else if (lightingCondition === 'darkness')
    {
      fogOpacity = 1; // Complete darkness
    }

    // For GM view with 'off-gm', reduce fog opacity to see through it
    if (fogEnabled === 'off-gm')
    {
      fogOpacity = 0.75; // 50% opacity so GM can see through fog
    }

    // Fill entire canvas with fog
    ctx.fillStyle = `rgba(0, 0, 0, ${fogOpacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate grid cell size in pixels for fog reveal radius
    let gridCellSize = 20; // Default fallback
    if (imageRef.current && gridColumns > 0 && gridRows > 0)
    {
      const img = imageRef.current;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const imgWidth = img.width * scale;
      const imgHeight = img.height * scale;
      const cellWidth = imgWidth / gridColumns;
      const cellHeight = imgHeight / gridRows;
      // Use average of width and height for square-ish cells
      gridCellSize = (cellWidth + cellHeight) / 2;
    }

    // Only clear fog around active player tokens if there are light sources
    const activePlayerTokens = tokens.filter(token => token.active && token.actor?.player === true);
    if (activePlayerTokens.length > 0 || revealedPath.length > 0)
    {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';

      // Reveal fog along the path tokens have traveled
      if (revealedPath.length > 0)
      {
        let effectiveRevealDistance = fogRevealDistance;
        if (lightingCondition === 'darkness')
        {
          effectiveRevealDistance = fogRevealDistance * 0.5;
        }

        revealedPath.forEach(point =>
        {
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

      activePlayerTokens.forEach(token =>
      {
        // Skip tokens without positions
        if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return;
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scale, transform.scale);
        ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

        // Adjust reveal distance based on lighting condition
        let effectiveRevealDistance = fogRevealDistance;
        if (lightingCondition === 'darkness')
        {
          effectiveRevealDistance = fogRevealDistance * 0.5; // Reduce visibility in darkness
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

    // Draw fog reveal rectangle preview
    if (fogRevealRect.start && fogRevealRect.end)
    {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-canvas.width / 2 + transform.x, -canvas.height / 2 + transform.y);

      ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        fogRevealRect.start.x,
        fogRevealRect.start.y,
        fogRevealRect.end.x - fogRevealRect.start.x,
        fogRevealRect.end.y - fogRevealRect.start.y
      );
      ctx.setLineDash([]);

      ctx.restore();
    }
  }, [tokens, props, draggedItemPosition, transform, fogEnabled, fogRevealDistance, lightingCondition, gridColumns, gridRows, fogRevealRect, currentActorId]);

  // Redraw when transform or tokens change
  useEffect(() =>
  {
    console.log('useEffect redraw triggered');
    drawCanvas();
    drawFog();
  }, [drawCanvas, drawFog]);

  // Handle global mouse move/up for scaling and rotating
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (scalingProp) {
        const dx = e.clientX - scalingProp.startX;
        const dy = e.clientY - scalingProp.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const newScale = Math.max(0.5, Math.min(3, 1 + distance / 100));
        
        setProps(prev => prev.map(p =>
          p.id === scalingProp.id ? { ...p, scale: newScale } : p
        ));
      }
      
      if (rotatingProp) {
        const dx = e.clientX - rotatingProp.centerX;
        const dy = e.clientY - rotatingProp.centerY;
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const angleDiff = currentAngle - rotatingProp.startAngle;
        const newRotation = (rotatingProp.startRotation + angleDiff) % 360;
        
        setProps(prev => prev.map(p =>
          p.id === rotatingProp.id ? { ...p, rotation: newRotation } : p
        ));
      }
    };

    const handleGlobalMouseUp = () => {
      if (scalingProp) {
        setScalingProp(null);
        justFinishedDragOperation.current = true;
        setTimeout(() => { justFinishedDragOperation.current = false; }, 10);
        // Clear all drag states
        isDraggingRef.current = false;
        draggedTokenRef.current = null;
        draggedPropRef.current = null;
        // Release pointer capture if canvas has it
        if (canvasRef.current && (canvasRef.current as any).hasPointerCapture) {
          try {
            canvasRef.current.releasePointerCapture(1);
          } catch (e) {
            // Ignore if pointer capture wasn't set
          }
        }
      }
      if (rotatingProp) {
        setRotatingProp(null);
        justFinishedDragOperation.current = true;
        setTimeout(() => { justFinishedDragOperation.current = false; }, 10);
        // Clear all drag states
        isDraggingRef.current = false;
        draggedTokenRef.current = null;
        draggedPropRef.current = null;
        // Release pointer capture if canvas has it
        if (canvasRef.current && (canvasRef.current as any).hasPointerCapture) {
          try {
            canvasRef.current.releasePointerCapture(1);
          } catch (e) {
            // Ignore if pointer capture wasn't set
          }
        }
      }
    };

    if (scalingProp || rotatingProp) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [scalingProp, rotatingProp]);

  // Update token radii and positions when grid changes
  useEffect(() =>
  {
    if (tokens.length > 0)
    {
      const newRadius = getTokenRadius();
      setTokens(prev => prev.map(token =>
      {
        // Skip repositioning tokens without positions
        if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) {
          return { ...token, radius: newRadius };
        }
        
        const snappedPos = snapToGrid(token.x, token.y);
        return {
          ...token,
          x: snappedPos.x,
          y: snappedPos.y,
          radius: newRadius
        };
      }));
    }
  }, [gridColumns, gridRows]);

  // Add wheel event listener with passive: false to allow preventDefault
  useEffect(() =>
  {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const wheelHandler = (e: WheelEvent) =>
    {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform(prev =>
      {
        const newScale = Math.max(0.1, Math.min(5, prev.scale * delta));

        // Apply bounds after zooming
        if (!canvasRef.current || !imageRef.current)
        {
          return { ...prev, scale: newScale };
        }

        const canvas = canvasRef.current;
        const img = imageRef.current;
        const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const imgWidth = img.width * baseScale;
        const imgHeight = img.height * baseScale;
        const scaledWidth = imgWidth * newScale;
        const scaledHeight = imgHeight * newScale;

        let newX = prev.x;
        let newY = prev.y;

        const maxX = Math.max(0, (scaledWidth - canvas.width) / 2);
        const maxY = Math.max(0, (scaledHeight - canvas.height) / 2);

        newX = Math.max(-maxX, Math.min(maxX, newX));
        newY = Math.max(-maxY, Math.min(maxY, newY));

        return { ...prev, x: newX, y: newY, scale: newScale };
      });
    };

    wrapper.addEventListener('wheel', wheelHandler, { passive: false });
    return () => wrapper.removeEventListener('wheel', wheelHandler);
  }, []);

  // Helper function to convert screen coordinates to canvas coordinates
  const screenToCanvas = (screenX: number, screenY: number) =>
  {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;

    // Account for canvas internal dimensions vs display dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = x * scaleX;
    const canvasY = y * scaleY;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Reverse the transformations applied in drawCanvas
    // 1. Translate back from pan offset
    let transformedX = canvasX - centerX;
    let transformedY = canvasY - centerY;

    // 2. Reverse rotation
    const angle = -(transform.rotation * Math.PI) / 180;
    const rotatedX = transformedX * Math.cos(angle) - transformedY * Math.sin(angle);
    const rotatedY = transformedX * Math.sin(angle) + transformedY * Math.cos(angle);

    // 3. Reverse scale
    const scaledX = rotatedX / transform.scale;
    const scaledY = rotatedY / transform.scale;

    // 4. Reverse pan translation
    const finalX = scaledX - transform.x + centerX;
    const finalY = scaledY - transform.y + centerY;

    return {
      x: finalX,
      y: finalY
    };
  };

  // Check if click is on a token
  const findTokenAtPosition = (canvasX: number, canvasY: number): Token | null =>
  {
    for (let i = tokens.length - 1; i >= 0; i--)
    {
      const token = tokens[i];
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) continue;
      
      const dx = canvasX - token.x;
      const dy = canvasY - token.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Increase hit area slightly for easier clicking
      if (distance <= token.radius * 1.5)
      {
        return token;
      }
    }
    return null;
  };

  // Check if click is on a prop (without image)
  const findPropAtPosition = (canvasX: number, canvasY: number): Prop | null =>
  {
    for (let i = props.length - 1; i >= 0; i--)
    {
      const prop = props[i];
      if (prop.x !== undefined && prop.y !== undefined && prop.radius)
      {
        const dx = canvasX - prop.x;
        const dy = canvasY - prop.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= prop.radius * 1.5)
        {
          return prop;
        }
      }
    }
    return null;
  };

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = (canvasX: number, canvasY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Apply transformations
    let x = canvasX - centerX;
    let y = canvasY - centerY;

    // Apply pan translation
    x += transform.x;
    y += transform.y;

    // Apply scale
    x *= transform.scale;
    y *= transform.scale;

    // Apply rotation
    const angle = (transform.rotation * Math.PI) / 180;
    const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
    const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);

    // Translate to center
    x = rotatedX + centerX;
    y = rotatedY + centerY;

    // Convert canvas pixels to screen pixels
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY
    };
  };

  // Start rotating prop
  const startRotatingProp = (propId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const prop = props.find(p => p.id === propId);
    if (prop) {
      const screenPos = canvasToScreen(prop.x, prop.y);
      const dx = e.clientX - screenPos.x;
      const dy = e.clientY - screenPos.y;
      const startAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      
      setHoveredProp(null); // Clear hover to hide controls during rotation
      setRotatingProp({
        id: propId,
        centerX: screenPos.x,
        centerY: screenPos.y,
        startAngle,
        startRotation: prop.rotation || 0
      });
    }
  };

  // Reset rotation
  const resetRotation = (propId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProps(prev => prev.map(p =>
      p.id === propId ? { ...p, rotation: 0 } : p
    ));
  };

  // Start scaling prop
  const startScalingProp = (propId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const prop = props.find(p => p.id === propId);
    if (prop) {
      setHoveredProp(null); // Clear hover to hide controls during scaling
      setScalingProp({
        id: propId,
        startX: e.clientX,
        startY: e.clientY,
        startRadius: prop.radius
      });
    }
  };

  // Reset scale
  const resetScale = (propId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProps(prev => prev.map(p =>
      p.id === propId ? { ...p, scale: 1 } : p
    ));
  };

  // Mouse drag for pan or token movement
  const handlePointerDown = (e: React.PointerEvent) =>
  {
    // Skip if we just finished a scale/rotate operation
    if (justFinishedDragOperation.current) {
      return;
    }
    
    if (e.button === 0)
    { // Left click
      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      // Check if shift is held for fog reveal rectangle
      if (e.shiftKey)
      {
        setFogRevealRect({ start: canvasPos, end: canvasPos });
        return;
      }

      const clickedToken = findTokenAtPosition(canvasPos.x, canvasPos.y);
      const clickedProp = !clickedToken ? findPropAtPosition(canvasPos.x, canvasPos.y) : null;

      console.log('Pointer down - clickedToken:', clickedToken?.id, 'clickedProp:', clickedProp?.id);

      if (clickedToken)
      {
        // Start dragging token
        console.log('Setting draggedToken to:', clickedToken.id);
        draggedTokenRef.current = clickedToken.id;
        setDraggedToken(clickedToken.id);
        console.log('draggedToken state (still old value):', draggedToken);
        // Capture pointer to prevent mouse from leaving canvas
        if (canvasRef.current)
        {
          canvasRef.current.setPointerCapture(e.pointerId);
        }
      } else if (clickedProp)
      {
        // Start dragging prop
        console.log('Setting draggedProp to:', clickedProp.id);
        (window as any).draggedProp = clickedProp.id; // For debugging (TypeScript-safe)
        draggedPropRef.current = clickedProp.id;
        setDraggedProp(clickedProp.id);
        console.log('draggedProp state (still old value):', draggedProp);
        if (canvasRef.current)
        {
          canvasRef.current.setPointerCapture(e.pointerId);
        }
      } else
      {
        // Start panning canvas
        isDraggingRef.current = true;
        setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
        // Capture pointer to prevent mouse from leaving canvas
        if (canvasRef.current)
        {
          canvasRef.current.setPointerCapture(e.pointerId);
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) =>
  {
    // Skip if scaling or rotating (handled by global mouse move)
    if (scalingProp || rotatingProp) {
      return;
    }
    
    // Handle fog reveal rectangle dragging
    if (fogRevealRect.start)
    {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setFogRevealRect(prev => ({ ...prev, end: canvasPos }));
      return;
    }

    // Update hovered prop if not dragging
    if (!draggedTokenRef.current && !draggedPropRef.current && !isDraggingRef.current) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const hoveredPropObj = findPropAtPosition(canvasPos.x, canvasPos.y);
      
      if (hoveredPropObj) {
        // Clear any pending timeout when hovering over a prop
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        setHoveredProp(hoveredPropObj.id);
      } else if (hoveredProp) {
        // Mouse left the prop - start timeout to close controls
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredProp(null);
          hoverTimeoutRef.current = null;
        }, 300);
      }
    }

    if (draggedTokenRef.current)
    {
      // Move the token
      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      // Snap to grid
      const snappedPos = snapToGrid(canvasPos.x, canvasPos.y);

      // Find current token position
      const currentToken = tokens.find(t => t.id === draggedTokenRef.current);
      if (!currentToken || currentToken.x === undefined || currentToken.y === undefined || currentToken.x === null || currentToken.y === null) return;

      // Calculate grid distance from current position
      const distance = getGridDistance(currentToken.x, currentToken.y, snappedPos.x, snappedPos.y);

      // Only allow movement of exactly 1 grid square
      if (distance !== 1)
      {
        return; // Don't move if distance is not exactly 1
      }

      // Check if position is occupied by another token
      if (isPositionOccupied(snappedPos.x, snappedPos.y, draggedTokenRef.current))
      {
        return; // Don't move to occupied position
      }

      setTokens(prev => prev.map(token =>
      {
        if (token.id === draggedTokenRef.current)
        {
          // Only add to revealed path if this is an active player token
          if (token.active && token.actor?.player === true)
          {
            setRevealedPath(path => [...path, { x: snappedPos.x, y: snappedPos.y }]);
          }
          return { ...token, x: snappedPos.x, y: snappedPos.y };
        }
        return token;
      }));
      console.log('Setting draggedToken draggedItemPosition to:', { id: draggedTokenRef.current, x: snappedPos.x, y: snappedPos.y });

      // Update live drag position for immediate visual feedback
      setDraggedItemPosition({ id: draggedTokenRef.current, x: snappedPos.x, y: snappedPos.y });
    } else if (draggedPropRef.current)
    {
      console.log('In draggedProp block! draggedProp =', draggedPropRef.current);
      // Move the prop (props move freely, not snapped to grid)
      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      // Update live drag position FIRST for immediate visual feedback
      setDraggedItemPosition({ id: draggedPropRef.current, x: canvasPos.x, y: canvasPos.y });

      // Update prop position in state
      setProps(prev => prev.map(prop =>
      {
        if (prop.id === draggedPropRef.current)
        {
          return { ...prop, x: canvasPos.x, y: canvasPos.y };
        }
        return prop;
      }));
    } else if (isDraggingRef.current)
    {
      // Pan the canvas with bounds to prevent black space
      const canvas = canvasRef.current;
      const img = imageRef.current;

      if (!canvas || !img)
      {
        setTransform(prev => ({
          ...prev,
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y
        }));
        return;
      }

      // Calculate scaled image dimensions
      const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const imgWidth = img.width * baseScale;
      const imgHeight = img.height * baseScale;
      const scaledWidth = imgWidth * transform.scale;
      const scaledHeight = imgHeight * transform.scale;

      let newX = e.clientX - dragStart.x;
      let newY = e.clientY - dragStart.y;

      // Image left edge in screen space = canvas.width/2 - scaledWidth/2 + transform.x
      // For no black on left: canvas.width/2 - scaledWidth/2 + transform.x <= 0
      // transform.x <= scaledWidth/2 - canvas.width/2

      // Image right edge in screen space = canvas.width/2 + scaledWidth/2 + transform.x
      // For no black on right: canvas.width/2 + scaledWidth/2 + transform.x >= canvas.width
      // transform.x >= canvas.width/2 - scaledWidth/2

      if (scaledWidth > canvas.width)
      {
        const maxX = (scaledWidth - canvas.width) / 2;
        const minX = (canvas.width - scaledWidth) / 2;
        newX = Math.max(minX, Math.min(maxX, newX));
      } else
      {
        newX = 0;
      }

      if (scaledHeight > canvas.height)
      {
        const maxY = (scaledHeight - canvas.height) / 2;
        const minY = (canvas.height - scaledHeight) / 2;
        newY = Math.max(minY, Math.min(maxY, newY));
      } else
      {
        newY = 0;
      }

      setTransform(prev => ({
        ...prev,
        x: newX,
        y: newY
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) =>
  {
    // Stop scaling or rotating if active
    if (scalingProp) {
      setScalingProp(null);
      return;
    }
    if (rotatingProp) {
      setRotatingProp(null);
      return;
    }

    // Release pointer capture
    if (canvasRef.current)
    {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }

    // Finalize fog reveal rectangle
    if (fogRevealRect.start && fogRevealRect.end)
    {
      const minX = Math.min(fogRevealRect.start.x, fogRevealRect.end.x);
      const maxX = Math.max(fogRevealRect.start.x, fogRevealRect.end.x);
      const minY = Math.min(fogRevealRect.start.y, fogRevealRect.end.y);
      const maxY = Math.max(fogRevealRect.start.y, fogRevealRect.end.y);

      // Add points within the rectangle to revealed path
      const newPoints: Array<{ x: number; y: number }> = [];
      const step = 20; // Grid spacing for revealed points

      for (let x = minX; x <= maxX; x += step)
      {
        for (let y = minY; y <= maxY; y += step)
        {
          newPoints.push({ x, y });
        }
      }

      setRevealedPath(prev => [...prev, ...newPoints]);
      setFogRevealRect({ start: null, end: null });
      return;
    }

    isDraggingRef.current = false;
    draggedTokenRef.current = null;
    draggedPropRef.current = null;

    setDraggedToken(null);
    setDraggedProp(null);
    (window as any).draggedProp = null;
    setDraggedItemPosition(null);
  };

  const handlePointerLeave = (e: React.PointerEvent) =>
  {
    // Only release if we're not dragging
    if (!isDraggingRef.current && !draggedTokenRef.current && !draggedPropRef.current && canvasRef.current)
    {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
  };

  // Helper function to calculate token radius based on grid
  const getTokenRadius = (): number =>
  {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0)
    {
      return 20; // Default fallback
    }

    const canvas = canvasRef.current;
    const img = imageRef.current;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const imgWidth = img.width * scale;
    const imgHeight = img.height * scale;
    const cellWidth = imgWidth / gridColumns;
    const cellHeight = imgHeight / gridRows;
    const gridCellSize = (cellWidth + cellHeight) / 2;
    return (gridCellSize / 2) * 0.9; // Radius is half the cell size, with 10% padding
  };

  // Helper function to snap coordinates to grid
  const snapToGrid = (x: number, y: number): { x: number; y: number } =>
  {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0)
    {
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

    // Find the grid cell
    const gridX = Math.floor(relX / cellWidth);
    const gridY = Math.floor(relY / cellHeight);

    // Snap to center of grid cell
    const snappedX = offsetX + (gridX + 0.5) * cellWidth;
    const snappedY = offsetY + (gridY + 0.5) * cellHeight;

    return { x: snappedX, y: snappedY };
  };

  // Check if a position is occupied by another token
  const isPositionOccupied = (x: number, y: number, excludeTokenId?: string): boolean =>
  {
    return tokens.some(token =>
    {
      // Skip tokens without positions
      if (token.x === undefined || token.y === undefined || token.x === null || token.y === null) return false;
      
      if (excludeTokenId && token.id === excludeTokenId)
      {
        return false;
      }
      // Check if positions are the same (with small tolerance for floating point comparison)
      const dx = Math.abs(token.x - x);
      const dy = Math.abs(token.y - y);
      return dx < 1 && dy < 1;
    });
  };

  // Calculate grid distance between two positions
  const getGridDistance = (x1: number, y1: number, x2: number, y2: number): number =>
  {
    if (!canvasRef.current || !imageRef.current || gridColumns <= 0 || gridRows <= 0)
    {
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
  };

  // Update existing token
  const updateToken = async (tokenId: string, actor: Actor, imageFile: File | null, color: string, actorUrl?: string) =>
  {
    let imageUrl = actorUrl;

    if (imageFile)
    {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('folder', 'actors');
      formData.append('name', `token-${Date.now()}`);

      try
      {
        const response = await fetch(`${API_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        imageUrl = data.url;
      } catch (error)
      {
        console.error('Failed to upload image:', error);
      }
    }

    setTokens(prev => prev.map(token =>
      token.id === tokenId
        ? {
          ...token,
          color,
          imageUrl,
          actor,
        }
        : token
    ));

    setShowTokenCreator(false);
    setEditingToken(null);
  };

  // Handle drag and drop reordering
  const handleDragStart = (e: React.DragEvent, tokenId: string) =>
  {
    setDraggedActorId(tokenId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tokenId);
  };

  const handleDragEnter = (e: React.DragEvent) =>
  {
    e.preventDefault();
  };

  const handleDragOver = (e: React.DragEvent) =>
  {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnd = () =>
  {
    setDraggedActorId(null);
  };

  // Handle inline editing of initiative and HP
  const startEditing = (tokenId: string, field: 'initiative' | 'hp', currentValue: number) =>
  {
    setEditingField({ tokenId, field });
    setEditValue(currentValue.toString());
  };

  const saveEdit = () =>
  {
    if (!editingField) return;

    const newValue = parseInt(editValue);
    if (isNaN(newValue))
    {
      setEditingField(null);
      return;
    }

    setTokens(prev => prev.map(token =>
    {
      if (token.id === editingField.tokenId && token.actor)
      {
        return {
          ...token,
          actor: {
            ...token.actor,
            [editingField.field]: newValue
          }
        };
      }
      return token;
    }));

    setEditingField(null);
  };

  const cancelEdit = () =>
  {
    setEditingField(null);
    setEditValue('');
  };

  // Mark actor's turn as complete (set initiative to 0)
  const markTurnComplete = (tokenId: string) =>
  {
    setTokens(prev =>
    {
      const updated = prev.map(token =>
      {
        if (token.id === tokenId && token.actor && token.active)
        {
          // Set this actor's initiative to 0
          return {
            ...token,
            actor: {
              ...token.actor,
              initiative: 0
            }
          };
        } else if (token.actor && token.active)
        {
          // Increase all other active actors' initiative by 1
          return {
            ...token,
            actor: {
              ...token.actor,
              initiative: token.actor.initiative + 1
            }
          };
        }
        return token;
      });

      // Find next active actor with highest initiative
      const nextActor = updated
        .filter(t => t.actor && t.active && t.id !== tokenId)
        .sort((a, b) => (b.actor?.initiative || 0) - (a.actor?.initiative || 0))[0];

      if (nextActor)
      {
        setCurrentActorId(nextActor.id);
      }

      return updated;
    });
  };

  // Roll initiative for all actors and start encounter
  const beginEncounter = () =>
  {
    const updatedTokens = tokens.map(token =>
    {
      if (token.actor && token.active)
      {
        const roll = Math.floor(Math.random() * 21); // 0-20
        return {
          ...token,
          actor: {
            ...token.actor,
            initiative: roll
          }
        };
      }
      return token;
    });

    setTokens(updatedTokens);

    // Set current actor to the one with highest initiative (only active tokens)
    const highestInitiativeToken = updatedTokens
      .filter(t => t.actor && t.active)
      .sort((a, b) => (b.actor?.initiative || 0) - (a.actor?.initiative || 0))[0];

    if (highestInitiativeToken)
    {
      setCurrentActorId(highestInitiativeToken.id);
    }
  };

  // Automatically fix token radii when grid size changes
  useEffect(() =>
  {
    const correctRadius = getTokenRadius();
    setTokens(prev => prev.map(token => ({
      ...token,
      radius: correctRadius
    })));
  }, [gridColumns, gridRows]);

  // Delete a token
  const deleteToken = (tokenId: string) =>
  {
    if (confirm('Are you sure you want to delete this token?'))
    {
      setTokens(prev => prev.filter(token => token.id !== tokenId));
      if (currentActorId === tokenId)
      {
        setCurrentActorId(null);
      }
      // Clean up token image from ref
      tokenImagesRef.current.delete(tokenId);
    }
  };

  // End combat
  const endCombat = () =>
  {
    setCurrentActorId(null);
  };

  const handleDrop = (e: React.DragEvent, targetTokenId: string) =>
  {
    e.preventDefault();

    if (!draggedActorId || draggedActorId === targetTokenId)
    {
      setDraggedActorId(null);
      return;
    }

    const draggedToken = tokens.find(t => t.id === draggedActorId);
    const targetToken = tokens.find(t => t.id === targetTokenId);

    if (!draggedToken || !draggedToken.actor || !targetToken || !targetToken.actor)
    {
      setDraggedActorId(null);
      return;
    }

    const targetInitiative = targetToken.actor.initiative;
    const draggedInitiative = draggedToken.actor.initiative;

    // Update tokens
    const updatedTokens = tokens.map(token =>
    {
      if (token.id === draggedActorId)
      {
        // Set dragged token to target's initiative
        return {
          ...token,
          actor: {
            ...token.actor!,
            initiative: targetInitiative
          }
        };
      } else if (token.actor)
      {
        // If moving to higher initiative (down in sorted list), decrease initiatives in between
        if (draggedInitiative < targetInitiative &&
          token.actor.initiative > draggedInitiative &&
          token.actor.initiative <= targetInitiative)
        {
          return {
            ...token,
            actor: {
              ...token.actor,
              initiative: token.actor.initiative - 1
            }
          };
        }
        // If moving to lower initiative (up in sorted list), increase initiatives in between
        else if (draggedInitiative > targetInitiative &&
          token.actor.initiative >= targetInitiative &&
          token.actor.initiative < draggedInitiative)
        {
          return {
            ...token,
            actor: {
              ...token.actor,
              initiative: token.actor.initiative + 1
            }
          };
        }
      }
      return token;
    });

    setTokens(updatedTokens);
    setDraggedActorId(null);
  };

  // Double click to add token
  const createToken = (actor: Actor, imageFile: File | null, color: string, actorUrl?: string) =>
  {
    if (!pendingTokenPosition) return;

    // Snap token position to grid
    const snappedPos = snapToGrid(pendingTokenPosition.x, pendingTokenPosition.y);

    // Check if position is occupied
    if (isPositionOccupied(snappedPos.x, snappedPos.y))
    {
      alert('This position is already occupied by another token!');
      setShowTokenCreator(false);
      setPendingTokenPosition(null);
      return;
    }
    const newToken: Token = {
      id: Date.now().toString(),
      x: snappedPos.x,
      y: snappedPos.y,
      radius: getTokenRadius(),
      color,
      actor,
      active: false, // Default to inactive
    };

    // If using an existing actor URL, set it directly
    if (actorUrl)
    {
      newToken.imageUrl = actorUrl;

      // Load the image
      const img = new Image();
      img.onload = () =>
      {
        tokenImagesRef.current.set(newToken.id, img);
        setTokens(prev => [...prev, newToken]);
      };
      img.onerror = () =>
      {
        console.error('Failed to load actor image');
        setTokens(prev => [...prev, newToken]);
      };
      img.src = actorUrl;

      setShowTokenCreator(false);
      setPendingTokenPosition(null);
      return;
    }

    // If there's an image file, upload it first
    if (imageFile)
    {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('folder', 'actors');
      formData.append('name', `token-${newToken.id}-${imageFile.name}`);

      fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      })
        .then(res => res.json())
        .then(data =>
        {
          newToken.imageUrl = data.url;

          // Load the image
          const img = new Image();
          img.onload = () =>
          {
            tokenImagesRef.current.set(newToken.id, img);
            // Add token after image loads
            setTokens(prev => [...prev, newToken]);
          };
          img.onerror = () =>
          {
            console.error('Failed to load token image');
            // Add token without image on load error
            setTokens(prev => [...prev, newToken]);
          };
          if (newToken.imageUrl)
          {
            img.src = newToken.imageUrl;
          }
        })
        .catch(err =>
        {
          console.error('Failed to upload token image:', err);
          // Add token without image
          setTokens(prev => [...prev, newToken]);
        });
    } else
    {
      // No image, add token immediately
      setTokens(prev => [...prev, newToken]);
    }

    setShowTokenCreator(false);
    setPendingTokenPosition(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) =>
  {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Transform screen coordinates to canvas coordinates
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const transformedX = ((x - centerX) / transform.scale - transform.x) + centerX;
    const transformedY = ((y - centerY) / transform.scale - transform.y) + centerY;

    // Check if ctrl is held for prop creation
    if (e.ctrlKey)
    {
      // Show prop creator and store position for props without images
      setShowPropCreator(true);
    } else
    {
      // Store position and show token creator
      setPendingTokenPosition({ x: transformedX, y: transformedY });
      setShowTokenCreator(true);
    }
  };

  return (
    <div className="map-canvas-container">
      <div className="map-canvas-left-column">
        <div className="canvas-wrapper"
          ref={canvasWrapperRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}>
          <canvas ref={canvasRef} className="background-canvas" />
          <canvas ref={fogCanvasRef} className="fog-canvas" />
          
          {/* Prop hover controls */}
          {hoveredProp && props.find(p => p.id === hoveredProp) && (() => {
            const prop = props.find(p => p.id === hoveredProp)!;
            const screenPos = canvasToScreen(prop.x, prop.y);
            return (
              <div
                className="prop-controls"
                onPointerMove={(e) => {
                  e.stopPropagation();
                  // Clear the timeout when pointer is over controls
                  if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = null;
                  }
                }}
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  // Clear the timeout when mouse enters controls
                  if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = null;
                  }
                  setHoveredProp(prop.id);
                }}
                onMouseLeave={(e) => {
                  e.stopPropagation();
                  // Immediately hide when leaving controls
                  if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = null;
                  }
                  setHoveredProp(null);
                }}
                style={{
                  position: 'absolute',
                  left: `${screenPos.x}px`,
                  top: `${screenPos.y - prop.radius * transform.scale}px`,
                  transform: `translateX(-50%) translateY(-100%) scale(${transform.scale})`,
                  transformOrigin: 'bottom center',
                  display: 'flex',
                  gap: '4px',
                  background: 'rgba(0, 0, 0, 0.9)',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: '1px solid #888',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
                  pointerEvents: 'auto',
                  zIndex: 1000
                }}
              >
                <button
                  className="prop-control-btn"
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) {
                      clearTimeout(hoverTimeoutRef.current);
                      hoverTimeoutRef.current = null;
                    }
                  }}
                  onPointerDown={(e) => { e.stopPropagation(); startRotatingProp(prop.id, e); }}
                  title="Rotate (drag to rotate)"
                  style={{
                    background: rotatingProp?.id === prop.id ? '#666' : '#444',
                    border: '1px solid #666',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    cursor: 'grab',
                    fontSize: '14px'
                  }}
                >
                  ↻
                </button>
                <button
                  className="prop-control-btn"
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) {
                      clearTimeout(hoverTimeoutRef.current);
                      hoverTimeoutRef.current = null;
                    }
                  }}
                  onPointerDown={(e) => { e.stopPropagation(); resetRotation(prop.id, e); }}
                  title="Reset rotation"
                  style={{
                    background: '#333',
                    border: '1px solid #666',
                    color: '#888',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  ⟲
                </button>
                <button
                  className="prop-control-btn"
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) {
                      clearTimeout(hoverTimeoutRef.current);
                      hoverTimeoutRef.current = null;
                    }
                  }}
                  onPointerDown={(e) => { e.stopPropagation(); startScalingProp(prop.id, e); }}
                  title="Scale (drag to resize)"
                  style={{
                    background: scalingProp?.id === prop.id ? '#666' : '#444',
                    border: '1px solid #666',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    cursor: 'nwse-resize',
                    fontSize: '14px'
                  }}
                >
                  ⇲
                </button>
                <button
                  className="prop-control-btn"
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) {
                      clearTimeout(hoverTimeoutRef.current);
                      hoverTimeoutRef.current = null;
                    }
                  }}
                  onPointerDown={(e) => { e.stopPropagation(); resetScale(prop.id, e); }}
                  title="Reset scale"
                  style={{
                    background: '#333',
                    border: '1px solid #666',
                    color: '#888',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  1×
                </button>
              </div>
            );
          })()}
        </div>

        <div className="controls">
          <button onClick={() => setTransform(prev => ({ ...prev, rotation: prev.rotation - 15 }))}>
            ↶ Rotate Left
          </button>
          <button onClick={() => setTransform(prev => ({ ...prev, rotation: prev.rotation + 15 }))}>
            ↷ Rotate Right
          </button>
          <button onClick={() => setTransform({ x: 0, y: 0, scale: 1, rotation: 0 })}>
            Reset View
          </button>
          <button onClick={() => setTokens([])}>
            Clear Tokens
          </button>
          <button onClick={() => setRevealedPath([])}>
            Reset Fog
          </button>
          <div className="lighting-control">
            <label htmlFor="lighting-condition">Lighting:</label>
            <select
              id="lighting-condition"
              value={lightingCondition}
              onChange={(e) => setLightingCondition(e.target.value as 'bright' | 'dim' | 'darkness')}
            >
              <option value="bright">Bright Light</option>
              <option value="dim">Dim Light</option>
              <option value="darkness">Darkness</option>
            </select>
          </div>
          <div className="fog-control">
            <label htmlFor="fog-toggle">Fog of War:</label>
            <select
              id="fog-toggle"
              value={fogEnabled}
              onChange={(e) => setFogEnabled(e.target.value as 'on' | 'off-all' | 'off-gm')}
            >
              <option value="off-gm">Off (GM Only)</option>
              <option value="off-all">Off (All)</option>
              <option value="on">On</option>
            </select>
          </div>
          <div className="fog-slider">
            <label htmlFor="fog-reveal-distance">Vision Distance: {fogRevealDistance} squares</label>
            <input
              id="fog-reveal-distance"
              type="range"
              min="1"
              max="20"
              value={fogRevealDistance}
              onChange={(e) => setFogRevealDistance(parseInt(e.target.value))}
            />
          </div>
          <div className="fog-slider">
            <label htmlFor="fog-opacity">Fog Opacity: {Math.round(playerFogOpacity * 100)}%</label>
            <input
              id="fog-opacity"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={playerFogOpacity}
              onChange={(e) => setPlayerFogOpacity(parseFloat(e.target.value))}
            />
          </div>
          <div className="grid-controls">
            <label>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              Show Grid
            </label>
            <label style={{ marginLeft: '0.5rem', fontSize: '0.875rem' }}>X:</label>
            <input
              type="number"
              value={gridColumns}
              onChange={(e) => setGridColumns(parseInt(e.target.value) || 100)}
              min="1"
              max="1000"
              step="1"
              disabled={!showGrid}
              style={{ width: '70px', marginLeft: '0.25rem' }}
            />
            <label style={{ marginLeft: '0.5rem', fontSize: '0.875rem' }}>Y:</label>
            <input
              type="number"
              value={gridRows}
              onChange={(e) => setGridRows(parseInt(e.target.value) || 100)}
              min="1"
              max="1000"
              step="1"
              disabled={!showGrid}
              style={{ width: '70px', marginLeft: '0.25rem' }}
            />
          </div>
        </div>

        <div className="info">
          <div><strong>Map Controls:</strong></div>
          <div>• Drag tokens/props to move (1 square at a time for tokens)</div>
          <div>• Double-click canvas to add tokens</div>
          <div>• Ctrl + double-click canvas to add props</div>
          <div>• Scroll to zoom</div>
          <div>• Drag canvas to pan</div>
          <div>• Shift + drag to reveal fog rectangle</div>
        </div>
      </div>

      {/* Actor List Panel */}
      <div className="actor-list-panel">
        <h3 onClick={() => setTokensCollapsed(!tokensCollapsed)} style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Active Tokens</span>
          <span style={{ fontSize: '0.9em' }}>{tokensCollapsed ? '▼' : '▲'}</span>
        </h3>
        {!tokensCollapsed && (
          <>
            {tokens.length > 0 && isSessionActive && (
              <button className="begin-encounter-btn" onClick={beginEncounter}>
                ⚔️ Roll Initiative
              </button>
            )}
            {tokens.length === 0 ? (
              <p className="no-tokens">No tokens on the map</p>
            ) : (
          <div className="actor-list">
            {[...tokens]
              .sort((a, b) => (b.actor?.initiative || 0) - (a.actor?.initiative || 0))
              .map(token => (
                <TokenCard
                  key={token.id}
                  token={token}
                  currentActorId={currentActorId}
                  draggedActorId={draggedActorId}
                  isGMView={true}
                  editingField={editingField}
                  editValue={editValue}
                  onActiveChange={async (tokenId, isActive) =>
                  {
                    const isBecomingActive = isActive;
                    const isBecomingInactive = !isActive;

                    let updatedTokens;
                    if (isBecomingActive)
                    {
                      updatedTokens = tokens.map(t =>
                      {
                        if (t.id === tokenId)
                        {
                          return { ...t, active: true, actor: { ...t.actor!, initiative: 1 } };
                        } else if (t.active && t.actor)
                        {
                          return { ...t, actor: { ...t.actor, initiative: (t.actor.initiative || 0) + 1 } };
                        }
                        return t;
                      });
                      setTokens(updatedTokens);
                    } else
                    {
                      updatedTokens = tokens.map(t =>
                        t.id === tokenId ? { ...t, active: false, actor: { ...t.actor!, initiative: -1 } } : t
                      );
                      setTokens(updatedTokens);

                      if (isBecomingInactive && tokenId === currentActorId)
                      {
                        markTurnComplete(tokenId);
                      }
                    }

                    const filename = backgroundImage?.split('/').pop();
                    if (filename)
                    {
                      const state = {
                        currentMapFilename: filename,
                        backgroundImage,
                        tokens: updatedTokens,
                        transform,
                        fogEnabled,
                        fogRevealDistance,
                        playerFogOpacity,
                        lightingCondition,
                        revealedPath,
                        gridColumns,
                        gridRows,
                        showGrid,
                        imageDimensions: imageRef.current ? {
                          width: imageRef.current.width,
                          height: imageRef.current.height
                        } : null,
                      };

                      try
                      {
                        await fetch(`${API_URL}/api/game-state`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ state })
                        });
                      } catch (error)
                      {
                        console.error('Failed to sync active state:', error);
                      }
                    }
                  }}
                  onStartEditing={startEditing}
                  onEditValueChange={setEditValue}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  onOpenSheet={(url) => window.open(url, '_blank')}
                  onMarkTurnComplete={markTurnComplete}
                  onEdit={(token) =>
                  {
                    setEditingToken(token);
                    setShowTokenCreator(true);
                  }}
                  onDelete={deleteToken}
                  onDragStart={(e, tokenId) =>
                  {
                    e.stopPropagation();
                    handleDragStart(e, tokenId);
                  }}
                  onDragEnter={handleDragEnter}
                  onDragOver={(e) =>
                  {
                    e.stopPropagation();
                    handleDragOver(e);
                  }}
                  onDrop={(e, tokenId) =>
                  {
                    e.stopPropagation();
                    handleDrop(e, tokenId);
                  }}
                  onDragEnd={handleDragEnd}
                />
              ))}
          </div>
        )}
        {tokens.length > 0 && currentActorId && (
          <button className="end-combat-btn" onClick={endCombat}>
            🛑 End Combat
          </button>
        )}
          </>
        )}

        <h3 onClick={() => setPropsCollapsed(!propsCollapsed)} style={{ marginTop: '24px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Props</span>
          <span style={{ fontSize: '0.9em' }}>{propsCollapsed ? '▼' : '▲'}</span>
        </h3>
        {!propsCollapsed && (
          <>
            {props.length === 0 ? (
              <p className="no-tokens">No props created</p>
            ) : (
          <div className="actor-list">
            {props.map(prop => (
              <div
                key={prop.id}
                className="actor-card"
                style={{
                  borderLeft: '4px solid #666',
                  backgroundColor: 'rgba(102, 102, 102, 0.1)',
                  cursor: 'default'
                }}
                title={prop.description}
              >
                <div className="actor-card-content">
                  {prop.imageUrl && (
                    <div className="actor-image-container">
                      <img
                        src={prop.imageUrl.startsWith('http') ? prop.imageUrl : `${API_URL}${prop.imageUrl}`}
                        alt={prop.name}
                        className="actor-image"
                      />
                    </div>
                  )}
                  <div className="actor-info">
                    <div className="actor-name">{prop.name || 'Unnamed Prop'}</div>
                    <div className="actor-card-buttons">
                      <button
                        className="icon-btn edit-icon-btn"
                        onClick={() =>
                        {
                          setEditingProp(prop);
                          setShowPropCreator(true);
                        }}
                        title="Edit prop"
                      >
                        ✏️
                      </button>
                      <button
                        className="icon-btn delete-icon-btn"
                        onClick={() =>
                        {
                          if (confirm('Are you sure you want to delete this prop?'))
                          {
                            setProps(prev => prev.filter(p => p.id !== prop.id));
                          }
                        }}
                        title="Delete prop"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
            )}
          </>
        )}
      </div>

      {showTokenCreator && (
        <TokenCreator
          onCreateToken={createToken}
          onUpdateToken={(tokenId, actor, imageFile, color, actorUrl) =>
          {
            updateToken(tokenId, actor, imageFile, color, actorUrl);
          }}
          editingToken={editingToken}
          onCancel={() =>
          {
            setShowTokenCreator(false);
            setPendingTokenPosition(null);
            setEditingToken(null);
          }}
        />
      )}

      {showPropCreator && (
        <PropCreator
          onCreateProp={async (propData, imageFile) =>
          {
            let imageUrl = propData.imageUrl;

            if (imageFile)
            {
              const formData = new FormData();
              formData.append('image', imageFile);
              formData.append('folder', 'props');
              formData.append('name', `prop-${Date.now()}`);

              try
              {
                const response = await fetch(`${API_URL}/api/upload`, {
                  method: 'POST',
                  body: formData,
                });
                const data = await response.json();
                imageUrl = data.url;
              } catch (error)
              {
                console.error('Failed to upload image:', error);
              }
            }

            const canvas = canvasRef.current;
            if (!canvas) return;

            // Convert screen center to canvas coordinates (accounting for transform)
            const centerScreen = { x: canvas.width / 2, y: canvas.height / 2 };
            const centerCanvas = screenToCanvas(centerScreen.x, centerScreen.y);

            const newProp: Prop = {
              id: Date.now().toString(),
              name: propData.name,
              description: propData.description,
              imageUrl,
              color: propData.color,
              x: centerCanvas.x,
              y: centerCanvas.y,
              radius: getTokenRadius()
            };

            setProps(prev => [...prev, newProp]);
            setShowPropCreator(false);
          }}
          onUpdateProp={async (propId, propData, imageFile) =>
          {
            let imageUrl = propData.imageUrl;

            if (imageFile)
            {
              const formData = new FormData();
              formData.append('image', imageFile);
              formData.append('folder', 'props');
              formData.append('name', `prop-${Date.now()}`);

              try
              {
                const response = await fetch(`${API_URL}/api/upload`, {
                  method: 'POST',
                  body: formData,
                });
                const data = await response.json();
                imageUrl = data.url;
              } catch (error)
              {
                console.error('Failed to upload image:', error);
              }
            }

            setProps(prev => prev.map(p =>
              p.id === propId
                ? { ...p, name: propData.name, description: propData.description, imageUrl }
                : p
            ));
            setShowPropCreator(false);
            setEditingProp(null);
          }}
          editingProp={editingProp}
          onCancel={() =>
          {
            setShowPropCreator(false);
            setEditingProp(null);
          }}
        />
      )}
    </div>
  );
}
