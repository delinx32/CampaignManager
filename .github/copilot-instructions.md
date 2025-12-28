# Campaign Manager - D&D Virtual Tabletop

## Project Overview
A React-based virtual tabletop for D&D games with separate views for GM, observers, and players. Uses Express backend for state persistence and file management.

## Architecture & Key Decisions

### View Separation (Critical Design)
- **GM View** (`/campaign/:campaignName/:scenarioName/gm`) - Full map control, token management, fog of war configuration
- **Observer View** (`/:campaignName/:sessionName/observer`) - Read-only map display for spectators/projection (public, no auth)
- **Player View** (`/:campaignName/:sessionName/player`) - Individual character card + character sheet iframe (requires auth)
- **Share Key Landing** (`/:shareKey`) - Public landing page showing active sessions for a share key

**Why Separate?** Initially had one "player" route for map viewing, but users need different experiences:
- Observers passively watch the map (no interaction, no login required)
- Players need character cards, stat tracking, heartbeat system, and must be logged in
- Share key landing provides public access point to discover active sessions

### Authentication System

#### Two User Roles
1. **GM Role** (Google OAuth)
   - Users who own or have access to share keys automatically get GM role
   - Full access to campaign creation, management, and settings
   - Uses `ProtectedRoute` component

2. **Player Role** (Google OAuth)
   - Users who log in via Google but don't own any share keys get player role
   - Can access player view after authentication
   - Cannot access GM features

#### Route Protection
- **Public Routes**: Observer view, share key landing (no auth required)
- **Player Routes**: Player view (requires any authenticated user)
- **GM Routes**: Campaign management, scenario selection, GM view, settings (requires GM role)
- Uses `ProtectedRoute` for GM access, `ViewerRoute` for player-only access

#### Share Key Landing Page
- **Route**: `/:shareKey`
- **Purpose**: Public entry point showing all active sessions for a share key
- **Features**:
  - No authentication required to view
  - Lists all campaigns with active sessions for that share key
  - Shows observer (public) and player (auth required) view links for each session
  - Sorted by last played date
- **Backend**: 
  - `GET /api/sharekey/:shareKey/sessions` - Returns active campaigns/sessions (public endpoint)

### Component Architecture

#### TokenHeader Component (Reusable Pattern)
- **Location**: `src/components/TokenHeader.tsx`
- **Purpose**: 100px horizontal bar showing token image, name, and stats
- **Why Created**: CSS-only responsive design kept breaking (image stripe issues, giant images, no stacking). Component-based solution proved more maintainable.
- **Usage**: Player view compact header, reusable for any token display

#### Token Storage System
- **Player Tokens**: Stored at campaign level (`campaigns/[name]/playertokens/`)
  - Reason: Players persist across scenarios
- **NPC Tokens**: Stored at scenario level (`campaigns/[name]/scenarios/[scenario]/npctokens/`)
  - Reason: NPCs are scenario-specific
- **Pattern**: Separate JSON file per token, NOT embedded in map metadata

#### Heartbeat System
- **Frontend**: PlayerView sends heartbeat every 3 seconds
- **Backend**: Sets `token.active = true` on heartbeat, auto-deactivates after 10 seconds
- **Bug Fixed**: Heartbeat endpoint originally only recorded timestamp but never set `active=true`
- **Storage**: Uses localStorage to persist selected character across page refreshes

### Backend Patterns

#### File Structure
```
server/
  campaigns/
    [campaign-name]/
      playertokens/           # Player tokens (campaign-scoped)
      scenarios/
        [scenario-name]/
          maps/               # Map JSON metadata files
          npctokens/          # NPC tokens (scenario-scoped)
          .scenario-state.json  # Scenario state (NO tokens, stored separately)
      .metadata.json          # Campaign description
```

#### State Management
- **In-Memory**: `gameState` object holds current session state
- **Persistence**: Auto-saves to disk on every state update
- **Context**: `currentCampaign` and `currentScenario` track active session
- **Pattern**: Last write wins (no conflict resolution)

### Important Conventions

#### Type-Only Imports
- **Required**: Use `import type` for types due to `verbatimModuleSyntax`
- **Example**: `import type { Token } from '../types'`

#### Token Type System
- Base `Token` type in `src/types/index.ts`
- Player tokens: `token.actor.player === true`
- NPC tokens: `token.actor.player === false | undefined`
- Use intersection types when extending: `Token & { maxHP: number }`

#### CSS Organization
- Component-specific CSS files (e.g., `TokenHeader.css`)
- Avoid complex responsive CSS in favor of component-based solutions
- Use absolute positioning sparingly (edit buttons, turn indicators)

### Failed Approaches (Don't Retry)

1. **CSS-Only Responsive Token Card**: Tried making token card become compact row header using CSS media queries and aspect ratio detection. Result: Image showed as thin stripe or giant, layout broke constantly. Solution: Created TokenHeader component instead.

2. **Inline TokenCreator in MapCanvas**: Had 400+ lines of duplicate token creation code. Fixed by importing shared `TokenCreator` component.

3. **Embedding Tokens in Map JSON**: Originally stored tokens in map metadata files. Problems: Player tokens lost when switching maps, file conflicts. Solution: Separate JSON files per token.

### Development Workflow

#### Running the App
```bash
# Terminal 1: Frontend dev server
npm run dev

# Terminal 2: Backend server  
cd server
npm run dev
```

#### Key URLs
- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- GM View: http://localhost:5173/campaign/[name]/[scenario]/gm
- Share Key Landing: http://localhost:5173/[shareKey]
- Observer View: http://localhost:5173/[campaign]/[session]/observer (public)
- Player View: http://localhost:5173/[campaign]/[session]/player (requires auth)

### User Preferences
- **Implementation over suggestions**: Implement changes directly rather than just describing them
- **Minimal explanations**: Keep responses concise, action-oriented
- **No markdown summaries**: Don't create documentation files after changes unless explicitly requested
- Always check for and fix problems and errors after making changes
- Always update documentation, PRDs, or other supporting files to reflect changes made

### Recent Major Changes
- ✅ Share key landing at `/:shareKey` (moved from `/sharekey/:shareKey`)
- ✅ Observer view is now public (no authentication required)
- ✅ Player view requires Google OAuth authentication
- ✅ Role assignment: GMs own share keys, players don't
- ✅ Removed guest authentication system
- ✅ Added `ViewerRoute` component to protect player view
- ✅ Backend endpoints for active session listings (public)
- ✅ Renamed `/player` route to `/observer` (files: ObserverView, ObserverViewPage)
- ✅ Created new `/player` route with character card view
- ✅ Fixed backend heartbeat to set `token.active = true`
- ✅ Added localStorage persistence for selected character
- ✅ Cleaned ObserverViewPage (removed all player management code)
- ✅ Added hover cards to Observer View (shows token stats on mouseover)

### Technical Debt & Future Considerations
- ObserverView.css still has 300+ lines of orphaned responsive CSS (lines 92-464 in PlayerView.css pattern)
- No deactivation on page unload for PlayerView (relies on timeout)
- No reconnection logic for lost heartbeats
- Could add player count display in GM view
- Could show active player indicators in observer view
