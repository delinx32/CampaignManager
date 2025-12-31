import fs from 'fs';
import path from 'path';

// ===========================
// Game State Management
// ===========================

// In-memory game state storage
let currentCampaign = null;
let currentScenario = null;
let currentUserId = null;
let currentShareKey = null;
let currentSessionName = null;
let isSessionActive = false;
let gameState = {
  backgroundImage: null,
  tokens: [],
  props: [],
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  fogEnabled: 'off-gm',
  fogRevealDistance: 3,
  playerFogOpacity: 1,
  lightingCondition: 'bright',
  revealedPath: [],
  gridColumns: 100,
  gridRows: 100,
  showGrid: true,
  imageDimensions: null,
  currentActorId: null,
  showObserverCards: true
};

// Track player heartbeats
const playerHeartbeats = new Map(); // tokenId -> timestamp

// Context helpers (set by server.js)
let contextHelpers = {
  tokens: null,
  saveMapMetadata: null,
  getShareKeyCampaignsDir: null,
  usersDir: null
};

/**
 * Set context helpers and module references
 */
export function setContext(helpers) {
  contextHelpers = { ...contextHelpers, ...helpers };
}

/**
 * Get current game state
 */
export function getGameState() {
  return gameState;
}

/**
 * Set game state
 */
export function setGameState(state) {
  gameState = { ...state };
}

/**
 * Get current campaign
 */
export function getCurrentCampaign() {
  return currentCampaign;
}

/**
 * Set current campaign
 */
export function setCurrentCampaign(val) {
  currentCampaign = val;
}

/**
 * Get current scenario
 */
export function getCurrentScenario() {
  return currentScenario;
}

/**
 * Set current scenario
 */
export function setCurrentScenario(val) {
  currentScenario = val;
}

/**
 * Get current share key
 */
export function getCurrentShareKey() {
  return currentShareKey;
}

/**
 * Set current share key
 */
export function setCurrentShareKey(val) {
  currentShareKey = val;
}

/**
 * Get current session name
 */
export function getCurrentSessionName() {
  return currentSessionName;
}

/**
 * Set current session name
 */
export function setCurrentSessionName(val) {
  currentSessionName = val;
}

/**
 * Check if session is active
 */
export function isActiveSession() {
  return isSessionActive;
}

/**
 * Set session active state
 */
export function setSessionActive(active) {
  isSessionActive = active;
}

/**
 * Get player heartbeats map
 */
export function getPlayerHeartbeats() {
  return playerHeartbeats;
}

/**
 * Record player heartbeat
 */
export function recordHeartbeat(tokenId) {
  playerHeartbeats.set(tokenId, Date.now());
}

/**
 * Helper function to get scenario game state file path
 */
export function getScenarioGameStatePath() {
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = contextHelpers.getShareKeyCampaignsDir(currentShareKey);

  if (isSessionActive && currentSessionName) {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, '.runtime-state.json');
  }

  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);
  return path.join(scenarioPath, '.scenario-state.json');
}

/**
 * Helper function to load scenario game state from file
 */
export function loadScenarioGameState() {
  const statePath = getScenarioGameStatePath();
  if (!statePath || !fs.existsSync(statePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(statePath, 'utf-8');
    const scenarioState = JSON.parse(data);

    // Convert old image paths to sharekey-based paths
    if (scenarioState.backgroundImage && scenarioState.backgroundImage.startsWith('/images/')) {
      scenarioState.backgroundImage = `/users/${currentShareKey}${scenarioState.backgroundImage}`;
    }

    // Load player tokens from campaign directory and NPC tokens from scenario directory
    const playerTokens = contextHelpers.tokens.loadPlayerTokens();
    const npcTokens = contextHelpers.tokens.loadNPCTokens();
    const props = loadProps();

    // Merge all tokens (players + NPCs) and props
    scenarioState.tokens = [...playerTokens, ...npcTokens];
    scenarioState.props = props;

    // Ensure revealZones and permanentlyRevealedZones exist
    if (!scenarioState.revealZones) {
      scenarioState.revealZones = [];
    }
    if (!scenarioState.permanentlyRevealedZones) {
      scenarioState.permanentlyRevealedZones = [];
    }

    return scenarioState;
  } catch (error) {
    console.error('Failed to load scenario game state:', error);
    return null;
  }
}

/**
 * Helper function to save scenario game state to file
 */
export function saveScenarioGameState(state) {
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = contextHelpers.getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, '.scenario-state.json');

  try {
    // Filter out tokens and props - they're saved separately
    const stateToSave = {
      ...state,
      tokens: [], // All tokens stored in separate files
      props: [] // All props stored in separate files
    };

    // Strip API URL prefix and sharekey prefix from backgroundImage before saving
    if (stateToSave.backgroundImage) {
      // Remove any http://localhost:3001 or similar prefixes
      let cleanPath = stateToSave.backgroundImage.replace(/^https?:\/\/[^\/]+/, '');
      // Strip sharekey prefix to store in old format
      if (cleanPath.startsWith(`/users/${currentShareKey}/`)) {
        cleanPath = cleanPath.replace(`/users/${currentShareKey}`, '');
      }
      stateToSave.backgroundImage = cleanPath;
    }

    console.log('saveScenarioGameState: Saving fogEnabled =', stateToSave.fogEnabled);

    if (isSessionActive && currentSessionName) {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, '.runtime-state.json');
      console.log('saveScenarioGameState: GAME MODE - saving to:', runtimePath);
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      fs.writeFileSync(runtimePath, JSON.stringify(stateToSave, null, 2));
      console.log('saveScenarioGameState: GAME MODE - file written successfully with fogEnabled =', stateToSave.fogEnabled);
    } else {
      // EDIT MODE: Save to definition, preserving lastSessionPlayed
      console.log('saveScenarioGameState: EDIT MODE - saving to scenario definition');
      let existingData = {};
      if (fs.existsSync(definitionPath)) {
        existingData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      }

      const finalState = {
        ...stateToSave,
        lastSessionPlayed: existingData.lastSessionPlayed // Preserve lastSessionPlayed
      };
      fs.writeFileSync(definitionPath, JSON.stringify(finalState, null, 2));
      console.log('saveScenarioGameState: EDIT MODE - file written to:', definitionPath);

      // Also save map metadata (fog settings, reveal zones, etc.)
      contextHelpers.saveMapMetadata(state);
    }
  } catch (error) {
    console.error('Failed to save scenario game state:', error);
  }
}

/**
 * Save a prop to scenario directory
 */
export function saveProp(prop) {
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = contextHelpers.getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'props');

  try {
    // Clone prop and strip sharekey prefix from image paths before saving
    const propToSave = { ...prop };
    if (propToSave.imageUrl && propToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      propToSave.imageUrl = propToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }

    // Also process states array for image URLs
    if (propToSave.states && Array.isArray(propToSave.states)) {
      propToSave.states = propToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName) {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, 'props');
      if (!fs.existsSync(runtimePath)) {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const propPath = path.join(runtimePath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    } else {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath)) {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const propPath = path.join(definitionPath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    }
  } catch (error) {
    console.error('Failed to save prop:', error);
  }
}

/**
 * Load props from scenario or session directory
 */
export function loadProps() {
  if (!currentCampaign || !currentScenario || !currentShareKey) return [];
  const campaignsDir = contextHelpers.getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  let propsPath = path.join(scenarioPath, 'props');

  if (isSessionActive && currentSessionName) {
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    propsPath = path.join(sessionPath, 'props');
    // If runtime props folder doesn't exist but definition exists, copy defaults
    const defPath = path.join(scenarioPath, 'props');
    if (!fs.existsSync(propsPath) && fs.existsSync(defPath)) {
      fs.mkdirSync(propsPath, { recursive: true });
      const files = fs.readdirSync(defPath).filter(f => f.endsWith('.json'));
      for (const f of files) {
        fs.copyFileSync(path.join(defPath, f), path.join(propsPath, f));
      }
    }
  }

  if (!fs.existsSync(propsPath)) return [];
  try {
    const files = fs.readdirSync(propsPath);
    const props = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = fs.readFileSync(path.join(propsPath, file), 'utf-8');
        const item = JSON.parse(data);
        // Fix image paths
        if (item.imageUrl && item.imageUrl.startsWith('/images/')) item.imageUrl = `/users/${currentShareKey}${item.imageUrl}`;
        if (item.states && Array.isArray(item.states)) {
          item.states = item.states.map(s => ({ ...s, imageUrl: s.imageUrl && s.imageUrl.startsWith('/images/') ? `/users/${currentShareKey}${s.imageUrl}` : s.imageUrl }));
        }
        props.push(item);
      } catch (err) {
        console.error('Failed to load prop file', file, err);
      }
    }
    return props;
  } catch (err) {
    console.error('Failed to load props:', err);
    return [];
  }
}

/**
 * Delete a prop from scenario directory
 */
export function deleteProp(propId) {
  const propsPath = getPropsPath();
  if (!propsPath) return;

  try {
    const propPath = path.join(propsPath, `${propId}.json`);
    if (fs.existsSync(propPath)) {
      fs.unlinkSync(propPath);
    }
  } catch (error) {
    console.error('Failed to delete prop:', error);
  }
}

/**
 * Get props path based on current context
 */
function getPropsPath() {
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const campaignsDir = contextHelpers.getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  let propsPath = path.join(scenarioPath, 'props');

  if (isSessionActive && currentSessionName) {
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    propsPath = path.join(sessionPath, 'props');
  }

  return propsPath;
}

/**
 * Start heartbeat monitoring for player tokens
 */
export function startHeartbeatMonitor() {
  setInterval(() => {
    const now = Date.now();
    const timeout = 10000; // 10 seconds
    let anyChanges = false;

    gameState.tokens.forEach(token => {
      if (token.actor?.player && token.active) {
        const lastSeen = playerHeartbeats.get(token.id);
        // Only deactivate if there's a heartbeat entry AND it's stale
        // Don't deactivate tokens that have never sent a heartbeat (they might just be loading)
        if (lastSeen && (now - lastSeen) > timeout) {
          console.log('Auto-deactivating stale player:', token.id, token.actor.name);
          token.active = false;
          anyChanges = true;

          // Save player token immediately
          contextHelpers.tokens.savePlayerToken(token);
        }
      }
    });

    // Save scenario state if any changes occurred
    if (anyChanges) {
      saveScenarioGameState(gameState);
      console.log('Saved updated game state after auto-deactivation');
    }
  }, 5000); // Check every 5 seconds
}

/**
 * Register game state API routes
 */
export function registerRoutes(app, helpers) {
  const express = helpers.express;
  const requireGM = helpers.requireGM;
  const fixTokenImagePaths = helpers.fixTokenImagePaths;

  // Get current game state (with optional session parameter for observer/player views)
  app.get('/api/game-state', (req, res) => {
    const { session, campaign } = req.query;

    // If campaign and session parameters provided, load from session metadata
    if (campaign && session) {
      try {
        // Observer view is public - try to get shareKey from user if authenticated,
        // otherwise look it up by searching share key directories
        let shareKey = req.user?.currentShareKey;

        if (!shareKey) {
          // Public access - need to find which share key directory contains this campaign
          const usersDir = path.join(path.dirname(contextHelpers.usersDir || './'), 'users');
          const shareKeyDirs = fs.readdirSync(usersDir);
          for (const dir of shareKeyDirs) {
            // Skip special directories like 'sessions'
            if (dir === 'sessions') continue;

            const shareKeyPath = path.join(usersDir, dir);
            const campaignsPath = path.join(shareKeyPath, 'campaigns', campaign);
            if (fs.existsSync(campaignsPath)) {
              // Found the campaign - dir is the share key
              shareKey = dir;
              break;
            }
          }

          if (!shareKey) {
            return res.status(404).json({ error: 'Campaign not found' });
          }
        }

        const campaignsDir = contextHelpers.getShareKeyCampaignsDir(shareKey);
        const campaignPath = path.join(campaignsDir, campaign);
        const sessionPath = path.join(campaignPath, 'sessions', session);
        const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

        if (!fs.existsSync(sessionMetadataPath)) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Read session metadata to determine current scenario
        const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
        const scenario = sessionMetadata.currentScenario;

        // Load state from session/scenario folder
        const sessionScenarioPath = path.join(sessionPath, 'scenarios', scenario);
        const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');

        if (!fs.existsSync(sessionStatePath)) {
          return res.status(404).json({ error: 'Session scenario state not found' });
        }

        const sessionStateData = fs.readFileSync(sessionStatePath, 'utf-8');
        const sessionState = JSON.parse(sessionStateData);

        console.log('GET /api/game-state: Loaded session state from', sessionStatePath, 'with fogEnabled =', sessionState.fogEnabled);

        // Fix background image URL to include share key prefix
        if (sessionState.backgroundImage) {
          if (sessionState.backgroundImage.startsWith('/images/')) {
            // Old path format - prepend sharekey
            sessionState.backgroundImage = `/users/${shareKey}${sessionState.backgroundImage}`;
          } else if (!sessionState.backgroundImage.startsWith('/users/') && !sessionState.backgroundImage.startsWith('http')) {
            // Bare filename - assume it's in the maps folder
            sessionState.backgroundImage = `/users/${shareKey}/images/maps/${sessionState.backgroundImage}`;
          }
        }

        // Load tokens from session/scenario folder
        const playerTokens = [];
        const npcTokens = [];
        const props = [];

        // Load player tokens from session
        const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
        if (fs.existsSync(sessionPlayerTokensPath)) {
          const files = fs.readdirSync(sessionPlayerTokensPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const tokenData = fs.readFileSync(path.join(sessionPlayerTokensPath, file), 'utf-8');
              const token = JSON.parse(tokenData);
              // Ensure image paths have the sharekey prefix
              if (token.imageUrl) {
                if (token.imageUrl.startsWith('/images/')) {
                  token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
                } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http')) {
                  token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
                }
              }
              if (token.portraitUrl) {
                if (token.portraitUrl.startsWith('/images/')) {
                  token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
                } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http')) {
                  token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
                }
              }
              playerTokens.push(token);
            }
          }
        }

        // Load NPC tokens from session
        const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
        if (fs.existsSync(sessionNPCTokensPath)) {
          const files = fs.readdirSync(sessionNPCTokensPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const tokenData = fs.readFileSync(path.join(sessionNPCTokensPath, file), 'utf-8');
              const token = JSON.parse(tokenData);
              // Ensure image paths have the sharekey prefix
              if (token.imageUrl) {
                if (token.imageUrl.startsWith('/images/')) {
                  token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
                } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http')) {
                  token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
                }
              }

              if (token.states) {
                for (const state of token.states) {
                  if (state.imageUrl) {
                    if (state.imageUrl.startsWith('/images/')) {
                      state.imageUrl = `/users/${shareKey}${state.imageUrl}`;
                    } else if (!state.imageUrl.startsWith('/users/') && !state.imageUrl.startsWith('http')) {
                      state.imageUrl = `/users/${shareKey}/images/token/${state.imageUrl}`;
                    }
                  }
                }
              }

              if (token.portraitUrl) {
                if (token.portraitUrl.startsWith('/images/')) {
                  token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
                } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http')) {
                  token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
                }
              }
              npcTokens.push(token);
            }
          }
        }

        // Load props from session
        const sessionPropsPath = path.join(sessionScenarioPath, 'props');
        if (fs.existsSync(sessionPropsPath)) {
          const files = fs.readdirSync(sessionPropsPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const propData = fs.readFileSync(path.join(sessionPropsPath, file), 'utf-8');
              const prop = JSON.parse(propData);
              // Ensure image paths have the sharekey prefix
              if (prop.imageUrl) {
                if (prop.imageUrl.startsWith('/images/')) {
                  prop.imageUrl = `/users/${shareKey}${prop.imageUrl}`;
                } else if (!prop.imageUrl.startsWith('/users/') && !prop.imageUrl.startsWith('http')) {
                  prop.imageUrl = `/users/${shareKey}/images/props/${prop.imageUrl}`;
                }
              }

              if (prop.states) {
                for (const state of prop.states) {
                  if (state.imageUrl) {
                    if (state.imageUrl.startsWith('/images/')) {
                      state.imageUrl = `/users/${shareKey}${state.imageUrl}`;
                    } else if (!state.imageUrl.startsWith('/users/') && !state.imageUrl.startsWith('http')) {
                      state.imageUrl = `/users/${shareKey}/images/props/${state.imageUrl}`;
                    }
                  }
                }
              }
              props.push(prop);
            }
          }
        }

        sessionState.tokens = [...playerTokens, ...npcTokens];
        sessionState.props = props;

        // Ensure showObserverCards has a default value if not set
        if (sessionState.showObserverCards === undefined) {
          sessionState.showObserverCards = true;
        }

        // Ensure revealZones and permanentlyRevealedZones exist
        if (!sessionState.revealZones) {
          sessionState.revealZones = [];
        }
        if (!sessionState.permanentlyRevealedZones) {
          sessionState.permanentlyRevealedZones = [];
        }

        // Check if this session is currently active
        const isThisSessionActive = (isSessionActive && currentCampaign === campaign && currentSessionName === session);

        return res.json({
          state: sessionState,
          sessionActive: isThisSessionActive,
          sessionName: session,
          campaignName: campaign,
          scenarioName: scenario
        });
      } catch (error) {
        console.error('Failed to load session state:', error);
        return res.status(500).json({ error: 'Failed to load session state' });
      }
    }

    // Default: return current gameState
    // In edit mode, reload tokens and props from disk to ensure they're fresh
    if (currentCampaign && currentScenario) {
      const playerTokens = contextHelpers.tokens.loadPlayerTokens();
      const npcTokens = contextHelpers.tokens.loadNPCTokens();
      gameState.tokens = [...playerTokens, ...npcTokens];
      gameState.props = loadProps();
    }

    // Fix image paths to use share key paths before sending to client
    if (currentShareKey) {
      gameState.tokens = gameState.tokens.map(token => fixTokenImagePaths(token, currentShareKey));
      gameState.props = gameState.props.map(prop => fixTokenImagePaths(prop, currentShareKey));
    }

    res.json({ state: gameState, sessionActive: isSessionActive });
  });

  // Update game state (and save to map JSON)
  app.post('/api/game-state', requireGM, express.json(), (req, res) => {
    const { state } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State required' });
    }

    console.log('Server: POST /api/game-state received, fogEnabled =', state.fogEnabled, 'isSessionActive =', isSessionActive, 'currentSessionName =', currentSessionName);

    // Update in-memory state (last write wins)
    gameState = { ...state };

    // Separate player tokens from NPC tokens
    const playerTokens = gameState.tokens.filter(t => t.actor?.player);
    const npcTokens = gameState.tokens.filter(t => !t.actor?.player);

    // Save current player tokens individually to campaign directory
    for (const playerToken of playerTokens) {
      contextHelpers.tokens.savePlayerToken(playerToken);
    }

    // Save current NPC tokens individually to scenario directory
    for (const npcToken of npcTokens) {
      contextHelpers.tokens.saveNPCToken(npcToken);
    }

    // Handle props if they exist in state
    if (gameState.props && Array.isArray(gameState.props)) {
      const existingProps = loadProps();

      // Save current props individually to scenario directory
      for (const prop of gameState.props) {
        saveProp(prop);
      }

      // Delete any props that exist on disk but not in current state
      const currentPropIds = new Set(gameState.props.map(p => p.id));
      for (const existingProp of existingProps) {
        if (!currentPropIds.has(existingProp.id)) {
          deleteProp(existingProp.id);
        }
      }
    }

    // Save scenario-level game state (tokens now stored separately)
    saveScenarioGameState(gameState);

    res.json({ success: true });
  });

  // Player heartbeat endpoint
  app.post('/api/player-heartbeat', express.json(), (req, res) => {
    const { tokenId } = req.body;

    if (tokenId) {
      playerHeartbeats.set(tokenId, Date.now());

      // Find the token and set it to active
      const token = gameState.tokens.find(t => t.id === tokenId);
      if (token) {
        if (!token.active) {
          console.log('Activating player token:', tokenId, token.actor?.name);
          token.active = true;

          // Save player token immediately if it's a player token
          if (token.actor?.player) {
            contextHelpers.tokens.savePlayerToken(token);
          }

          // Save scenario state
          saveScenarioGameState(gameState);
        }
      } else {
        console.log('Heartbeat for unknown token:', tokenId);
      }
    }

    res.json({ success: true });
  });

  // Deactivate a player token (for page unload)
  app.post('/api/deactivate-token', express.json(), (req, res) => {
    console.log('Deactivate token request received:', req.body);

    const { tokenId } = req.body;

    if (!tokenId) {
      console.log('No tokenId provided');
      return res.status(400).json({ error: 'Token ID required' });
    }

    // Update token active state in memory
    const tokenToUpdate = gameState.tokens.find(t => t.id === tokenId);

    if (tokenToUpdate) {
      tokenToUpdate.active = false;
      console.log('Deactivated token in memory:', tokenId, tokenToUpdate.actor?.name);

      // If it's a player token, save it separately
      if (tokenToUpdate.actor?.player) {
        contextHelpers.tokens.savePlayerToken(tokenToUpdate);
        console.log('Saved player token to file:', tokenId);
      }

      // Save scenario state
      saveScenarioGameState(gameState);
    } else {
      console.log('Token not found:', tokenId);
    }

    res.json({ success: true });
  });

  // Update revealed path (for fog reveal tracking)
  app.post('/api/update-revealed-path', express.json(), (req, res) => {
    console.log('Update revealed path request:', req.body);
    console.log('Current session state - campaign:', currentCampaign, 'scenario:', currentScenario, 'sessionActive:', isSessionActive, 'sessionName:', currentSessionName);

    const { revealedPath } = req.body;

    if (!Array.isArray(revealedPath)) {
      return res.status(400).json({ error: 'revealedPath must be an array' });
    }

    // Update game state
    gameState.revealedPath = revealedPath;

    console.log(`Updated revealedPath with ${revealedPath.length} points`);
    console.log('gameState.revealedPath is now:', gameState.revealedPath);

    // Save scenario state
    saveScenarioGameState(gameState);

    console.log('Scenario game state saved');

    res.json({ success: true, revealedPath });
  });
}
