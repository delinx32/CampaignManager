# Product Requirements Document: Campaign Manager

## 1. Product Overview

### 1.1 Product Name
Campaign Manager - D&D Virtual Tabletop

### 1.2 Product Vision
A web-based virtual tabletop application designed specifically for Dungeons & Dragons gameplay, featuring separate views for Game Masters, observers, and players with real-time state synchronization and persistent session management.

### 1.3 Target Users
- **Game Masters (GMs)**: Need full control over maps, tokens, encounters, and game state
- **Players**: Need individual character management and character sheet integration
- **Observers**: Spectators or secondary displays (projectors, TVs) for table-top gameplay

### 1.4 Core Value Proposition
- **View Separation**: Distinct interfaces optimized for different roles (GM, Player, Observer)
- **Session Persistence**: Complete game state saved per session, allowing games to pause and resume
- **Character Integration**: Direct D&D Beyond character sheet embedding for players
- **Dual Display Support**: Top/bottom observer cards rotated 180° for physical tabletop use
- **AI-Assisted Content**: Token and portrait generation using OpenAI's image models

## 2. Technical Architecture

### 2.1 Technology Stack
- **Frontend**: React 18 with TypeScript, Vite build system
- **Backend**: Node.js with Express
- **State Management**: File-based JSON persistence with in-memory runtime state
- **Rendering**: HTML5 Canvas API for map and token display
- **External APIs**: OpenAI API for AI image generation, D&D Beyond API for character data

### 2.2 System Architecture
```
Frontend (React/TypeScript)
├── GMView - Full control interface
├── ObserverView - Read-only display
└── PlayerView - Individual character interface

Backend (Express/Node.js)
├── State Management (gameState object)
├── File Persistence
│   ├── Campaign definitions
│   ├── Session runtime states
│   ├── Token files (separate per token)
│   └── Prop files (separate per prop)
└── API Endpoints
    ├── Game state sync
    ├── Session management
    ├── File uploads
    └── AI image generation
```

### 2.3 Data Architecture
```
campaigns/
  [campaign-name]/
    .metadata.json              # Campaign description
    playertokens/               # Player tokens (campaign-scoped)
      [token-id].json
    scenarios/
      [scenario-name]/
        .scenario-state.json    # Definition state
        maps/                   # Map metadata files
          [map-name].json
        npctokens/              # NPC tokens (scenario-scoped)
          [token-id].json
        props/                  # Props (scenario-scoped)
          [prop-id].json
        sessions/
          [session-name]/
            .runtime-state.json # Session-specific state
            playertokens/       # Session player tokens
            npctokens/          # Session NPC tokens
            props/              # Session props
```

## 3. Core Features

### 3.1 Game Master View

#### 3.1.1 Map Management
- **Upload Maps**: Support for JPG, PNG, WebP, GIF formats
- **Grid Configuration**: Customizable grid columns/rows
- **Pan/Zoom**: Canvas transformation controls
- **Map Metadata**: Per-map fog settings, lighting, grid visibility

#### 3.1.2 Token Management
- **Player Tokens**: Campaign-scoped, persist across scenarios
- **NPC Tokens**: Scenario-scoped, specific to current scenario
- **Token Creation**: 
  - Manual upload (portrait + token images)
  - AI generation with OpenAI
  - D&D Beyond character import
- **Token Properties**:
  - Name, HP (current/max), initiative
  - Active/inactive state
  - Position (x, y coordinates)
  - Size (radius based on grid)
- **Drag & Drop**: Position tokens on map canvas
- **Auto-positioning**: New player tokens auto-position near "party_start" prop

#### 3.1.3 Prop System
- **Prop Creation**: Named objects with custom images
- **Transform Controls**:
  - Rotation (15° increments)
  - Scale (distance-based resizing)
  - Reset controls
- **Hover Controls**: On-canvas manipulation
- **Rendering Order**: Props render below tokens

#### 3.1.4 Encounter Management
- **Roll Initiative**: Automatic initiative rolls for all active tokens
- **Turn Tracking**: Visual indicators for current actor
- **Next Turn**: Cycle through initiative order
- **End Encounter**: Clear initiative and current actor

#### 3.1.5 Fog of War
- **Modes**: 
  - On (visible to players)
  - Off-All (disabled entirely)
  - Off-GM (GM sees all, players see fog)
- **Reveal Distance**: Configurable grid square radius
- **Reveal Tool**: Click-drag rectangle selection
- **Persistent Revealed Areas**: Saved per map

#### 3.1.6 Session Management
- **Create Session**: Name and start new game session
- **Load Session**: Continue existing session
- **End Session**: 
  - Deactivate all player tokens
  - Copy state back to scenario definition
  - Preserve session files for future use
- **Edit Mode**: Direct scenario editing without session

### 3.2 Observer View

#### 3.2.1 Display Features
- **Map Display**: Read-only map with tokens and props
- **Fog of War**: Respects player fog settings
- **Real-time Sync**: Updates every 1 second from backend

#### 3.2.2 Encounter Cards
- **Conditional Display**: Only show during active encounters (when currentActorId is set)
- **Dual Display**:
  - Top cards: Rotated 180° for opposite side of table
  - Bottom cards: Normal orientation
- **Toggle Controls**:
  - Hide/show top cards (bottom always visible during encounter)
  - Per-session persistence of visibility preference
- **Card Content**:
  - Token image
  - Actor name
  - Current/Max HP
  - Initiative value
  - Current turn indicator

#### 3.2.3 Session Support
- **Session URL**: `/observer?session=[session-name]`
- **Session End Overlay**: Full-screen notification when GM ends session

### 3.3 Player View

#### 3.3.1 Character Selection
- **Token List**: Display all player tokens
- **Selection Persistence**: localStorage remembers last selected character

#### 3.3.2 Character Display
- **Token Header**: 100px horizontal bar with image, name, HP
- **Character Sheet**: Embedded D&D Beyond iframe
- **Turn Indicator**: Highlight when it's player's turn

#### 3.3.3 Heartbeat System
- **Client**: Send heartbeat every 3 seconds
- **Server**: Auto-deactivate after 10 seconds without heartbeat
- **Purpose**: Track active players, remove disconnected players from map

### 3.4 Campaign & Scenario Management

#### 3.4.1 Campaign Features
- **Create**: New campaign folders
- **Edit**: Rename, add description
- **Archive**: Soft delete with timestamp
- **Restore**: Recover archived campaigns
- **Delete**: Permanent removal of archived campaigns

#### 3.4.2 Scenario Features
- **Create**: New scenarios within campaigns
- **Edit**: Rename, add description
- **Context Setting**: Set current campaign/scenario for GM view
- **Last Played**: Track most recent session per scenario

### 3.5 AI Image Generation

#### 3.5.1 Features
- **Templates**: Portrait, token, props
- **Custom Prompts**: User-provided descriptions
- **Reference Images**: Upload reference for character matching
- **Models**: Support for DALL-E and GPT-image models
- **Temp Storage**: Preview before final placement

#### 3.5.2 Integration Points
- Token creation (portrait + token images)
- Prop creation

### 3.6 D&D Beyond Integration

#### 3.6.1 Character Import
- **URL-based**: Paste character sheet URL
- **Data Extraction**:
  - Character name
  - Portrait image
  - Race and class information
  - Notes, traits, backstory
- **Auto-populate**: Fill token creator with extracted data

#### 3.6.2 Character Sheet Embedding
- **iFrame Integration**: Embed full character sheet in player view
- **Sheet URL**: `/sheet/[character-id]`

## 4. User Workflows

### 4.1 GM: Starting a New Game Session
1. Select campaign and scenario
2. Click "Start Game Session"
3. Enter session name (or select existing)
4. Load map or select from existing
5. Configure grid, lighting, fog settings
6. Add/position NPC tokens
7. Wait for players to join (tokens auto-position)
8. Click "Roll Initiative" to begin encounter
9. Use "Next Turn" to advance through combat
10. Click "End Encounter" when combat finishes
11. Click "End Game Session" when done

### 4.2 Player: Joining a Game
1. Open player view URL
2. Select character token from list
3. View embedded character sheet
4. Heartbeat maintains active status on map
5. See turn indicator when it's their turn

### 4.3 Observer: Spectating
1. Open observer view URL (optionally with session parameter)
2. View map and tokens in real-time
3. See encounter cards when combat starts
4. Toggle top cards visibility as needed

### 4.4 GM: Creating Tokens
1. Click "Create New Token"
2. Choose creation method:
   - Upload images manually
   - Generate with AI
   - Import from D&D Beyond
3. Fill in token details (name, HP, player/NPC)
4. Token appears in sidebar
5. Drag onto map to position

## 5. Technical Requirements

### 5.1 Performance
- **State Sync**: 500ms debounce on GM changes, 1s polling for observers/players
- **Canvas Rendering**: 60fps target for drag operations
- **File I/O**: Asynchronous file operations, individual token files to avoid conflicts

### 5.2 Data Persistence
- **Auto-save**: All changes auto-save to backend
- **Session Isolation**: Session files separate from definition files
- **Token Separation**: Individual JSON files per token to prevent file conflicts
- **State History**: Sessions preserve complete game state for resumption

### 5.3 Security & Configuration
- **API Key Management**: settings.json (excluded from git)
- **CORS**: Enabled for development, configurable for production
- **File Uploads**: 10MB limit, image format validation

### 5.4 Browser Compatibility
- Modern browsers with Canvas API support
- JavaScript enabled
- Local storage for player preferences

## 6. Known Limitations & Future Considerations

### 6.1 Current Limitations
- **No Conflict Resolution**: Last write wins (single GM assumed)
- **No User Authentication**: Open access to all views
- **Limited Multiplayer**: No player-to-player communication
- **No Undo/Redo**: State changes are immediate and persistent

### 6.2 Technical Debt
- ObserverView.css contains 300+ lines of orphaned responsive CSS
- No reconnection logic for lost player heartbeats
- No player count display in GM view
- No active player indicators in observer view

### 6.3 Potential Enhancements
- WebSocket for real-time state sync (eliminate polling)
- User authentication and authorization
- Dice rolling system
- Chat/messaging
- Audio/video integration
- Measurement tools (distance, area)
- Drawing tools
- Template/spell effect overlays
- Mobile-responsive views
- Offline mode support

## 7. Success Metrics

### 7.1 Functional Success
- Session state persists correctly across start/stop/resume
- All three views (GM, Player, Observer) sync within 1-2 seconds
- Token creation succeeds via all three methods (upload, AI, D&D Beyond)
- Fog of war reveals/hides correctly for players vs GM
- Encounter initiative tracking works correctly

### 7.2 User Experience
- GM can start a session and add tokens within 2 minutes
- Players can join and see their character within 30 seconds
- Observer cards toggle visibility and persist preference
- Map performance remains smooth with 20+ tokens

## 8. Development & Deployment

### 8.1 Development Setup
```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install

# Configure API key
cp settings.json.example settings.json
# Edit settings.json with OpenAI API key

# Run development servers
npm run dev              # Frontend (port 5173)
cd server && npm run dev # Backend (port 3001)
```

### 8.2 Environment Configuration
- Frontend: `.env` for VITE_API_URL
- Backend: `settings.json` for OpenAI API key
- Production: Update VITE_API_URL to production backend URL

### 8.3 Key URLs
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- GM View: `/campaign/[name]/[scenario]/gm`
- Observer View: `/observer` or `/observer?session=[name]`
- Player View: `/player`

## 9. Glossary

- **Token**: Digital representation of a character or creature on the map
- **Prop**: Static map object (furniture, markers, etc.)
- **Session**: Instance of gameplay with saved state
- **Scenario**: Collection of maps and NPCs for a specific adventure
- **Campaign**: Collection of scenarios and player characters
- **Fog of War**: Visibility restriction system for unexplored areas
- **Initiative**: Turn order in combat encounters
- **Heartbeat**: Periodic client signal to maintain active connection status
