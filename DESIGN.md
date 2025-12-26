# D&D Campaign Manager - Design Document

**Last Updated:** December 23, 2025

## Project Overview

A web-based application designed to help Game Masters (GMs) run Dungeons & Dragons campaigns. The application provides an interactive map viewer with fog of war mechanics, player token management, and lighting conditions that simulate D&D 5e visibility rules.

## Tech Stack

### Frontend
- **Framework:** React 19.2.0
- **Language:** TypeScript 5.9.3
- **Build Tool:** Vite 7.3.0
- **Routing:** React Router DOM 7.1.1
- **Styling:** CSS Modules
- **Canvas API:** HTML5 Canvas 2D Context

### Backend
- **Runtime:** Node.js
- **Framework:** Express
- **File Upload:** Multer
- **CORS:** cors middleware
- **Port:** 3001

### Development Tools
- **Linter:** ESLint
- **Dev Server Port:** 5173
- **Task Runner:** VS Code Tasks
- **Debugging:** VS Code Launch Configurations (Chrome/Edge)

## Architecture

### Component Structure

```
App.tsx (Root with Routing)
├── HomePage (Route: /)
│   └── Links to GM and Player views
├── GMView (Route: /gm)
│   ├── ImageUploader (Conditional - shown when no map loaded)
│   └── MapCanvas (Conditional - shown when map loaded)
└── PlayerViewPage (Route: /player)
    └── PlayerView (Full screen, read-only)
```

### Data Flow

1. **Image Upload Flow:**
   - User drags/drops or browses for image file
   - Frontend prompts for custom map name
   - File sent to backend via POST /api/upload
   - Backend saves to `public/images/maps/` with timestamp-based naming
   - Frontend receives confirmation and reloads available maps

2. **Map Selection Flow:**
   - Frontend fetches available maps from GET /api/maps on load
   - User selects from thumbnail gallery
   - Selected map URL passed to MapCanvas component

3. **Canvas Rendering Flow:**
   - MapCanvas loads image via Image object with CORS settings
   - Background canvas renders transformed image
   - Tokens rendered with optional images clipped to circles
   - Token images loaded via useEffect and cached in tokenImagesRef Map
   - Fog canvas renders overlay with lighting-based opacity
   - User interactions (pan/zoom/rotate/tokens) update state
   - useEffect hooks trigger re-renders on state changes

4. **Token Creation Flow:**
   - User double-clicks on canvas
   - Position calculated and stored in pendingTokenPosition
   - Token creator dialog opens with form fields
   - User optionally uploads image, fills actor data, picks color
   - On submit, image uploaded to backend via POST /api/upload
   - Token created with imageUrl, actor data, and color
   - Token image loaded and cached in tokenImagesRef
   - Token added to tokens array
   - State synced to PlayerView via localStorage

### State Management

All state managed via React hooks (useState, useEffect, useCallback):

**App.tsx State:**
- Routing state (React Router)

**GMView.tsx State:**
- `backgroundImage: string | null` - Current map URL or null
- `availableMaps: MapFile[]` - List of uploaded maps

**MapCanvas.tsx State:**
- `transform: { x, y, scale, rotation }` - Current view transform
- `isDragging: boolean` - Mouse drag state
- `dragStart: { x, y }` - Drag start coordinates
- `tokens: Token[]` - Array of player tokens with position/radius/color/imageUrl/actor
- `draggedToken: string | null` - ID of token being dragged
- `revealedPath: Array<{ x, y }>` - Path history for fog revealing
- `imageLoaded: boolean` - Image load status
- `fogEnabled: 'on' | 'off-all' | 'off-gm'` - Fog visibility mode
  - `'on'`: Fog visible for both GM and players
  - `'off-all'`: No fog for anyone
  - `'off-gm'`: GM sees everything (75% opacity), players still see fog
- `fogRevealDistance: number` - Multiplier for fog reveal radius (1-10x)
- `playerFogOpacity: number` - Opacity of fog for players (0-1)
- `lightingCondition: 'bright' | 'dim' | 'darkness'` - D&D lighting level
- `showTokenCreator: boolean` - Toggle for token creation dialog
- `pendingTokenPosition: { x, y } | null` - Position where new token will be placed

**PlayerViewPage.tsx State:**
- `gameState: GameState` - Synced game state from localStorage (polled every 1s)

**PlayerView.tsx Props:**
- `backgroundImage, tokens, transform, fogEnabled, fogRevealDistance, lightingCondition` - All passed from PlayerViewPage

### State Synchronization

GM game state is synchronized to player view via **localStorage**:
- MapCanvas saves complete game state to `localStorage.gmGameState` on every state change
- PlayerViewPage polls localStorage every 1 second for updates
- Enables multiple browser tabs/windows to share state locally
- Future enhancement: WebSocket for true multi-user sync

## Current Features

### ✅ Routing & Views
- **Home Page:** Landing page with links to GM and Player views
- **GM View (Route: /gm):** Full-featured interface with all controls
- **Player View (Route: /player):** Full-screen map display with fog, no controls
- **State Sync:** LocalStorage-based synchronization between GM and Player views (1s polling)

### ✅ Core Map Functionality
- **Image Upload:** Drag-and-drop or browse to upload map images
- **Custom Naming:** Prompt for custom map name during upload
- **Map Gallery:** Thumbnail preview of all uploaded maps
- **Map Selection:** Click to load any previously uploaded map

### ✅ Canvas Controls
- **Pan:** Click and drag to move map around
- **Zoom:** Mouse wheel to zoom in/out (0.1x - 5x)
- **Rotate:** Buttons to rotate ±15° increments
- **Reset View:** Button to restore default transform (0,0,1,0)

### ✅ Player Tokens
- **Add Tokens:** Double-click on map to open token creator dialog
- **Token Creator Dialog:** 
  - Token Color picker (customizable border/background)
  - Token Image upload (optional - images displayed inside circles)
  - Actor Data fields (optional):
    - Name (character name)
    - AC (Armor Class)
    - HP (Hit Points)
    - Description (character notes)
- **Drag to Move:** Click and drag tokens to reposition
- **Fog Revealing:** Fog clears along the entire drag path when moving tokens
- **Coordinate Transformation:** Tokens stay positioned correctly during pan/zoom/rotate with proper rotation handling
- **Hit Detection:** Click detection uses 1.5x radius buffer for easier selection
- **Clear Tokens:** Button to remove all tokens
- **Visual Rendering:**
  - Colored circle border (customizable)
  - Optional image displayed inside circle (clipped to circular shape)
  - 20px radius circles
- **Image Storage:** Token images uploaded to server via `/api/upload` endpoint
- **Data Persistence:** Token data (including images and actor info) synced to PlayerView via localStorage

### ✅ Fog of War System
- **Toggle:** Dropdown with three modes:
  - **ON**: Fog visible for both GM and players
  - **OFF for All**: No fog rendered for anyone
  - **OFF for GM Only**: GM sees entire map, players still see fog
- **100% Opacity:** Black fog completely obscures unrevealed areas
- **Reveal Mechanism:** Fog cleared in radius around each player token
- **Adjustable Radius:** Slider to set reveal distance (1x - 10x, 0.5 step increments)
- **Lighting Integration:** Fog behavior changes based on lighting conditions

### ✅ D&D Lighting Conditions
- **Bright Light:** 
  - Fog optional (can be toggled off)
  - Standard reveal radius
  - No fog opacity adjustment
  
- **Dim Light:**
  - Fog automatically enabled
  - Standard reveal radius
  - 60% fog opacity (0.6) for partial obscurement
  
- **Darkness:**
  - Fog automatically enabled
  - 50% reduced reveal radius
  - 100% fog opacity (1.0) for complete obscurement
  - Simulates darkvision limitations

### ✅ Environment Configuration
- **Development:** `.env` file with `VITE_API_URL=http://localhost:3001`
- **Production:** `.env.production` for deployment configuration
- **Config Abstraction:** `src/config.ts` exports API_URL for all components

## File Structure

```
CampaignManager/
├── .env                          # Dev environment variables
├── .env.production               # Production environment variables
├── package.json                  # Frontend dependencies
├── vite.config.ts                # Vite build configuration
├── tsconfig.json                 # TypeScript configuration
├── eslint.config.js              # ESLint rules
├── index.html                    # HTML entry point
├── README.md                     # User documentation
├── DESIGN.md                     # This file
├── .vscode/
│   ├── tasks.json                # Dev/Upload server tasks
│   └── launch.json               # Debug configurations
├── public/
│   └── images/
│       └── maps/                 # Uploaded map images stored here
├── server/
│   ├── package.json              # Backend dependencies
│   └── server.js                 # Express server
└── src/
    ├── main.tsx                  # React entry point
    ├── App.tsx                   # Root component with routing
    ├── App.css                   # App styles
    ├── config.ts                 # API URL configuration
    ├── components/
    │   ├── GMView.tsx            # GM interface component
    │   ├── ImageUploader.tsx     # Upload UI component
    │   ├── ImageUploader.css     # Upload styles
    │   ├── MapCanvas.tsx         # Main canvas component (GM controls)
    │   ├── MapCanvas.css         # Canvas styles
    │   ├── PlayerView.tsx        # Player canvas (read-only)
    │   ├── PlayerView.css        # Player view styles
    │   └── PlayerViewPage.tsx    # Player view page wrapper
    └── utils/
        └── imageStorage.ts       # Image persistence utilities
```

## API Endpoints

### POST /api/upload
**Purpose:** Accept map image and token image uploads and save to server

**Request:**
- Content-Type: multipart/form-data
- Body: `image` (file), `name` (string)

**Response:**
```json
{
  "url": "/images/maps/custom-name-1234567890.png"
}
```

**Usage:**
- Map uploads: User-provided custom name
- Token uploads: Auto-generated name `token-{tokenId}-{filename}`
```

**Error Handling:**
- 400: No file uploaded
- 500: Server error

### GET /api/maps
**Purpose:** List all available map images

**Response:**
```json
{
  "maps": [
    "/images/maps/dungeon-map-1234567890.png",
    "/images/maps/town-square-1234567891.png"
  ]
}
```

## Canvas Implementation Details

### Data Interfaces

```typescript
interface Actor {
  name: string;
  ac: number;
  hp: number;
  description: string;
}

interface Token {
  id: string;
  x: number;
  y: number;
  radius: number;
  color?: string;        // Hex color for circle border/background
  imageUrl?: string;     // Path to uploaded token image
  actor?: Actor;         // Optional character data
}
```

### Dual Canvas System
- **Background Canvas:** Renders map image with transformations
- **Fog Canvas:** Renders fog overlay with cutouts for revealed areas
- **Layering:** Fog canvas positioned absolutely over background canvas

### Coordinate Transformation
Screen coordinates converted to canvas coordinates accounting for:
- Canvas center offset
- Current scale factor
- Current pan offset (x, y)
- Applied before rotation

### Fog Rendering Algorithm
1. Fill entire canvas with black (fog color) at specified opacity
2. Set composite operation to 'destination-out' (eraser mode)
3. For each token:
   - Calculate effective reveal distance (base * multiplier * lighting modifier)
   - Draw circle at token position
   - Circle "erases" fog, revealing map underneath
4. For each point in revealedPath (drag history):
   - Draw radial gradient circle at point
   - Creates fog-cleared trail along token movement paths
5. Restore composite operation
6. Adjust global alpha based on lighting condition and fog mode

### Token Rendering Algorithm
1. Save canvas state
2. Apply transformations (translate, rotate, scale) to match map view
3. For each token:
   - Draw colored circle background/border
   - If token has imageUrl:
     - Create circular clipping path (radius - 2px for border)
     - Draw token image inside clipped region
     - Image scaled to fit circle diameter
   - Restore canvas state
4. Token images cached in tokenImagesRef Map for performance

### Performance Considerations
- `useCallback` memoization for draw functions prevents unnecessary re-renders
- Dependency arrays carefully managed to avoid infinite loops
- Canvas only redraws when relevant state changes

## User Interactions

### GM View
| Action | Behavior |
|--------|----------|
| Navigate to / | See home page with view selection |
| Navigate to /gm | Access GM interface |
| Scroll wheel | Zoom in/out (centered on mouse position) |
| Click + Drag | Pan map around canvas |
| Double-click | Add player token at click location |
| ↶ Rotate Left button | Rotate map -15° |
| ↷ Rotate Right button | Rotate map +15° |
| Reset View button | Restore default transform |
| Clear Tokens button | Remove all player tokens |
| Fog of War dropdown | Select fog mode (ON / OFF for All / OFF for GM Only) |
| Lighting dropdown | Change lighting condition |
| Reveal Distance slider | Adjust fog reveal radius |

### Player View
| Action | Behavior |
|--------|----------|
| Navigate to /player | See full-screen map with current game state |
| Auto-refresh | View updates every 1s with GM's current state |
| No controls | Read-only, cannot modify map/fog/tokens |

## Design Decisions

### Why Dual Canvas?
- **Separation of Concerns:** Background rendering separate from fog logic
- **Performance:** Can redraw fog without re-rendering heavy map image
- **Flexibility:** Easy to toggle fog layer visibility

### Why Client-Side Fog Rendering?
- **Real-time Interactivity:** No server round-trips for token placement
- **Privacy:** GM can reveal fog without persisting state
- **Simplicity:** No database or session management needed

### Why Timestamp-Based Filenames?
- **Uniqueness:** Prevents naming conflicts
- **Traceability:** Easy to identify when maps were uploaded
- **URL Stability:** Names don't change on re-upload

### Why LocalStorage for State Sync?
- **Simplicity:** No backend WebSocket infrastructure needed
- **Local Multi-Window:** Works for GM and Player views in separate browser windows/tabs
- **Development Speed:** Quick to implement for initial version
- **Limitation:** Only works on same machine - not suitable for remote players
- **Future:** Will be replaced with WebSocket or Server-Sent Events for true multi-user support

### Why Environment Variables?
- **Deployment Flexibility:** Easy to switch between dev/prod
- **Security:** Keeps sensitive URLs out of code
- **Configuration:** Single source of truth for API endpoints

## Future Considerations

### Potential Features
- **WebSocket Sync:** Real-time state synchronization for remote players
- **Session Management:** Multiple concurrent game sessions
- **Player Authentication:** Login system for remote players
- Token drag-and-drop to reposition
- Different token colors/shapes for different characters
- Save/load fog state (persist revealed areas)
- Multiple map layers (overlay tokens, effects)
- Grid overlay with snap-to-grid
- Measurement tools (distance, area)
- Drawing tools (lines, shapes, notes)
- Initiative tracker integration
- Combat encounter management
- **Mobile Support:** Touch controls for tablets

### Technical Debt
- LocalStorage sync is limited to same machine (needs WebSocket for remote play)

### Known Limitations
- No authentication/authorization
- No database (all state in-memory and localStorage)
- No fog persistence between sessions (refreshing GM view clears state)
- Player view only works on same machine as GM (localhost only)
- No undo/redo functionality
- Limited to 2D maps (no 3D support)

## Testing Strategy

### Manual Testing Checklist
- [ ] Home page displays with GM and Player links
- [ ] Navigate to /gm shows GM interface
- [ ] Navigate to /player shows waiting message
- [ ] Upload new map with custom name
- [ ] Select existing map from gallery
- [ ] Open /player in new tab, verify map appears
- [ ] Pan map with mouse drag (GM view)
- [ ] Verify pan syncs to player view
- [ ] Zoom with scroll wheel
- [ ] Rotate map left/right
- [ ] Reset view to defaults
- [ ] Add tokens via double-click
- [ ] Verify tokens appear in player view
- [ ] Clear all tokens
- [ ] Set fog to ON, verify fog in both views
- [ ] Set fog to OFF for All, verify no fog in either view
- [ ] Set fog to OFF for GM Only, verify GM sees no fog but player does
- [ ] Adjust reveal distance slider
- [ ] Verify fog updates in player view
- [ ] Change lighting conditions
- [ ] Verify fog opacity in dim light
- [ ] Verify reduced radius in darkness

### Browser Compatibility
- Chrome/Edge (primary testing)
- Firefox (should work, not extensively tested)
- Safari (should work, not extensively tested)

## Development Workflow

### Starting Development
1. Open workspace in VS Code
2. Run task "Start All Servers" or:
   - Terminal 1: `npm run dev` (frontend on :5173)
   - Terminal 2: `cd server && npm start` (backend on :3001)
3. Open http://localhost:5173

### Making Changes
1. Edit source files in `src/`
2. Vite hot-reloads automatically
3. Check for errors in VS Code Problems panel
4. Test in browser
5. Commit changes

### Adding New Features
1. Update this DESIGN.md with planned changes
2. Implement feature in appropriate component
3. Test thoroughly
4. Update DESIGN.md with completed feature
5. Update README.md user documentation if needed

## Version History

### Current Version (v1.2)
- **Token Images & Actor System:**
  - Added token creator dialog with image upload
  - Actor object with Name, AC, HP, Description fields
  - Tokens display uploaded images inside colored circles
  - Image caching system for performance (tokenImagesRef)
  - Token images synced to Player View
  - Optional actor data for character management
  - Color picker for token customization
  - Form validation and preview in token creator

### Version 1.1
- Added separate Player View with full-screen display
- Implemented routing with React Router (/, /gm, /player)
- Added localStorage-based state synchronization
- Player view auto-updates every 1 second
- Created GMView component to separate concerns
- Home page with view selection
- Token dragging with fog path revealing
- Three-mode fog system (ON / OFF All / OFF for GM Only)
- GM fog visibility at 75% opacity
- Player fog opacity slider (0-100%)
- Drag-and-drop map selection from thumbnail gallery
- Reset Fog button

### Version 1.0
- Initial release with all core features
- Image upload and management
- Interactive map canvas
- Fog of war with D&D lighting
- Player token system
- Full pan/zoom/rotate controls

---

*This document will be updated as the application evolves.*
