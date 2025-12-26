# Player Token Separation System

## Overview

Player tokens are now stored at the campaign level rather than the scenario level, allowing player characters to persist across all scenarios within a campaign. NPCs and monsters remain scenario-specific.

## Architecture

### File Structure

```
server/campaigns/
  {campaign-name}/
    playertokens/           # NEW: Campaign-level player tokens
      {token-id}.json       # Individual player token file
    {scenario-name}/
      .scenario-state.json  # Scenario game state (excludes player tokens)
      .metadata.json        # Scenario description
      {map-name}.json       # Map metadata (excludes player tokens)
```

### Token Identification

Tokens are classified by the `actor.player` property:
- **Player tokens**: `actor.player === true` → stored in `campaign/playertokens/`
- **Scenario tokens**: `actor.player === false` or undefined → stored in scenario files

### Data Flow

#### Loading Game State

1. Load scenario state from `.scenario-state.json`
2. Load all player tokens from `campaign/playertokens/`
3. Merge: `tokens = [...playerTokens, ...scenarioTokens]`
4. Return merged state to client

#### Saving Game State

1. Receive complete token array from client
2. Separate by `actor.player` property
3. Save each player token individually to `campaign/playertokens/{id}.json`
4. Delete orphaned player token files (exist on disk but not in current state)
5. Save scenario tokens to `.scenario-state.json` and map `.json` (excludes players)

## Implementation Details

### Helper Functions (server.js)

```javascript
// Get campaign-level player tokens directory
function getPlayerTokensPath()

// Load all player tokens from campaign directory
function loadPlayerTokens()

// Save individual player token to campaign directory
function savePlayerToken(token)

// Delete player token file from campaign directory
function deletePlayerToken(tokenId)
```

### Modified Functions

**loadScenarioGameState()**
- Now merges player tokens with scenario tokens
- Returns: `[...playerTokens, ...scenarioTokens]`

**saveScenarioGameState(state)**
- Filters out player tokens before saving
- Only scenario tokens written to `.scenario-state.json`

**POST /api/game-state**
- Separates tokens by `actor.player` property
- Saves player tokens individually
- Deletes orphaned player token files
- Saves scenario tokens to both `.scenario-state.json` and map `.json`

**POST /api/load-map**
- Merges player tokens when loading map metadata
- Ensures players appear even on newly loaded maps

## Benefits

1. **Player Persistence**: Player characters automatically appear in all scenarios
2. **Scenario Independence**: NPCs/monsters remain scenario-specific
3. **Data Consistency**: No duplication of player data across scenarios
4. **Migration Ready**: Existing scenarios continue to work (player tokens loaded if present)

## Testing

To verify the system works correctly:

1. Create a player token in Scenario A
2. Switch to Scenario B
3. Player token should appear in both scenarios
4. Create an NPC in Scenario A
5. Switch to Scenario B
6. NPC should NOT appear in Scenario B
7. Delete player token from Scenario A
8. Token file should be removed from `campaign/playertokens/`

## Migration

Existing campaigns with player tokens in scenario files will continue to work. The system:
- Loads existing player tokens from scenario files
- On next save, automatically migrates them to campaign directory
- Old scenario files retain copies until manually cleaned up
