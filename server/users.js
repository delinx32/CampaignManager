import path from 'path';
import fs from 'fs';
import express from 'express';
import { fileURLToPath } from 'url';
import { loadShareKeyData, requireGM, saveShareKeyData } from './auth.js';
import { sendPlayerInviteEmail } from './email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load settings.json for API keys
let googleSearchApiKey = null;
let googleSearchEngineId = null;

try {
  const settingsPath = path.join(__dirname, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    googleSearchApiKey = settings.googleSearchApiKey || null;
    googleSearchEngineId = settings.googleSearchEngineId || null;
  }
} catch (err) {
  console.warn('Could not read settings.json:', err?.message || err);
}

/**
 * Get the campaigns directory for a share key
 * @param {string} shareKey - The share key identifier
 * @param {string} usersDir - Path to users directory
 * @returns {string} Path to the campaigns directory
 */
export function getShareKeyCampaignsDir(shareKey, usersDir) {
  const shareKeyDir = path.join(usersDir, shareKey, 'campaigns');
  if (!fs.existsSync(shareKeyDir)) {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

/**
 * Get the archived campaigns directory for a share key
 * @param {string} shareKey - The share key identifier
 * @param {string} usersDir - Path to users directory
 * @returns {string} Path to the archived campaigns directory
 */
export function getShareKeyArchivedCampaignsDir(shareKey, usersDir) {
  const shareKeyDir = path.join(usersDir, shareKey, 'archived-campaigns');
  if (!fs.existsSync(shareKeyDir)) {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

/**
 * Middleware to provide a shareKey on req for routes that operate on user folders
 * @param {object} options - Options object
 * @param {function} options.shareKeyExists - Function to check if share key exists
 * @returns {function} Express middleware function
 */
export function createProvideShareKeyMiddleware(options) {
  const { shareKeyExists } = options;
  
  return function provideShareKey(req, res, next) {
    // Priority: explicit query param, header, authenticated user's currentShareKey, or global currentShareKey
    const candidate = (req.query && req.query.shareKey) || req.headers['x-share-key'] || (req.user && req.user.currentShareKey) || null;
    if (!candidate) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    // Normalize candidate
    const shareKey = String(candidate).toLowerCase();

    // Verify the share key exists
    if (!shareKeyExists(shareKey)) {
      return res.status(404).json({ error: 'Share key not found' });
    }

    req.shareKey = shareKey;
    return next();
  };
}

/**
 * Register user management API routes
 * @param {object} app - Express app instance
 * @param {object} options - Options object
 * @param {function} options.requireOwner - Middleware to require owner role
 * @param {function} options.provideShareKey - Middleware to provide share key
 */
export function registerUserRoutes(app, options) {
  const { requireOwner, provideShareKey } = options;

  // PATCH /api/user/openai-key - Update OpenAI API key
  app.patch('/api/user/openai-key', provideShareKey, requireOwner, express.json(), (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const { openaiApiKey } = req.body;

    if (!openaiApiKey || typeof openaiApiKey !== 'string') {
      return res.status(400).json({ error: 'OpenAI API key is required' });
    }

    // Basic validation - OpenAI keys should start with 'sk-'
    if (!openaiApiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid OpenAI API key format' });
    }

    // Update share key data file
    const shareKeyData = loadShareKeyData(shareKey);
    shareKeyData.openaiApiKey = openaiApiKey;
    saveShareKeyData(shareKey, shareKeyData);

    res.json({ success: true });
  });

  // GET /api/user/openai-key - Get OpenAI API key status
  app.get('/api/user/openai-key', provideShareKey, requireOwner, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
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

  // GET /api/user/gms - Get GM list
  app.get('/api/user/gms', provideShareKey, requireOwner, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.json({ gms: [] });
    }

    const shareKeyData = loadShareKeyData(shareKey);

    res.json({ gms: shareKeyData.gms || [] });
  });

  // POST /api/user/gms - Add a GM
  app.post('/api/user/gms', provideShareKey, requireOwner, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const shareKeyData = loadShareKeyData(shareKey);
    if (!shareKeyData.gms) {
      shareKeyData.gms = [];
    }

    // Don't add duplicates
    if (shareKeyData.gms.includes(email)) {
      return res.status(400).json({ error: 'GM already exists' });
    }

    shareKeyData.gms.push(email);
    saveShareKeyData(shareKey, shareKeyData);

    res.json({ gms: shareKeyData.gms });
  });

  // DELETE /api/user/gms - Remove a GM
  app.delete('/api/user/gms', provideShareKey, requireOwner, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const shareKeyData = loadShareKeyData(shareKey);
    if (!shareKeyData.gms) {
      shareKeyData.gms = [];
    }

    shareKeyData.gms = shareKeyData.gms.filter(gm => gm !== email);
    saveShareKeyData(shareKey, shareKeyData);

    res.json({ gms: shareKeyData.gms });
  });

  // GET /api/user/players - Get players list
  app.get('/api/user/players', provideShareKey, requireGM, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.json({ players: [] });
    }

    const shareKeyData = loadShareKeyData(shareKey);

    res.json({ players: shareKeyData.players || [] });
  });

  // POST /api/user/players - Add a player
  app.post('/api/user/players', provideShareKey, requireGM, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const { email, frontendUrl } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const shareKeyData = loadShareKeyData(shareKey);
    if (!shareKeyData.players) {
      shareKeyData.players = [];
    }

    // Don't add duplicates
    if (shareKeyData.players.includes(email)) {
      return res.status(400).json({ error: 'Player already exists' });
    }

    shareKeyData.players.push(email);
    saveShareKeyData(shareKey, shareKeyData);

    // Send invite email (don't fail the request if email fails)
    const ownerName = req.user?.name || 'The Campaign Owner';
    sendPlayerInviteEmail(email, shareKey, ownerName, null, frontendUrl).catch(err => {
      console.error(`Failed to send invite email to ${email}:`, err);
    });

    res.json({ players: shareKeyData.players });
  });

  // DELETE /api/user/players - Remove a player
  app.delete('/api/user/players', provideShareKey, requireGM, (req, res) => {
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const shareKeyData = loadShareKeyData(shareKey);
    if (!shareKeyData.players) {
      shareKeyData.players = [];
    }

    shareKeyData.players = shareKeyData.players.filter(player => player !== email);
    saveShareKeyData(shareKey, shareKeyData);

    res.json({ players: shareKeyData.players });
  });

  // GET /api/verify-player/:shareKey - Check if authenticated user is a valid player for this share key
  app.get('/api/verify-player/:shareKey', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const shareKey = String(req.params.shareKey).toLowerCase();

    try {
      const shareKeyData = loadShareKeyData(shareKey);
      const userEmail = req.user.email;
      const isValidPlayer = (shareKeyData.players && shareKeyData.players.includes(userEmail)) || false;

      res.json({ 
        isValidPlayer,
        shareKey,
        userEmail,
        message: isValidPlayer ? 'Player verified' : 'User is not in the player list for this share key'
      });
    } catch (err) {
      console.error(`Error verifying player for share key ${shareKey}:`, err);
      res.status(500).json({ error: 'Error verifying player access' });
    }
  });
}

/**
 * Get Google Search API credentials
 * @returns {object} Object with googleSearchApiKey and googleSearchEngineId
 */
export function getGoogleSearchCredentials() {
  return {
    googleSearchApiKey,
    googleSearchEngineId
  };
}

export default {
  getShareKeyCampaignsDir,
  getShareKeyArchivedCampaignsDir,
  createProvideShareKeyMiddleware,
  registerUserRoutes,
  getGoogleSearchCredentials
};
