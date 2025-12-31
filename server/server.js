
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { registerImageRoutes } from './images.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { passport, sessionMiddleware, requireAuth, requireGM, requireOwner, isOAuthConfigured, registerAuthRoutes, shareKeyExists, loadShareKeyData, saveShareKeyData } from './auth.js';

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

// Image endpoints moved to server/images.js via registerImageRoutes

// Image routes have been moved to server/images.js; registered earlier via registerImageRoutes

// POST /api/map-metadata moved to scenario.js

// ===========================
// WebSocket Management
// ===========================

// Track connected WebSocket clients by session
// Format: { "campaignName/sessionName": Set<WebSocket> }
import { sessionConnections, broadcast } from './sessions.js';

// Game state management module
import * as gamestate from './gamestate.js';
import { saveScenarioGameState, loadScenarioGameState, loadProps } from './gamestate.js';

// Token utilities (module) - set context early so other helpers can use it
import * as tokens from './tokens.js';
import { fixTokenImagePaths } from './tokens.js';
import * as scenario from './scenario.js';
import { saveMapMetadata } from './scenario.js';

tokens.setContext({
  getCurrentCampaign: () => gamestate.getCurrentCampaign(),
  getCurrentScenario: () => gamestate.getCurrentScenario(),
  getCurrentShareKey: () => gamestate.getCurrentShareKey(),
  isSessionActive: () => gamestate.isActiveSession(),
  getCurrentSessionName: () => gamestate.getCurrentSessionName(),
  getShareKeyCampaignsDir,
  fs,
  path
});

// ===========================
// Register Authentication Routes
// ===========================
// Now that game state variables are initialized, register auth routes
registerAuthRoutes(app, {
  currentShareKey: () => gamestate.getCurrentShareKey(),
  currentCampaign: () => gamestate.getCurrentCampaign(),
  currentSessionName: () => gamestate.getCurrentSessionName(),
  currentScenario: () => gamestate.getCurrentScenario(),
  isSessionActive: () => gamestate.isActiveSession(),
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

// Start heartbeat monitoring
gamestate.startHeartbeatMonitor();

// Register gamestate context helpers
gamestate.setContext({
  tokens,
  saveMapMetadata,
  getShareKeyCampaignsDir,
  usersDir
});

// Register game state API endpoints
if (typeof gamestate.registerRoutes === 'function')
{
  gamestate.registerRoutes(app, {
    express,
    requireGM,
    fixTokenImagePaths
  });
}

// Register token-related HTTP endpoints from tokens module
if (typeof tokens.registerRoutes === 'function')
{
  tokens.registerRoutes(app, { gameState: gamestate.getGameState, saveScenarioGameState });
}

// Register scenario-related HTTP endpoints from scenario module
if (typeof scenario.registerRoutes === 'function')
{
  scenario.registerRoutes(app, {
    requireAuth,
    requireGM,
    provideShareKey,
    getShareKeyCampaignsDir,
    getShareKeyArchivedCampaignsDir,
    gameState: gamestate.getGameState,
    loadScenarioGameState,
    saveScenarioGameState,
    loadPlayerTokens: tokens.loadPlayerTokens,
    loadNPCTokens: tokens.loadNPCTokens,
    loadProps: gamestate.loadProps,
    fixTokenImagePaths,
    express
  });
}

// Player token save logic moved to `server/tokens.js`
// See: server/tokens.js:savePlayerToken

// Player token delete moved to `server/tokens.js`
// See: server/tokens.js:deletePlayerToken

// NPC token loading/saving moved to `server/tokens.js`
// See: server/tokens.js:loadNPCTokens, saveNPCToken, deleteNPCToken

// Props management moved to gamestate.js

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
  getCurrentCampaign: () => gamestate.getCurrentCampaign(),
  getCurrentScenario: () => gamestate.getCurrentScenario(),
  getCurrentShareKey: () => gamestate.getCurrentShareKey(),
  isSessionActive: () => gamestate.isActiveSession(),
  getCurrentSessionName: () => gamestate.getCurrentSessionName(),
  getShareKeyCampaignsDir,
  loadPlayerTokens: tokens.loadPlayerTokens,
  loadNPCTokens: tokens.loadNPCTokens,
  loadProps,
  savePlayerToken: tokens.savePlayerToken,
  fs,
  path,
  saveMapMetadata
});

// Initialize scenario module
scenario.setContext({
  getCurrentCampaign: () => gamestate.getCurrentCampaign(),
  getCurrentScenario: () => gamestate.getCurrentScenario(),
  getCurrentShareKey: () => gamestate.getCurrentShareKey(),
  isSessionActive: () => gamestate.isActiveSession(),
  getCurrentSessionName: () => gamestate.getCurrentSessionName(),
  setCurrentCampaign: (val) => { gamestate.setCurrentCampaign(val); },
  setCurrentScenario: (val) => { gamestate.setCurrentScenario(val); },
  setCurrentUserId: (val) => { /* no setter in gamestate */ },
  setCurrentShareKey: (val) => { gamestate.setCurrentShareKey(val); },
  setCurrentSessionName: (val) => { gamestate.setCurrentSessionName(val); },
  getShareKeyCampaignsDir,
  getGameState: () => gamestate.getGameState(),
  setGameState: (state) => gamestate.setGameState(state)
});

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



// Share Key Management APIs are now handled by the auth module
// (See auth.js for registerAuthRoutes)

// User Management APIs (deprecated /api/user/key endpoint removed - use share keys instead)

app.patch('/api/user/openai-key', requireOwner, express.json(), (req, res) =>
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

app.get('/api/user/openai-key', requireOwner, (req, res) =>
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
app.get('/api/user/gms', requireOwner, (req, res) =>
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
app.post('/api/user/gms', requireOwner, (req, res) =>
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
app.delete('/api/user/gms', requireOwner, (req, res) =>
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

// Scenario archiving endpoints moved to scenario.js
// DELETE /api/campaigns/:campaignName/scenarios/:scenarioName
// GET /api/campaigns/:campaignName/archived-scenarios
// POST /api/campaigns/:campaignName/archived-scenarios/:folderName/restore
// DELETE /api/campaigns/:campaignName/archived-scenarios/:folderName

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

// GET /api/campaigns/:campaignName/scenarios moved to scenario.js

// POST /api/campaigns/:campaignName/scenarios moved to scenario.js
// GET /api/scenario-maps moved to scenario.js

// PATCH /api/campaigns/:campaignName/scenarios/:scenarioName moved to scenario.js

// POST /api/set-context moved to scenario.js

// POST /api/load-map moved to scenario.js

// ===========================
// Game State API Endpoints
// ===========================
// All game state related API endpoints are now registered by gamestate.registerRoutes()
// Includes:
// - GET /api/game-state
// - POST /api/game-state
// - POST /api/player-heartbeat
// - POST /api/deactivate-token
// - POST /api/update-prop-state
// - POST /api/update-revealed-path

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

// ===========================
// Orphaned Code Below - Delete When Cleaning Up
// ===========================
/*
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
    const playerTokens = tokens.loadPlayerTokens();
    const npcTokens = tokens.loadNPCTokens();
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
*/

// ===========================
// Session Management Endpoints
// ===========================

// List available sessions for current campaign (campaign-wide, not scenario-specific)
app.get('/api/sessions', requireAuth, (req, res) =>
{
  if (!gamestate.getCurrentCampaign() || !gamestate.getCurrentShareKey())
  {
    return res.json({ sessions: [] });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(gamestate.getCurrentShareKey());
    const campaignPath = path.join(campaignsDir, gamestate.getCurrentCampaign());
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
  if (!gamestate.getCurrentCampaign() || !gamestate.getCurrentScenario() || !gamestate.getCurrentShareKey())
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  if (gamestate.isActiveSession())
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
    const userCampaignsDir = getShareKeyCampaignsDir(gamestate.getCurrentShareKey());
    const campaignPath = path.join(userCampaignsDir, gamestate.getCurrentCampaign());
    const sessionPath = path.join(campaignPath, 'sessions', sessionName);
    const sessionScenarioPath = path.join(sessionPath, 'scenarios', gamestate.getCurrentScenario());
    const scenarioPath = path.join(userCampaignsDir, gamestate.getCurrentCampaign(), 'scenarios', gamestate.getCurrentScenario());

    // Check if session already exists
    const sessionExists = fs.existsSync(sessionPath);
    const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

    if (!sessionExists)
    {
      // NEW SESSION: Create at campaign level
      fs.mkdirSync(sessionPath, { recursive: true });

      // Create session metadata to track current scenario
      const sessionMetadata = {
        currentScenario: gamestate.getCurrentScenario(),
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
      sessionMetadata.currentScenario = gamestate.getCurrentScenario();
      sessionMetadata.lastPlayed = new Date().toISOString();
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));
      console.log('Loading session:', sessionName, 'on scenario:', gamestate.getCurrentScenario());
    }

    gamestate.setCurrentSessionName(sessionName);
    gamestate.setSessionActive(true);

    // Reload game state from session files
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gamestate.setGameState(loadedState);
      console.log('Loaded session state - showObserverCards:', loadedState.showObserverCards);
    } else
    {
      console.log('Warning: No state loaded from session files');
    }

    console.log('Game session started:', sessionName, 'for', gamestate.getCurrentCampaign(), gamestate.getCurrentScenario());
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
  if (!gamestate.isActiveSession())
  {
    return res.status(400).json({ error: 'No active session' });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(gamestate.getCurrentShareKey());
    const campaignPath = path.join(campaignsDir, gamestate.getCurrentCampaign());
    const sessionPath = path.join(campaignPath, 'sessions', gamestate.getCurrentSessionName());

    // Read session metadata to get current scenario
    const metadataPath = path.join(sessionPath, '.session-metadata.json');
    let sessionScenario = gamestate.getCurrentScenario();
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

    const endedSessionName = gamestate.getCurrentSessionName();
    gamestate.setSessionActive(false);
    gamestate.setCurrentSessionName(null);

    // Reload game state from definition files for editing
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gamestate.setGameState(loadedState);
      console.log('Game state reloaded from definition files for editing, tokens:', loadedState.tokens.length);
    }

    console.log('Game session ended:', endedSessionName, 'for', gamestate.getCurrentCampaign(), gamestate.getCurrentScenario());
    res.json({
      success: true,
      isSessionActive: false,
      gameState: gamestate.getGameState()
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
    isSessionActive: gamestate.isActiveSession(),
    sessionName: gamestate.getCurrentSessionName()
  });
});

// Update game state (and save to map JSON)
app.post('/api/game-state', requireGM, express.json(), (req, res) => {
  const { state } = req.body;

  if (!state) {
    return res.status(400).json({ error: 'State required' });
  }

  // Update in-memory state
  gameState = { ...state };

  // Separate tokens and save
  const playerTokens = gameState.tokens.filter(t => t.actor?.player);
  const npcTokens = gameState.tokens.filter(t => !t.actor?.player);

  for (const playerToken of playerTokens) {
    tokens.savePlayerToken(playerToken);
  }

  for (const npcToken of npcTokens) {
    tokens.saveNPCToken(npcToken);
  }

  // Handle props if they exist in state
  if (gameState.props && Array.isArray(gameState.props)) {
    const existingProps = loadProps();

    for (const prop of gameState.props) {
      saveProp(prop);
    }

    const currentPropIds = new Set(gameState.props.map(p => p.id));
    for (const existingProp of existingProps) {
      if (!currentPropIds.has(existingProp.id)) {
        deleteProp(existingProp.id);
      }
    }
  }

  // Save scenario-level game state
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
          tokens.savePlayerToken(token);
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
      tokens.savePlayerToken(tokenToUpdate);
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
