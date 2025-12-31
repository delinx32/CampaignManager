
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { registerImageRoutes } from './images.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { passport, sessionMiddleware, requireAuth, requireGM, isOAuthConfigured, registerAuthRoutes, shareKeyExists, loadShareKeyData, saveShareKeyData } from './auth.js';

// Load environment variables from .env file in parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Load settings.json for API keys
let googleSearchApiKey = null;
let googleSearchEngineId = null;
try
{
  const settingsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings.json');
  if (fs.existsSync(settingsPath))
  {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    googleSearchApiKey = settings.googleSearchApiKey || null;
    googleSearchEngineId = settings.googleSearchEngineId || null;
  }
} catch (err)
{
  console.warn('Could not read settings.json:', err?.message || err);
  // Ensure users directory exists
  try {
    const usersDir = path.join(__dirname, 'users');
    if (!fs.existsSync(usersDir)) {
      fs.mkdirSync(usersDir, { recursive: true });
    }
  } catch (mkdirErr) {
    console.error('Failed to ensure users directory exists:', mkdirErr);
  }
}

// Application and directories
const app = express();
// Allow requests from the frontend dev server and permit credentials (cookies)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

const usersDir = path.join(__dirname, 'users');

// Get list of all uploaded maps (excludes actor images)
app.get('/api/maps', requireAuth, (req, res) =>
{
  // Maps are now stored in campaign/scenario folders, not a global maps folder
  // This endpoint is deprecated - maps should be accessed via scenario endpoints
  res.json({ maps: [], message: 'Maps are stored per-scenario. Use scenario endpoints instead.' });
});

// Image endpoints moved to server/images.js via registerImageRoutes

// Image routes have been moved to server/images.js; registered earlier via registerImageRoutes

// Get map metadata (deprecated - maps are now stored per-scenario)
app.get('/api/map-metadata/:filename', requireAuth, (req, res) =>
{
  // This endpoint is deprecated - map metadata is now stored with scenarios
  // Return default metadata for backwards compatibility
  res.json({
    gridColumns: 20,
    gridRows: 20,
    lightingCondition: 'bright',
    fogEnabled: 'off-gm',
    fogRevealDistance: 3,
    showGrid: true
  });
});

// Save map metadata (deprecated - maps are now stored per-scenario)
app.post('/api/map-metadata/:filename', requireGM, (req, res) =>
{
  // This endpoint is deprecated - map metadata is now stored with scenarios
  res.json({ success: true, message: 'Map metadata should be saved via scenario endpoints' });
});

// In-memory game state storage
let currentCampaign = null;
let currentScenario = null;
let currentUserId = null; // Track current user
let currentShareKey = null; // Track current share key for file paths
let currentSessionName = null; // Track current session name
let isSessionActive = false; // Track if we're in game mode
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

// ===========================
// WebSocket Management
// ===========================

// Track connected WebSocket clients by session
// Format: { "campaignName/sessionName": Set<WebSocket> }
import { sessionConnections, broadcast } from './sessions.js';

// Token utilities (module) - set context early so other helpers can use it
import * as tokens from './tokens.js';
tokens.setContext({
  getCurrentCampaign: () => currentCampaign,
  getCurrentScenario: () => currentScenario,
  getCurrentShareKey: () => currentShareKey,
  isSessionActive: () => isSessionActive,
  getCurrentSessionName: () => currentSessionName,
  getShareKeyCampaignsDir,
  fs,
  path
});

// ===========================
// Register Authentication Routes
// ===========================
// Now that game state variables are initialized, register auth routes
registerAuthRoutes(app, {
  currentShareKey: () => currentShareKey,
  currentCampaign: () => currentCampaign,
  currentSessionName: () => currentSessionName,
  currentScenario: () => currentScenario,
  isSessionActive: () => isSessionActive,
  usersDir
});

// Register image routes (moved to server/images.js)
registerImageRoutes(app, {
  usersDir,
  requireAuth,
  requireGM,
  provideShareKey,
  googleSearchApiKey,
  googleSearchEngineId,
  __dirname
});

// Local bindings for token helpers provided by `server/tokens.js`
const loadPlayerTokens = tokens.loadPlayerTokens;
const savePlayerToken = tokens.savePlayerToken;
const deletePlayerToken = tokens.deletePlayerToken;
const getPlayerTokensPath = tokens.getPlayerTokensPath;
const loadNPCTokens = tokens.loadNPCTokens;
const saveNPCToken = tokens.saveNPCToken;
const deleteNPCToken = tokens.deleteNPCToken;
const getNPCTokensPath = tokens.getNPCTokensPath;

// Auto-deactivate players that haven't sent heartbeat in 10 seconds
setInterval(() =>
{
  const now = Date.now();
  const timeout = 10000; // 10 seconds
  let anyChanges = false;

  gameState.tokens.forEach(token =>
  {
    if (token.actor?.player && token.active)
    {
      const lastSeen = playerHeartbeats.get(token.id);
      // Only deactivate if there's a heartbeat entry AND it's stale
      // Don't deactivate tokens that have never sent a heartbeat (they might just be loading)
      if (lastSeen && (now - lastSeen) > timeout)
      {
        console.log('Auto-deactivating stale player:', token.id, token.actor.name);
        token.active = false;
        anyChanges = true;

        // Save player token immediately
        savePlayerToken(token);
      }
    }
  });

  // Save scenario state if any changes occurred
  if (anyChanges)
  {
    saveScenarioGameState(gameState);
    console.log('Saved updated game state after auto-deactivation');
  }
}, 5000); // Check every 5 seconds

// Helper function to fix legacy image paths to use share key paths
function fixImagePath(imagePath, shareKey)
{
  if (!imagePath || !shareKey) return imagePath;
  if (imagePath.startsWith('http')) return imagePath; // Already absolute URL

  // If it's a legacy /images/ path, convert to share key path
  if (imagePath.startsWith('/images/'))
  {
    return `/users/${shareKey}${imagePath}`;
  }

  return imagePath;
}

// Helper function to fix image paths in a token or prop
function fixTokenImagePaths(item, shareKey)
{
  if (!item || !shareKey) return item;

  // Fix base image URL
  if (item.imageUrl)
  {
    item.imageUrl = fixImagePath(item.imageUrl, shareKey);
  }

  // Fix state image URLs
  if (item.states && Array.isArray(item.states))
  {
    item.states = item.states.map(state => ({
      ...state,
      imageUrl: state.imageUrl ? fixImagePath(state.imageUrl, shareKey) : state.imageUrl
    }));
  }

  return item;
}

// Helper function to get scenario game state file path
function getScenarioGameStatePath()
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);

  if (isSessionActive && currentSessionName)
  {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, '.runtime-state.json');
  }

  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);
  return path.join(scenarioPath, '.scenario-state.json');
}

// Helper function to load scenario game state from file
function loadScenarioGameState()
{
  const statePath = getScenarioGameStatePath();
  if (!statePath || !fs.existsSync(statePath))
  {
    return null;
  }

  try
  {
    const data = fs.readFileSync(statePath, 'utf-8');
    const scenarioState = JSON.parse(data);

    // Convert old image paths to sharekey-based paths
    if (scenarioState.backgroundImage && scenarioState.backgroundImage.startsWith('/images/'))
    {
      scenarioState.backgroundImage = `/users/${currentShareKey}${scenarioState.backgroundImage}`;
    }

    // Load player tokens from campaign directory and NPC tokens from scenario directory
    const playerTokens = loadPlayerTokens();
    const npcTokens = loadNPCTokens();
    const props = loadProps();

    // Merge all tokens (players + NPCs) and props
    scenarioState.tokens = [...playerTokens, ...npcTokens];
    scenarioState.props = props;

    // Ensure revealZones and permanentlyRevealedZones exist
    if (!scenarioState.revealZones)
    {
      scenarioState.revealZones = [];
    }
    if (!scenarioState.permanentlyRevealedZones)
    {
      scenarioState.permanentlyRevealedZones = [];
    }

    return scenarioState;
  } catch (error)
  {
    console.error('Failed to load scenario game state:', error);
    return null;
  }
}

// Helper function to save scenario game state to file
function saveScenarioGameState(state)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, '.scenario-state.json');

  try
  {
    // Filter out tokens and props - they're saved separately
    const stateToSave = {
      ...state,
      tokens: [], // All tokens stored in separate files
      props: [] // All props stored in separate files
    };

    // Strip API URL prefix and sharekey prefix from backgroundImage before saving
    if (stateToSave.backgroundImage)
    {
      // Remove any http://localhost:3001 or similar prefixes
      let cleanPath = stateToSave.backgroundImage.replace(/^(https?:\/\/[^\/]+)+/g, '');
      // Strip sharekey prefix to store in old format
      if (cleanPath.startsWith(`/users/${currentShareKey}/`))
      {
        cleanPath = cleanPath.replace(`/users/${currentShareKey}`, '');
      }
      stateToSave.backgroundImage = cleanPath;
    }

    console.log('saveScenarioGameState: Saving fogEnabled =', stateToSave.fogEnabled);

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, '.runtime-state.json');
      console.log('saveScenarioGameState: GAME MODE - saving to:', runtimePath);
      if (!fs.existsSync(sessionPath))
      {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      fs.writeFileSync(runtimePath, JSON.stringify(stateToSave, null, 2));
      console.log('saveScenarioGameState: GAME MODE - file written successfully with fogEnabled =', stateToSave.fogEnabled);
    } else
    {
      // EDIT MODE: Save to definition, preserving lastSessionPlayed
      console.log('saveScenarioGameState: EDIT MODE - saving to scenario definition');
      let existingData = {};
      if (fs.existsSync(definitionPath))
      {
        existingData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      }

      const finalState = {
        ...stateToSave,
        lastSessionPlayed: existingData.lastSessionPlayed // Preserve lastSessionPlayed
      };
      fs.writeFileSync(definitionPath, JSON.stringify(finalState, null, 2));
      console.log('saveScenarioGameState: EDIT MODE - file written to:', definitionPath);

      // Also save map metadata (fog settings, reveal zones, etc.)
      saveMapMetadata(state);
    }
  } catch (error)
  {
    console.error('Failed to save scenario game state:', error);
  }
}

// Helper function to save map metadata (fog settings, reveal zones, etc.)
function saveMapMetadata(state)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;
  if (!state.backgroundImage) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);

  // Extract filename from backgroundImage path
  const filename = state.backgroundImage.split('/').pop();
  if (!filename) return;

  const metadataPath = path.join(scenarioPath, ".scenario-state.json");

  try
  {
    // Read existing metadata if it exists
    let existingMetadata = {};
    if (fs.existsSync(metadataPath))
    {
      existingMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    }

    // Update metadata with current state
    const updatedMetadata = {
      ...existingMetadata,
      fogEnabled: state.fogEnabled,
      fogRevealDistance: state.fogRevealDistance,
      lightingCondition: state.lightingCondition,
      revealedPath: state.revealedPath || [],
      revealZones: state.revealZones || [],
      permanentlyRevealedZones: state.permanentlyRevealedZones || [],
      gridColumns: state.gridColumns,
      gridRows: state.gridRows,
      showGrid: state.showGrid
    };

    if (state.gridCellDistance !== undefined)
    {
      updatedMetadata.gridCellDistance = state.gridCellDistance;
    }

    fs.writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2));

  } catch (error)
  {
    console.error('Failed to save map metadata:', error);
  }
}

// Token helpers are initialized earlier and provided by `server/tokens.js`
// Local bindings were declared above; no-op here to avoid redeclaration

// Register token-related HTTP endpoints from tokens module
if (typeof tokens.registerRoutes === 'function')
{
  tokens.registerRoutes(app, { gameState, saveScenarioGameState });
}

// Player token save logic moved to `server/tokens.js`
// See: server/tokens.js:savePlayerToken

// Player token delete moved to `server/tokens.js`
// See: server/tokens.js:deletePlayerToken

// NPC token loading/saving moved to `server/tokens.js`
// See: server/tokens.js:loadNPCTokens, saveNPCToken, deleteNPCToken

// Helper function to save a prop to scenario directory
function saveProp(prop)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'props');

  try
  {
    // Clone prop and strip sharekey prefix from image paths before saving
    const propToSave = { ...prop };
    if (propToSave.imageUrl && propToSave.imageUrl.startsWith(`/users/${currentShareKey}/`))
    {
      propToSave.imageUrl = propToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }

    // Also process states array for image URLs
    if (propToSave.states && Array.isArray(propToSave.states))
    {
      propToSave.states = propToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, 'props');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const propPath = path.join(runtimePath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const propPath = path.join(definitionPath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    }
  } catch (error)
  {
    console.error('Failed to save prop:', error);
  }
}

// Helper to load props from scenario or session directory
function loadProps()
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return [];
  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  let propsPath = path.join(scenarioPath, 'props');

  if (isSessionActive && currentSessionName)
  {
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    propsPath = path.join(sessionPath, 'props');
    // If runtime props folder doesn't exist but definition exists, copy defaults
    const defPath = path.join(scenarioPath, 'props');
    if (!fs.existsSync(propsPath) && fs.existsSync(defPath))
    {
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

// Helper function to delete a prop from scenario directory
function deleteProp(propId)
{
  const propsPath = getPropsPath();
  if (!propsPath) return;

  try
  {
    const propPath = path.join(propsPath, `${propId}.json`);
    if (fs.existsSync(propPath))
    {
      fs.unlinkSync(propPath);
    }
  } catch (error)
  {
    console.error('Failed to delete prop:', error);
  }
}

// Helper function to get share key's campaigns directory
function getShareKeyCampaignsDir(shareKey)
{
  const shareKeyDir = path.join(usersDir, shareKey, 'campaigns');
  if (!fs.existsSync(shareKeyDir))
  {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

// Initialize scenarioState module and provide runtime getters/helpers
import * as scenarioState from './scenarioState.js';
scenarioState.setContext({
  getCurrentCampaign: () => currentCampaign,
  getCurrentScenario: () => currentScenario,
  getCurrentShareKey: () => currentShareKey,
  isSessionActive: () => isSessionActive,
  getCurrentSessionName: () => currentSessionName,
  getShareKeyCampaignsDir,
  loadPlayerTokens,
  loadNPCTokens,
  loadProps,
  savePlayerToken,
  fs,
  path,
  saveMapMetadata
});

// Override local function references to use scenarioState implementations
loadScenarioGameState = scenarioState.loadScenarioGameState;
saveScenarioGameState = scenarioState.saveScenarioGameState;
getScenarioGameStatePath = scenarioState.getScenarioGameStatePath;

// Helper function to get share key's archived campaigns directory
function getShareKeyArchivedCampaignsDir(shareKey)
{
  const shareKeyDir = path.join(usersDir, shareKey, 'archived-campaigns');
  if (!fs.existsSync(shareKeyDir))
  {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

// Middleware to provide a shareKey on req for routes that operate on user folders
function provideShareKey(req, res, next)
{
  // Priority: explicit query param, header, authenticated user's currentShareKey, or global currentShareKey
  const candidate = (req.query && req.query.shareKey) || req.headers['x-share-key'] || (req.user && req.user.currentShareKey) || currentShareKey;
  if (!candidate)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  // Normalize candidate
  const shareKey = String(candidate).toLowerCase();

  // Verify the share key exists
  if (!shareKeyExists(shareKey))
  {
    return res.status(404).json({ error: 'Share key not found' });
  }

  req.shareKey = shareKey;
  return next();
}

// Helper functions are provided by auth.js (share-key data helpers).
// Legacy wrappers were removed; callers updated to use share-key helpers directly.

function getAllUserKeys()
{
  const keys = new Map(); // Map of key -> userId
  if (!fs.existsSync(usersDir)) return keys;

  const userDirs = fs.readdirSync(usersDir).filter(file =>
  {
    const stat = fs.statSync(path.join(usersDir, file));
    return stat.isDirectory();
  });

  for (const userId of userDirs)
  {
    const userData = loadShareKeyData(userId);
    if (userData.key)
    {
      keys.set(userData.key, userId);
    }
  }

  return keys;
}

// Share Key Management APIs are now handled by the auth module
// (See auth.js for registerAuthRoutes)

// User Management APIs (deprecated /api/user/key endpoint removed - use share keys instead)

app.patch('/api/user/openai-key', requireGM, express.json(), (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const { openaiApiKey } = req.body;

  if (!openaiApiKey || typeof openaiApiKey !== 'string')
  {
    return res.status(400).json({ error: 'OpenAI API key is required' });
  }

  // Basic validation - OpenAI keys should start with 'sk-'
  if (!openaiApiKey.startsWith('sk-'))
  {
    return res.status(400).json({ error: 'Invalid OpenAI API key format' });
  }

  // Update share key data file
  const shareKeyData = loadShareKeyData(shareKey);
  shareKeyData.openaiApiKey = openaiApiKey;
  saveShareKeyData(shareKey, shareKeyData);

  res.json({ success: true });
});

app.get('/api/user/openai-key', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.json({ hasKey: false, maskedKey: null });
  }

  const shareKeyData = loadShareKeyData(shareKey);

  // Return masked version for security
  const hasKey = !!shareKeyData.openaiApiKey;
  const maskedKey = hasKey
    ? `${shareKeyData.openaiApiKey.substring(0, 7)}...${shareKeyData.openaiApiKey.substring(shareKeyData.openaiApiKey.length - 4)}`
    : null;

  res.json({ hasKey, maskedKey });
});

// Get GM list
app.get('/api/user/gms', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.json({ gms: [] });
  }

  const shareKeyData = loadShareKeyData(shareKey);

  res.json({ gms: shareKeyData.gms || [] });
});

// Add a GM
app.post('/api/user/gms', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@'))
  {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const shareKeyData = loadShareKeyData(shareKey);
  if (!shareKeyData.gms)
  {
    shareKeyData.gms = [];
  }

  // Don't add duplicates
  if (shareKeyData.gms.includes(email))
  {
    return res.status(400).json({ error: 'GM already exists' });
  }

  shareKeyData.gms.push(email);
  saveShareKeyData(shareKey, shareKeyData);

  res.json({ gms: shareKeyData.gms });
});

// Remove a GM
app.delete('/api/user/gms', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string')
  {
    return res.status(400).json({ error: 'Email is required' });
  }

  const shareKeyData = loadShareKeyData(shareKey);
  if (!shareKeyData.gms)
  {
    shareKeyData.gms = [];
  }

  shareKeyData.gms = shareKeyData.gms.filter(gm => gm !== email);
  saveShareKeyData(shareKey, shareKeyData);

  res.json({ gms: shareKeyData.gms });
});

// Campaign Management APIs
app.get('/api/campaigns', (req, res) =>
{
  // Allow unauthenticated listing when a shareKey is provided via query or header
  let shareKey = (req.query && req.query.shareKey) || req.headers['x-share-key'] || (req.user && req.user.currentShareKey) || currentShareKey;
  if (shareKey) shareKey = String(shareKey).toLowerCase();

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected. Please create or select a share key.' });
  }

  if (!shareKeyExists(shareKey))
  {
    return res.status(404).json({ error: 'Share key not found' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(shareKey);

  // Ensure user directory exists when they access campaign screen
  if (!fs.existsSync(userCampaignsDir))
  {
    fs.mkdirSync(userCampaignsDir, { recursive: true });
    console.log(`✓ Created campaigns directory for share key: ${shareKey}`);
  }

  fs.readdir(userCampaignsDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read campaigns directory' });
    }

    const campaigns = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(userCampaignsDir, file));
        return stat.isDirectory();
      })
      .map(campaignName =>
      {
        const campaignPath = path.join(userCampaignsDir, campaignName);
        const scenariosPath = path.join(campaignPath, 'scenarios');

        // Count scenarios in the scenarios/ subfolder
        let scenarioCount = 0;
        if (fs.existsSync(scenariosPath))
        {
          const scenarios = fs.readdirSync(scenariosPath).filter(file =>
          {
            const stat = fs.statSync(path.join(scenariosPath, file));
            return stat.isDirectory();
          });
          scenarioCount = scenarios.length;
        }

        // Try to load metadata
        const metadataPath = path.join(campaignPath, '.metadata.json');
        let description = '';
        let backgroundImage = undefined;
        if (fs.existsSync(metadataPath))
        {
          try
          {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            description = metadata.description || '';
            // Convert old image paths to sharekey-based paths
            if (metadata.backgroundImage)
            {
              if (metadata.backgroundImage.startsWith('/images/'))
              {
                backgroundImage = `/users/${shareKey}${metadata.backgroundImage}`;
              } else
              {
                backgroundImage = metadata.backgroundImage;
              }
            }
          } catch (err)
          {
            console.error('Error reading campaign metadata:', err);
          }
        }

        return {
          name: campaignName,
          scenarioCount,
          description,
          backgroundImage
        };
      });

    res.json({ campaigns });
  });
});

app.post('/api/campaigns', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { name } = req.body;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(shareKey);

  if (!name)
  {
    return res.status(400).json({ error: 'Campaign name required' });
  }

  const campaignPath = path.join(userCampaignsDir, name);

  if (fs.existsSync(campaignPath))
  {
    return res.status(400).json({ error: 'Campaign already exists' });
  }

  fs.mkdirSync(campaignPath, { recursive: true });
  res.json({ success: true, name });
});

app.patch('/api/campaigns/:campaignName', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const oldName = req.params.campaignName;
  const { name: newName, description, backgroundImage } = req.body;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(userCampaignsDir, oldName);
  const metadataPath = path.join(campaignPath, '.metadata.json');

  try
  {
    // Read existing metadata or create new one
    let metadata = { description: '' };
    if (fs.existsSync(metadataPath))
    {
      try
      {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err)
      {
        console.error('Error reading metadata, using defaults:', err);
      }
    }

    // Update fields if provided
    if (description !== undefined)
    {
      metadata.description = description;
    }
    if (backgroundImage !== undefined)
    {
      metadata.backgroundImage = backgroundImage;
    }

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Rename folder if name changed
    if (newName && newName !== oldName)
    {
      if (currentCampaign === oldName)
      {
        return res.status(400).json({
          error: 'Cannot rename the current active campaign. Please select a different campaign first.'
        });
      }

      const newPath = path.join(userCampaignsDir, newName);
      if (fs.existsSync(newPath))
      {
        return res.status(400).json({ error: 'A campaign with this name already exists' });
      }

      // Use copy + delete approach to avoid permission issues with rename
      try
      {
        fs.cpSync(campaignPath, newPath, { recursive: true });
        fs.rmSync(campaignPath, { recursive: true, force: true });
      } catch (renameError)
      {
        if (fs.existsSync(newPath))
        {
          fs.rmSync(newPath, { recursive: true, force: true });
        }
        throw new Error('Campaign folder may be in use. Please close any open files and try again.');
      }
    }

    res.json({ success: true });
  } catch (error)
  {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: error.message || 'Failed to update campaign' });
  }
});

app.delete('/api/campaigns/:campaignName', requireGM, provideShareKey, (req, res) =>
{
  const campaignName = req.params.campaignName;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(shareKey);
  const userArchivedDir = getShareKeyArchivedCampaignsDir(shareKey);
  const campaignPath = path.join(userCampaignsDir, campaignName);

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Create archived campaign path with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedPath = path.join(userArchivedDir, `${campaignName}_${timestamp}`);

  try
  {
    // Use copy + delete approach to avoid Windows permission issues
    fs.cpSync(campaignPath, archivedPath, { recursive: true });
    fs.rmSync(campaignPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Campaign archived successfully' });
  } catch (error)
  {
    console.error('Error archiving campaign:', error);
    // Clean up partial copy if it exists
    if (fs.existsSync(archivedPath))
    {
      try
      {
        fs.rmSync(archivedPath, { recursive: true, force: true });
      } catch (cleanupErr)
      {
        console.error('Failed to cleanup after failed archive:', cleanupErr);
      }
    }
    res.status(500).json({ error: 'Failed to archive campaign' });
  }
});

// Archive a scenario
app.delete('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, scenarioName } = req.params;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const scenarioPath = path.join(scenariosPath, scenarioName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  // Create archived scenarios path with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedPath = path.join(archivedScenariosPath, `${scenarioName}_${timestamp}`);

  try
  {
    // Use copy + delete approach to avoid Windows permission issues
    fs.cpSync(scenarioPath, archivedPath, { recursive: true });
    fs.rmSync(scenarioPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Scenario archived successfully' });
  } catch (error)
  {
    console.error('Error archiving scenario:', error);
    // Clean up partial copy if it exists
    if (fs.existsSync(archivedPath))
    {
      try
      {
        fs.rmSync(archivedPath, { recursive: true, force: true });
      } catch (cleanupErr)
      {
        console.error('Failed to cleanup after failed archive:', cleanupErr);
      }
    }
    res.status(500).json({ error: 'Failed to archive scenario' });
  }
});

// Get archived scenarios for a campaign
app.get('/api/campaigns/:campaignName/archived-scenarios', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName } = req.params;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.json({ archived: [] });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

  if (!fs.existsSync(archivedScenariosPath))
  {
    return res.json({ archived: [] });
  }

  fs.readdir(archivedScenariosPath, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read archived scenarios' });
    }

    const archived = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(archivedScenariosPath, file));
        return stat.isDirectory();
      })
      .map(folderName =>
      {
        // Extract original name and timestamp from folder name
        const lastUnderscore = folderName.lastIndexOf('_');
        const originalName = folderName.substring(0, lastUnderscore);
        const timestamp = folderName.substring(lastUnderscore + 1);

        return {
          folderName,
          originalName,
          archivedAt: timestamp
        };
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)); // Most recent first

    res.json({ archived });
  });
});

// Restore archived scenario
app.post('/api/campaigns/:campaignName/archived-scenarios/:folderName/restore', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, folderName } = req.params;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const archivedPath = path.join(archivedScenariosPath, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived scenario not found' });
  }

  // Extract original name
  const lastUnderscore = folderName.lastIndexOf('_');
  const originalName = folderName.substring(0, lastUnderscore);
  const restoredPath = path.join(scenariosPath, originalName);

  // Check if a scenario with the same name already exists
  if (fs.existsSync(restoredPath))
  {
    return res.status(400).json({ error: 'A scenario with this name already exists' });
  }

  try
  {
    // Move archived folder back to scenarios
    fs.renameSync(archivedPath, restoredPath);
    res.json({ success: true, message: 'Scenario restored successfully' });
  } catch (error)
  {
    console.error('Error restoring scenario:', error);
    res.status(500).json({ error: 'Failed to restore scenario' });
  }
});

// Permanently delete archived scenario
app.delete('/api/campaigns/:campaignName/archived-scenarios/:folderName', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, folderName } = req.params;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
  const archivedPath = path.join(archivedScenariosPath, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived scenario not found' });
  }

  try
  {
    // Permanently delete the archived folder
    fs.rmSync(archivedPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Scenario permanently deleted' });
  } catch (error)
  {
    console.error('Error deleting archived scenario:', error);
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});

app.get('/api/archived-campaigns', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.json({ archived: [] });
  }

  const userArchivedDir = getShareKeyArchivedCampaignsDir(shareKey);

  fs.readdir(userArchivedDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read archived campaigns' });
    }

    const archived = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(userArchivedDir, file));
        return stat.isDirectory();
      })
      .map(folderName =>
      {
        // Extract original name and timestamp from folder name
        const lastUnderscore = folderName.lastIndexOf('_');
        const originalName = folderName.substring(0, lastUnderscore);
        const timestamp = folderName.substring(lastUnderscore + 1);

        return {
          folderName,
          originalName,
          archivedAt: timestamp
        };
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)); // Most recent first

    res.json({ archived });
  });
});

app.post('/api/archived-campaigns/:folderName/restore', requireGM, provideShareKey, (req, res) =>
{
  const folderName = req.params.folderName;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const userArchivedDir = getShareKeyArchivedCampaignsDir(shareKey);
  const userCampaignsDir = getShareKeyCampaignsDir(shareKey);
  const archivedPath = path.join(userArchivedDir, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived campaign not found' });
  }

  // Extract original name
  const lastUnderscore = folderName.lastIndexOf('_');
  const originalName = folderName.substring(0, lastUnderscore);
  const restoredPath = path.join(userCampaignsDir, originalName);

  // Check if a campaign with the same name already exists
  if (fs.existsSync(restoredPath))
  {
    return res.status(400).json({ error: 'A campaign with this name already exists' });
  }

  try
  {
    // Move archived folder back to campaigns
    fs.renameSync(archivedPath, restoredPath);
    res.json({ success: true, message: 'Campaign restored successfully' });
  } catch (error)
  {
    console.error('Error restoring campaign:', error);
    res.status(500).json({ error: 'Failed to restore campaign' });
  }
});

app.delete('/api/archived-campaigns/:folderName', requireGM, provideShareKey, (req, res) =>
{
  const folderName = req.params.folderName;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const userArchivedDir = getShareKeyArchivedCampaignsDir(shareKey);
  const archivedPath = path.join(userArchivedDir, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived campaign not found' });
  }

  try
  {
    // Permanently delete the archived folder
    fs.rmSync(archivedPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Campaign permanently deleted' });
  } catch (error)
  {
    console.error('Error deleting archived campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

app.get('/api/campaigns/:campaignName/scenarios', requireAuth, provideShareKey, (req, res) =>
{
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');

  // Get campaign metadata for background image
  let campaignBackgroundImage = undefined;
  const campaignMetadataPath = path.join(campaignPath, '.metadata.json');
  if (fs.existsSync(campaignMetadataPath))
  {
    try
    {
      const metadata = JSON.parse(fs.readFileSync(campaignMetadataPath, 'utf-8'));
      // Convert old image paths to sharekey-based paths
      if (metadata.backgroundImage)
      {
        if (metadata.backgroundImage.startsWith('/images/'))
        {
          campaignBackgroundImage = `/users/${req.shareKey}${metadata.backgroundImage}`;
        } else
        {
          campaignBackgroundImage = metadata.backgroundImage;
        }
      }
    } catch (err)
    {
      console.error('Failed to read campaign metadata:', err);
    }
  }

  if (!fs.existsSync(scenariosPath))
  {
    return res.json({ scenarios: [], campaignBackgroundImage });
  }

  fs.readdir(scenariosPath, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read scenarios' });
    }

    const scenarios = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(scenariosPath, file));
        return stat.isDirectory();
      })
      .map(scenarioName =>
      {
        const scenarioPath = path.join(scenariosPath, scenarioName);
        const maps = fs.readdirSync(scenarioPath).filter(file => file.endsWith('.json'));

        let description = '';
        const metadataPath = path.join(scenarioPath, '.metadata.json');
        if (fs.existsSync(metadataPath))
        {
          try
          {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            description = metadata.description || '';
          } catch (err)
          {
            console.error('Failed to read scenario metadata:', err);
          }
        }

        // Get background image from scenario state
        let mapImageUrl = undefined;
        const scenarioStatePath = path.join(scenarioPath, '.scenario-state.json');
        if (fs.existsSync(scenarioStatePath))
        {
          try
          {
            const scenarioState = JSON.parse(fs.readFileSync(scenarioStatePath, 'utf-8'));
            if (scenarioState.backgroundImage)
            {
              // Convert old paths like "/images/maps/filename.jpg" to sharekey paths
              if (scenarioState.backgroundImage.startsWith('/images/'))
              {
                mapImageUrl = `/users/${req.shareKey}${scenarioState.backgroundImage}`;
              } else
              {
                mapImageUrl = scenarioState.backgroundImage;
              }
            }
          } catch (err)
          {
            console.error('Failed to read scenario state:', err);
          }
        }

        return {
          name: scenarioName,
          mapCount: maps.length,
          description,
          mapImageUrl
        };
      });

    res.json({ scenarios, campaignBackgroundImage });
  });
});

app.post('/api/campaigns/:campaignName/scenarios', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { name } = req.body;
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');

  if (!name)
  {
    return res.status(400).json({ error: 'Scenario name required' });
  }

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  if (!fs.existsSync(scenariosPath))
  {
    fs.mkdirSync(scenariosPath, { recursive: true });
  }

  const scenarioPath = path.join(scenariosPath, name);

  if (fs.existsSync(scenarioPath))
  {
    return res.status(400).json({ error: 'Scenario already exists' });
  }

  // Create scenario directory
  fs.mkdirSync(scenarioPath, { recursive: true });

  res.json({ success: true, name });
});

// Check if scenario has any existing maps
app.get('/api/scenario-maps', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);

  if (!fs.existsSync(scenarioPath))
  {
    return res.json({ hasExistingMap: false });
  }

  try
  {
    // Check if there's a saved scenario state with backgroundImage
    const savedState = loadScenarioGameState();
    if (savedState && savedState.backgroundImage)
    {
      return res.json({
        hasExistingMap: true,
        backgroundImage: savedState.backgroundImage
      });
    }

    return res.json({ hasExistingMap: false });
  } catch (error)
  {
    console.error('Error checking scenario maps:', error);
    return res.json({ hasExistingMap: false });
  }
});

app.patch('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { description, newName } = req.body;
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const scenarioPath = path.join(scenariosPath, req.params.scenarioName);

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  try
  {
    if (description !== undefined)
    {
      const metadataPath = path.join(scenarioPath, '.metadata.json');
      const metadata = { description };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }

    if (newName && newName !== req.params.scenarioName)
    {
      const newPath = path.join(scenariosPath, newName);

      if (fs.existsSync(newPath))
      {
        return res.status(400).json({ error: 'A scenario with that name already exists' });
      }

      if (currentCampaign === req.params.campaignName && currentScenario === req.params.scenarioName)
      {
        return res.status(400).json({ error: 'Cannot rename the current active scenario' });
      }

      try
      {
        fs.cpSync(scenarioPath, newPath, { recursive: true });
        fs.rmSync(scenarioPath, { recursive: true, force: true });
      } catch (err)
      {
        if (fs.existsSync(newPath))
        {
          try
          {
            fs.rmSync(newPath, { recursive: true, force: true });
          } catch (cleanupErr)
          {
            console.error('Failed to cleanup after failed rename:', cleanupErr);
          }
        }
        throw err;
      }
    }

    res.json({ success: true });
  } catch (err)
  {
    console.error('Error updating scenario:', err);
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

app.post('/api/set-context', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { campaign, scenario } = req.body;
  const shareKey = req.shareKey;

  if (!shareKey)
  {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);

  if (!campaign || !scenario)
  {
    return res.status(400).json({ error: 'Campaign and scenario required' });
  }

  const scenarioPath = path.join(campaignsDir, campaign, 'scenarios', scenario);

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  currentCampaign = campaign;
  currentScenario = scenario;
  currentUserId = req.user.id;
  currentShareKey = shareKey; // Store shareKey for file path resolution

  // Only clear session state if we're not already in an active session
  // If a session is already active, preserve it (GM is continuing a game)
  if (!isSessionActive)
  {
    currentSessionName = null;
    console.log('Context set to:', campaign, '/', scenario, '(EDIT MODE)');
  } else
  {
    console.log('Context set to:', campaign, '/', scenario, '(GAME MODE - preserving active session:', currentSessionName, ')');
  }

  // Load scenario game state from file if it exists
  const savedState = loadScenarioGameState();
  if (savedState)
  {
    gameState = { ...savedState };
    console.log('Loaded scenario game state from file');
  } else
  {
    // Reset to default state if no saved state exists
    gameState = {
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
      imageDimensions: null
    };
  }

  res.json({ success: true, campaign, scenario });
});

// Load a map - reads from JSON file and sets it as current state
app.post('/api/load-map', requireGM, express.json(), (req, res) =>
{
  const { filename } = req.body;

  if (!filename)
  {
    return res.status(400).json({ error: 'Filename required' });
  }

  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const metadataPath = path.join(scenarioPath, '.scenario-state.json');

  // Load metadata from file
  if (fs.existsSync(metadataPath))
  {
    try
    {
      const data = fs.readFileSync(metadataPath, 'utf8');
      const metadata = JSON.parse(data);

      // Load player tokens from campaign directory and NPC tokens from scenario directory
      const playerTokens = loadPlayerTokens();
      const npcTokens = loadNPCTokens();
      const props = loadProps();

      // Preserve runtime-only values from existing gameState
      const currentActorId = gameState.currentActorId;
      const showObserverCards = gameState.showObserverCards;

      // Set as current game state, merging player and NPC tokens
      gameState = {
        backgroundImage: `/users/${currentShareKey}/images/maps/${filename}`,
        tokens: [...playerTokens, ...npcTokens],
        props: props,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        fogEnabled: metadata.fogEnabled || 'off-gm',
        fogRevealDistance: metadata.fogRevealDistance || 3,
        playerFogOpacity: 1,
        lightingCondition: metadata.lightingCondition || 'bright',
        revealedPath: metadata.revealedPath || [],
        revealZones: metadata.revealZones || [],
        permanentlyRevealedZones: metadata.permanentlyRevealedZones || [],
        gridColumns: metadata.gridColumns || 20,
        gridRows: metadata.gridRows || 20,
        showGrid: metadata.showGrid !== undefined ? metadata.showGrid : true,
        imageDimensions: null,
        currentActorId,
        showObserverCards
      };

      res.json({ success: true, state: gameState });
    } catch (error)
    {
      console.error('Failed to parse metadata:', error);
      res.status(500).json({ error: 'Failed to parse metadata file' });
    }
  } else
  {
    // No metadata file, create default state with player tokens
    const playerTokens = loadPlayerTokens();
    const props = loadProps();

    // Preserve runtime-only values from existing gameState
    const currentActorId = gameState.currentActorId;
    const showObserverCards = gameState.showObserverCards;

    gameState = {
      backgroundImage: `/users/${currentShareKey}/images/maps/${filename}`,
      tokens: playerTokens,
      props: props,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      fogEnabled: 'off-gm',
      fogRevealDistance: 3,
      playerFogOpacity: 1,
      revealZones: [],
      permanentlyRevealedZones: [],
      lightingCondition: 'bright',
      revealedPath: [],
      gridColumns: 20,
      gridRows: 20,
      showGrid: true,
      imageDimensions: null,
      currentActorId,
      showObserverCards
    };

    res.json({ success: true, state: gameState });
  }
});

// Get current game state (with optional session parameter for observer/player views)
app.get('/api/game-state', (req, res) =>
{
  const { session, campaign } = req.query;

  // If campaign and session parameters provided, load from session metadata
  if (campaign && session)
  {
    try
    {
      // Observer view is public - try to get shareKey from user if authenticated,
      // otherwise look it up by searching share key directories
      let shareKey = req.user?.currentShareKey;

      if (!shareKey)
      {
        // Public access - need to find which share key directory contains this campaign
        const shareKeyDirs = fs.readdirSync(path.join(__dirname, 'users'));
        for (const dir of shareKeyDirs)
        {
          // Skip special directories like 'sessions'
          if (dir === 'sessions') continue;

          const shareKeyPath = path.join(__dirname, 'users', dir);
          const campaignsPath = path.join(shareKeyPath, 'campaigns', campaign);
          if (fs.existsSync(campaignsPath))
          {
            // Found the campaign - dir is the share key
            shareKey = dir;
            break;
          }
        }

        if (!shareKey)
        {
          return res.status(404).json({ error: 'Campaign not found' });
        }
      }
      const campaignsDir = getShareKeyCampaignsDir(shareKey);
      const campaignPath = path.join(campaignsDir, campaign);
      const sessionPath = path.join(campaignPath, 'sessions', session);
      const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

      if (!fs.existsSync(sessionMetadataPath))
      {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Read session metadata to determine current scenario
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      const scenario = sessionMetadata.currentScenario;

      // Load state from session/scenario folder
      const sessionScenarioPath = path.join(sessionPath, 'scenarios', scenario);
      const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');

      if (!fs.existsSync(sessionStatePath))
      {
        return res.status(404).json({ error: 'Session scenario state not found' });
      }

      const sessionStateData = fs.readFileSync(sessionStatePath, 'utf-8');
      const sessionState = JSON.parse(sessionStateData);

      console.log('GET /api/game-state: Loaded session state from', sessionStatePath, 'with fogEnabled =', sessionState.fogEnabled);


      // During active sessions, use the runtime state's fog/lighting settings
      // Don't override with scenario definition values, since those are session-independent
      // (Runtime state reflects real-time GM changes, scenario definition is the default template)


      // Fix background image URL to include share key prefix
      if (sessionState.backgroundImage)
      {
        if (sessionState.backgroundImage.startsWith('/images/'))
        {
          // Old path format - prepend sharekey
          sessionState.backgroundImage = `/users/${shareKey}${sessionState.backgroundImage}`;
        } else if (!sessionState.backgroundImage.startsWith('/users/') && !sessionState.backgroundImage.startsWith('http'))
        {
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
      if (fs.existsSync(sessionPlayerTokensPath))
      {
        const files = fs.readdirSync(sessionPlayerTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionPlayerTokensPath, file), 'utf-8');
            const token = JSON.parse(tokenData);
            // Ensure image paths have the sharekey prefix
            if (token.imageUrl)
            {
              if (token.imageUrl.startsWith('/images/'))
              {
                // Old path format - prepend sharekey
                token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
              } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http'))
              {
                // Bare filename - assume it's in the token images folder
                token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
              }
            }
            if (token.portraitUrl)
            {
              if (token.portraitUrl.startsWith('/images/'))
              {
                token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
              } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http'))
              {
                token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
              }
            }
            playerTokens.push(token);
          }
        }
      }

      // Load NPC tokens from session
      const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
      if (fs.existsSync(sessionNPCTokensPath))
      {
        const files = fs.readdirSync(sessionNPCTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionNPCTokensPath, file), 'utf-8');
            const token = JSON.parse(tokenData);
            // Ensure image paths have the sharekey prefix
            if (token.imageUrl)
            {
              if (token.imageUrl.startsWith('/images/'))
              {
                // Old path format - prepend sharekey
                token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
              } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http'))
              {
                // Bare filename - assume it's in the token images folder
                token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
              }
            }

            if (token.states)
            {
              for (const state of token.states)
              {
                if (state.imageUrl)
                {
                  if (state.imageUrl.startsWith('/images/'))
                  {
                    // Old path format - prepend sharekey
                    state.imageUrl = `/users/${shareKey}${state.imageUrl}`;
                  } else if (!state.imageUrl.startsWith('/users/') && !state.imageUrl.startsWith('http'))
                  {
                    // Bare filename - assume it's in the token images folder
                    state.imageUrl = `/users/${shareKey}/images/token/${state.imageUrl}`;
                  }
                }
              }
            }

            if (token.portraitUrl)
            {
              if (token.portraitUrl.startsWith('/images/'))
              {
                token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
              } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http'))
              {
                token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
              }
            }
            npcTokens.push(token);
          }
        }
      }

      // Load props from session
      const sessionPropsPath = path.join(sessionScenarioPath, 'props');
      if (fs.existsSync(sessionPropsPath))
      {
        const files = fs.readdirSync(sessionPropsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const propData = fs.readFileSync(path.join(sessionPropsPath, file), 'utf-8');
            const prop = JSON.parse(propData);
            // Ensure image paths have the sharekey prefix
            if (prop.imageUrl)
            {
              if (prop.imageUrl.startsWith('/images/'))
              {
                // Old path format - prepend sharekey
                prop.imageUrl = `/users/${shareKey}${prop.imageUrl}`;
              } else if (!prop.imageUrl.startsWith('/users/') && !prop.imageUrl.startsWith('http'))
              {
                // Bare filename - assume it's in the props images folder
                prop.imageUrl = `/users/${shareKey}/images/props/${prop.imageUrl}`;
              }
            }

            if (prop.states)
            {
              for (const state of prop.states)
              {
                if (state.imageUrl)
                {
                  if (state.imageUrl.startsWith('/images/'))
                  {
                    // Old path format - prepend sharekey
                    state.imageUrl = `/users/${shareKey}${state.imageUrl}`;
                  } else if (!state.imageUrl.startsWith('/users/') && !state.imageUrl.startsWith('http'))
                  {
                    // Bare filename - assume it's in the props images folder
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
      if (sessionState.showObserverCards === undefined)
      {
        sessionState.showObserverCards = true;
      }

      // Ensure revealZones and permanentlyRevealedZones exist
      if (!sessionState.revealZones)
      {
        sessionState.revealZones = [];
      }
      if (!sessionState.permanentlyRevealedZones)
      {
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
    } catch (error)
    {
      console.error('Failed to load session state:', error);
      return res.status(500).json({ error: 'Failed to load session state' });
    }
  }

  // Default: return current gameState
  // In edit mode, reload tokens and props from disk to ensure they're fresh
  if (currentCampaign && currentScenario)
  {
    const playerTokens = loadPlayerTokens();
    const npcTokens = loadNPCTokens();
    gameState.tokens = [...playerTokens, ...npcTokens];
    gameState.props = loadProps();
  }

  // Fix image paths to use share key paths before sending to client
  if (currentShareKey)
  {
    gameState.tokens = gameState.tokens.map(token => fixTokenImagePaths(token, currentShareKey));
    gameState.props = gameState.props.map(prop => fixTokenImagePaths(prop, currentShareKey));
  }

  res.json({ state: gameState, sessionActive: isSessionActive });
});

// Get scenario metadata (including lastSessionPlayed)
app.get('/api/scenario-metadata', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.json({ lastSessionPlayed: null });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const definitionPath = path.join(scenarioPath, '.scenario-state.json');

    if (!fs.existsSync(definitionPath))
    {
      return res.json({ lastSessionPlayed: null });
    }

    const definitionData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
    res.json({ lastSessionPlayed: definitionData.lastSessionPlayed || null });
  } catch (err)
  {
    console.error('Failed to get scenario metadata:', err);
    res.status(500).json({ error: 'Failed to get scenario metadata' });
  }
});

// List available sessions for current campaign (campaign-wide, not scenario-specific)
app.get('/api/sessions', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentShareKey)
  {
    return res.json({ sessions: [] });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionsPath = path.join(campaignPath, 'sessions');

    if (!fs.existsSync(sessionsPath))
    {
      return res.json({ sessions: [] });
    }

    const sessions = fs.readdirSync(sessionsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    res.json({ sessions });
  } catch (err)
  {
    console.error('Failed to list sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Start a game session (create session folder if new, or load existing)
// Sessions are now campaign-wide and track which scenario they're on
app.post('/api/session/start', requireGM, express.json(), (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  if (isSessionActive)
  {
    return res.status(400).json({ error: 'Session already active' });
  }

  const { sessionName } = req.body;
  if (!sessionName || sessionName.trim() === '')
  {
    return res.status(400).json({ error: 'Session name is required' });
  }

  try
  {
    const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', sessionName);
    const sessionScenarioPath = path.join(sessionPath, 'scenarios', currentScenario);
    const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);

    // Check if session already exists
    const sessionExists = fs.existsSync(sessionPath);
    const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

    if (!sessionExists)
    {
      // NEW SESSION: Create at campaign level
      fs.mkdirSync(sessionPath, { recursive: true });

      // Create session metadata to track current scenario
      const sessionMetadata = {
        currentScenario: currentScenario,
        createdAt: new Date().toISOString(),
        lastPlayed: new Date().toISOString()
      };
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));

      // Create scenario subfolder for this session
      fs.mkdirSync(sessionScenarioPath, { recursive: true });

      // Copy scenario state
      const sourceStatePath = path.join(scenarioPath, '.scenario-state.json');
      const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');
      if (fs.existsSync(sourceStatePath))
      {
        const definitionState = JSON.parse(fs.readFileSync(sourceStatePath, 'utf-8'));
        // showObserverCards is runtime-only, always initialize to true for new sessions
        definitionState.showObserverCards = true;

        fs.writeFileSync(sessionStatePath, JSON.stringify(definitionState, null, 2));
      }

      // Copy player tokens
      const playerTokensPath = path.join(campaignPath, 'playertokens');
      const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
      if (fs.existsSync(playerTokensPath))
      {
        fs.mkdirSync(sessionPlayerTokensPath, { recursive: true });
        const files = fs.readdirSync(playerTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(playerTokensPath, file),
              path.join(sessionPlayerTokensPath, file)
            );
          }
        }
      }

      // Copy NPC tokens from scenario
      const npcTokensPath = path.join(scenarioPath, 'npctokens');
      const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
      if (fs.existsSync(npcTokensPath))
      {
        fs.mkdirSync(sessionNPCTokensPath, { recursive: true });
        const files = fs.readdirSync(npcTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(npcTokensPath, file),
              path.join(sessionNPCTokensPath, file)
            );
          }
        }
      }

      // Copy props from scenario
      const propsPath = path.join(scenarioPath, 'props');
      const sessionPropsPath = path.join(sessionScenarioPath, 'props');
      if (fs.existsSync(propsPath))
      {
        fs.mkdirSync(sessionPropsPath, { recursive: true });
        const files = fs.readdirSync(propsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(propsPath, file),
              path.join(sessionPropsPath, file)
            );
          }
        }
      }

      console.log('Created new session:', sessionName, 'starting on scenario:', currentScenario);
    } else
    {
      // EXISTING SESSION: Load session metadata and check scenario state
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      const previousScenario = sessionMetadata.currentScenario;

      // Check if this scenario already exists in the session
      const sessionScenarioExists = fs.existsSync(sessionScenarioPath);

      if (!sessionScenarioExists)
      {
        // First time playing this scenario in this session - copy from definition
        console.log('Session', sessionName, 'entering new scenario:', currentScenario);
        fs.mkdirSync(sessionScenarioPath, { recursive: true });

        // Copy scenario state
        const sourceStatePath = path.join(scenarioPath, '.scenario-state.json');
        const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');
        if (fs.existsSync(sourceStatePath))
        {
          const definitionState = JSON.parse(fs.readFileSync(sourceStatePath, 'utf-8'));
          definitionState.showObserverCards = true;
          fs.writeFileSync(sessionStatePath, JSON.stringify(definitionState, null, 2));
        }

        // Copy player tokens from campaign
        const playerTokensPath = path.join(campaignPath, 'playertokens');
        const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
        if (fs.existsSync(playerTokensPath))
        {
          fs.mkdirSync(sessionPlayerTokensPath, { recursive: true });
          const files = fs.readdirSync(playerTokensPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(playerTokensPath, file),
                path.join(sessionPlayerTokensPath, file)
              );
            }
          }
        }

        // Copy NPC tokens from scenario definition
        const npcTokensPath = path.join(scenarioPath, 'npctokens');
        const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
        if (fs.existsSync(npcTokensPath))
        {
          fs.mkdirSync(sessionNPCTokensPath, { recursive: true });
          const files = fs.readdirSync(npcTokensPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(npcTokensPath, file),
                path.join(sessionNPCTokensPath, file)
              );
            }
          }
        }

        // Copy props from scenario definition
        const propsPath = path.join(scenarioPath, 'props');
        const sessionPropsPath = path.join(sessionScenarioPath, 'props');
        if (fs.existsSync(propsPath))
        {
          fs.mkdirSync(sessionPropsPath, { recursive: true });
          const files = fs.readdirSync(propsPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(propsPath, file),
                path.join(sessionPropsPath, file)
              );
            }
          }
        }
      }

      // Update session metadata with current scenario
      sessionMetadata.currentScenario = currentScenario;
      sessionMetadata.lastPlayed = new Date().toISOString();
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));
      console.log('Loading session:', sessionName, 'on scenario:', currentScenario);
    }

    currentSessionName = sessionName;
    isSessionActive = true; // Set to true for session mode

    // Reload game state from session files
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gameState = loadedState;
      console.log('Loaded session state - showObserverCards:', gameState.showObserverCards);
    } else
    {
      console.log('Warning: No state loaded from session files');
    }

    console.log('Game session started:', sessionName, 'for', currentCampaign, currentScenario);
    res.json({ success: true, isSessionActive: true, sessionName });
  } catch (err)
  {
    console.error('Failed to start session:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// End a game session (keep session files for later, just deactivate and switch to edit mode)
app.post('/api/session/end', requireGM, express.json(), (req, res) =>
{
  if (!isSessionActive)
  {
    return res.status(400).json({ error: 'No active session' });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName);

    // Read session metadata to get current scenario
    const metadataPath = path.join(sessionPath, '.session-metadata.json');
    let sessionScenario = currentScenario;
    if (fs.existsSync(metadataPath))
    {
      const sessionMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      sessionScenario = sessionMetadata.currentScenario;
    }

    // Deactivate all player tokens in the session
    const sessionPlayerTokensPath = path.join(sessionPath, 'scenarios', sessionScenario, 'playertokens');
    if (fs.existsSync(sessionPlayerTokensPath))
    {
      const sessionTokenFiles = fs.readdirSync(sessionPlayerTokensPath);
      for (const file of sessionTokenFiles)
      {
        if (file.endsWith('.json'))
        {
          const tokenPath = path.join(sessionPlayerTokensPath, file);
          const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
          tokenData.active = false;
          fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
        }
      }
      console.log(`Deactivated ${sessionTokenFiles.length} player tokens in session`);
    }

    // Update session metadata
    const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');
    if (fs.existsSync(sessionMetadataPath))
    {
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      sessionMetadata.lastPlayed = new Date().toISOString();
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));
    }

    const endedSessionName = currentSessionName;
    isSessionActive = false;
    currentSessionName = null;

    // Reload game state from definition files for editing
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gameState = loadedState;
      console.log('Game state reloaded from definition files for editing, tokens:', gameState.tokens.length);
    }

    console.log('Game session ended:', endedSessionName, 'for', currentCampaign, currentScenario);
    res.json({
      success: true,
      isSessionActive: false,
      gameState: gameState
    });
  } catch (err)
  {
    console.error('Failed to end session:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Get session status
app.get('/api/session/status', (req, res) =>
{
  res.json({
    isSessionActive,
    sessionName: currentSessionName
  });
});

// Update game state (and save to map JSON)
app.post('/api/game-state', requireGM, express.json(), (req, res) =>
{
  const { state } = req.body;

  if (!state)
  {
    return res.status(400).json({ error: 'State required' });
  }

  console.log('Server: POST /api/game-state received, fogEnabled =', state.fogEnabled, 'isSessionActive =', isSessionActive, 'currentSessionName =', currentSessionName);

  // Update in-memory state (last write wins)
  gameState = { ...state };

  // Separate player tokens from NPC tokens
  const playerTokens = gameState.tokens.filter(t => t.actor?.player);
  const npcTokens = gameState.tokens.filter(t => !t.actor?.player);

  // Get existing tokens from disk
  const existingPlayerTokens = loadPlayerTokens();
  const existingNPCTokens = loadNPCTokens();

  // Save current player tokens individually to campaign directory
  for (const playerToken of playerTokens)
  {
    savePlayerToken(playerToken);
  }

  // Save current NPC tokens individually to scenario directory
  for (const npcToken of npcTokens)
  {
    saveNPCToken(npcToken);
  }

  // DISABLED: Don't auto-delete tokens on every sync
  // The frontend may not have all tokens loaded yet, so we shouldn't delete
  // Tokens should only be deleted via explicit delete actions
  /*
  // Delete any player tokens that exist on disk but not in current state
  const currentPlayerIds = new Set(playerTokens.map(t => t.id));
  for (const existingToken of existingPlayerTokens)
  {
    if (!currentPlayerIds.has(existingToken.id))
    {
      console.log('DELETING player token that is not in current state:', existingToken.id, existingToken.actor?.name);
      deletePlayerToken(existingToken.id);
    }
  }

  // Delete any NPC tokens that exist on disk but not in current state
  const currentNPCIds = new Set(npcTokens.map(t => t.id));
  for (const existingToken of existingNPCTokens)
  {
    if (!currentNPCIds.has(existingToken.id))
    {
      console.log('DELETING NPC token that is not in current state:', existingToken.id, existingToken.actor?.name);
      deleteNPCToken(existingToken.id);
    }
  }
  */

  // Handle props if they exist in state
  if (gameState.props && Array.isArray(gameState.props))
  {
    const existingProps = loadProps();

    // Save current props individually to scenario directory
    for (const prop of gameState.props)
    {
      saveProp(prop);
    }

    // Delete any props that exist on disk but not in current state
    const currentPropIds = new Set(gameState.props.map(p => p.id));
    for (const existingProp of existingProps)
    {
      if (!currentPropIds.has(existingProp.id))
      {
        deleteProp(existingProp.id);
      }
    }
  }

  // Save scenario-level game state (tokens now stored separately)
  saveScenarioGameState(gameState);

  res.json({ success: true });
});

// Player heartbeat endpoint
app.post('/api/player-heartbeat', express.json(), (req, res) =>
{
  const { tokenId } = req.body;

  if (tokenId)
  {
    playerHeartbeats.set(tokenId, Date.now());

    // Find the token and set it to active
    const token = gameState.tokens.find(t => t.id === tokenId);
    if (token)
    {
      if (!token.active)
      {
        console.log('Activating player token:', tokenId, token.actor?.name);
        token.active = true;

        // Save player token immediately if it's a player token
        if (token.actor?.player)
        {
          savePlayerToken(token);
        }

        // Save scenario state
        saveScenarioGameState(gameState);
      }
    } else
    {
      console.log('Heartbeat for unknown token:', tokenId);
    }
  }

  res.json({ success: true });
});

// Deactivate a player token (for page unload)
app.post('/api/deactivate-token', express.json(), (req, res) =>
{
  console.log('Deactivate token request received:', req.body);

  const { tokenId } = req.body;

  if (!tokenId)
  {
    console.log('No tokenId provided');
    return res.status(400).json({ error: 'Token ID required' });
  }

  // Update token active state in memory
  const tokenToUpdate = gameState.tokens.find(t => t.id === tokenId);

  if (tokenToUpdate)
  {
    tokenToUpdate.active = false;
    console.log('Deactivated token in memory:', tokenId, tokenToUpdate.actor?.name);

    // If it's a player token, save it separately
    if (tokenToUpdate.actor?.player)
    {
      savePlayerToken(tokenToUpdate);
      console.log('Saved player token to file:', tokenId);
    }

    // Save scenario state
    saveScenarioGameState(gameState);
  } else
  {
    console.log('Token not found:', tokenId);
  }

  res.json({ success: true });
});

// Update token position (for player/observer view movement)
// Token endpoints moved to `server/tokens.js` via registerRoutes

// Token state endpoint moved to `server/tokens.js` via registerRoutes

// Update prop state (base or named state)
app.post('/api/update-prop-state', express.json(), (req, res) =>
{
  console.log('Update prop state request:', req.body);

  const { propId, activeState } = req.body;

  if (!propId)
  {
    return res.status(400).json({ error: 'Prop ID is required' });
  }

  // Find the prop
  const propToUpdate = gameState.props.find(p => p.id === propId);

  if (!propToUpdate)
  {
    return res.status(404).json({ error: 'Prop not found' });
  }

  // Check permissions: GM can change any prop state
  // Players can only change states marked as playerInteractible
  const isGM = req.user && req.user.role === 'gm';

  if (!isGM && activeState)
  {
    // Player trying to change to a named state - check if it's interactible
    const targetState = propToUpdate.states?.find(s => s.name === activeState);
    if (!targetState || !targetState.playerInteractible)
    {
      return res.status(403).json({ error: 'Not authorized to change to this prop state' });
    }
  }

  // Update active state
  propToUpdate.activeState = activeState;

  console.log(`Updated prop ${propId} activeState to ${activeState}`);

  // Save prop
  saveProp(propToUpdate);

  // Save scenario state
  saveScenarioGameState(gameState);

  res.json({ success: true, prop: propToUpdate });
});

// Update revealed path (for fog reveal tracking)
app.post('/api/update-revealed-path', express.json(), (req, res) =>
{
  console.log('Update revealed path request:', req.body);
  console.log('Current session state - campaign:', currentCampaign, 'scenario:', currentScenario, 'sessionActive:', isSessionActive, 'sessionName:', currentSessionName);

  const { revealedPath } = req.body;

  if (!Array.isArray(revealedPath))
  {
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

// Serve uploaded images from server's file system (legacy)
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve user-specific images from share key folders
app.use('/users', express.static(path.join(__dirname, 'users')));

// Serve static files from the React app (production)
if (process.env.NODE_ENV === 'production')
{
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // Handle React routing, return all requests to React app
  app.get('*', (req, res) =>
  {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// Create HTTP server and WebSocket server
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Listen port (from env or default)
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Handle WebSocket connections
wss.on('connection', (ws, req) =>
{
  // Parse session from URL query: /ws?campaign=name&session=name
  const url = new URL(req.url, `http://${req.headers.host}`);
  const campaign = url.searchParams.get('campaign');
  const session = url.searchParams.get('session');

  if (!campaign || !session)
  {
    console.log('WebSocket connection rejected: missing campaign or session');
    ws.close();
    return;
  }

  const sessionKey = `${campaign}/${session}`;
  console.log('WebSocket client connected to session:', sessionKey);

  // Add to session connections
  if (!sessionConnections.has(sessionKey))
  {
    sessionConnections.set(sessionKey, new Set());
  }
  sessionConnections.get(sessionKey).add(ws);

  // Handle messages from client
  ws.on('message', (data) =>
  {
    try
    {
      const message = JSON.parse(data);
      // Delegate to wsHandlers for domain-specific handling
      // Note: wsHandlers is ESM imported at top; use the function directly
      import('./wsHandlers.js').then(mod => {
        mod.handleWebSocketMessage(message, { gameState, campaign, session, sessionKey, saveScenarioGameState, broadcast });
      }).catch(err => console.error('Failed to load wsHandlers module dynamically:', err));
    } catch (err)
    {
      console.error('WebSocket message error:', err);
    }
  });

  // Handle client disconnect
  ws.on('close', () =>
  {
    console.log('WebSocket client disconnected from session:', sessionKey);
    const clients = sessionConnections.get(sessionKey);
    if (clients)
    {
      clients.delete(ws);
      if (clients.size === 0)
      {
        sessionConnections.delete(sessionKey);
      }
    }
  });
});

httpServer.listen(PORT, () =>
{
  console.log(`Upload server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready on ws://localhost:${PORT}`);
  console.log(`Users directory: ${usersDir}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Clear user-specific temp folders on startup
  try
  {
    let totalCleared = 0;

    // Clear user-specific temp folders
    if (fs.existsSync(usersDir))
    {
      const users = fs.readdirSync(usersDir);
      for (const user of users)
      {
        const userTempDir = path.join(usersDir, user, 'images', 'temp');
        if (fs.existsSync(userTempDir))
        {
          const tempFiles = fs.readdirSync(userTempDir);
          for (const file of tempFiles)
          {
            const filePath = path.join(userTempDir, file);
            if (fs.statSync(filePath).isFile())
            {
              fs.unlinkSync(filePath);
              totalCleared++;
            }
          }
        }
      }
    }

    console.log(`Cleared ${totalCleared} files from temp directories`);
  } catch (err)
  {
    console.warn('Failed to clear temp directory:', err);
  }
});
