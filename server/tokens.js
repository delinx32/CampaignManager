// Token helpers (player and NPC token load/save/delete)
import express from 'express';
import { fixImagePath } from './images.js';

let ctx = {};

export function setContext(context) {
  ctx = context || {};
}

function getPlayerTokensPath() {
  const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
  const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
  const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
  const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;
  const path = ctx.path;

  if (!currentCampaign || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  if (isSessionActive && currentSessionName) {
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', ctx.getCurrentScenario());
    return path.join(sessionPath, 'playertokens');
  }
  return path.join(userCampaignsDir, currentCampaign, 'playertokens');
}

function loadPlayerTokens() {
  const fs = ctx.fs;
  const path = ctx.path;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
  const tokensPath = getPlayerTokensPath();
  if (!tokensPath || !fs.existsSync(tokensPath)) {
    return [];
  }

  try {
    const files = fs.readdirSync(tokensPath);
    const playerTokens = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const tokenPath = path.join(tokensPath, file);
          const tokenData = fs.readFileSync(tokenPath, 'utf-8');
          const token = JSON.parse(tokenData);
          if (token.imageUrl && token.imageUrl.startsWith('/images/')) {
            token.imageUrl = `/users/${currentShareKey}${token.imageUrl}`;
          }
          if (token.portraitUrl && token.portraitUrl.startsWith('/images/')) {
            token.portraitUrl = `/users/${currentShareKey}${token.portraitUrl}`;
          }
          if (token.states && Array.isArray(token.states)) {
            token.states = token.states.map(state => ({
              ...state,
              imageUrl: state.imageUrl && state.imageUrl.startsWith('/images/')
                ? `/users/${currentShareKey}${state.imageUrl}`
                : state.imageUrl
            }));
          }
          playerTokens.push(token);
        } catch (err) {
          console.error(`tokens.loadPlayerTokens failed for ${file}:`, err);
        }
      }
    }
    return playerTokens;
  } catch (error) {
    console.error('tokens.loadPlayerTokens failed:', error);
    return [];
  }
}

function savePlayerToken(token) {
  try {
    const fs = ctx.fs;
    const path = ctx.path;
    const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
    const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
    const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
    const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
    const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;

    if (!currentCampaign || !currentShareKey) return;

    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const definitionPath = path.join(campaignsDir, currentCampaign, 'playertokens');

    const tokenToSave = { ...token };
    if (tokenToSave.imageUrl && tokenToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.imageUrl = tokenToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }
    if (tokenToSave.portraitUrl && tokenToSave.portraitUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.portraitUrl = tokenToSave.portraitUrl.replace(`/users/${currentShareKey}`, '');
    }
    if (tokenToSave.states && Array.isArray(tokenToSave.states)) {
      tokenToSave.states = tokenToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName) {
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', ctx.getCurrentScenario());
      const runtimePath = path.join(sessionPath, 'playertokens');
      if (!fs.existsSync(runtimePath)) fs.mkdirSync(runtimePath, { recursive: true });
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    } else {
      if (!fs.existsSync(definitionPath)) fs.mkdirSync(definitionPath, { recursive: true });
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    }
  } catch (error) {
    console.error('tokens.savePlayerToken failed:', error);
  }
}

function deletePlayerToken(tokenId) {
  try {
    const fs = ctx.fs;
    const path = ctx.path;
    const tokensPath = getPlayerTokensPath();
    if (!tokensPath) return;
    const tokenPath = path.join(tokensPath, `${tokenId}.json`);
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  } catch (error) {
    console.error('tokens.deletePlayerToken failed:', error);
  }
}

function getNPCTokensPath() {
  const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
  const currentScenario = ctx.getCurrentScenario ? ctx.getCurrentScenario() : null;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
  const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
  const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
  const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;
  const path = ctx.path;

  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  if (isSessionActive && currentSessionName) {
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, 'npctokens');
  }
  return path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario, 'npctokens');
}

function loadNPCTokens() {
  const fs = ctx.fs;
  const path = ctx.path;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
  const tokensPath = getNPCTokensPath();
  if (!tokensPath) return [];
  if (!fs.existsSync(tokensPath)) {
    if (ctx.isSessionActive && ctx.getCurrentSessionName && ctx.getCurrentCampaign && ctx.getCurrentScenario && ctx.getCurrentShareKey) {
      const campaignsDir = ctx.getShareKeyCampaignsDir(currentShareKey);
      const scenarioPath = path.join(campaignsDir, ctx.getCurrentCampaign(), 'scenarios', ctx.getCurrentScenario());
      const baseTokensPath = path.join(scenarioPath, 'npctokens');
      if (fs.existsSync(baseTokensPath)) {
        fs.mkdirSync(tokensPath, { recursive: true });
        const files = fs.readdirSync(baseTokensPath);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.copyFileSync(path.join(baseTokensPath, file), path.join(tokensPath, file));
          }
        }
      } else {
        fs.mkdirSync(tokensPath, { recursive: true });
      }
    } else {
      fs.mkdirSync(tokensPath, { recursive: true });
    }
  }

  try {
    const files = fs.readdirSync(tokensPath);
    const npcs = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const tokenPath = path.join(tokensPath, file);
          const data = fs.readFileSync(tokenPath, 'utf-8');
          const token = JSON.parse(data);
          if (token.imageUrl && token.imageUrl.startsWith('/images/')) token.imageUrl = `/users/${currentShareKey}${token.imageUrl}`;
          if (token.states && Array.isArray(token.states)) {
            token.states = token.states.map(state => ({
              ...state,
              imageUrl: state.imageUrl && state.imageUrl.startsWith('/images/') ? `/users/${currentShareKey}${state.imageUrl}` : state.imageUrl
            }));
          }
          npcs.push(token);
        } catch (err) {
          console.error('tokens.loadNPCTokens failed for', file, err);
        }
      }
    }
    return npcs;
  } catch (error) {
    console.error('tokens.loadNPCTokens failed:', error);
    return [];
  }
}

function saveNPCToken(token) {
  try {
    const fs = ctx.fs;
    const path = ctx.path;
    const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
    const currentScenario = ctx.getCurrentScenario ? ctx.getCurrentScenario() : null;
    const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
    const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
    const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
    const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;

    if (!currentCampaign || !currentScenario || !currentShareKey) return;

    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const definitionPath = path.join(scenarioPath, 'npctokens');

    const tokenToSave = { ...token };
    if (tokenToSave.imageUrl && tokenToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.imageUrl = tokenToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }
    if (tokenToSave.states && Array.isArray(tokenToSave.states)) {
      tokenToSave.states = tokenToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`) ? state.imageUrl.replace(`/users/${currentShareKey}`, '') : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName) {
      const runtimePath = path.join(campaignsDir, currentCampaign, 'sessions', currentSessionName, 'scenarios', currentScenario, 'npctokens');
      if (!fs.existsSync(runtimePath)) fs.mkdirSync(runtimePath, { recursive: true });
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    } else {
      if (!fs.existsSync(definitionPath)) fs.mkdirSync(definitionPath, { recursive: true });
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    }
  } catch (error) {
    console.error('tokens.saveNPCToken failed:', error);
  }
}

function deleteNPCToken(tokenId) {
  try {
    const fs = ctx.fs;
    const path = ctx.path;
    const tokensPath = getNPCTokensPath();
    if (!tokensPath) return;
    const tokenPath = path.join(tokensPath, `${tokenId}.json`);
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  } catch (error) {
    console.error('tokens.deleteNPCToken failed:', error);
  }
}

// Update a token's position in the provided gameState and persist the token
export function updateTokenPosition(gameState, tokenId, x, y, currentlyFacing) {
  try {
    if (!gameState || !Array.isArray(gameState.tokens)) return null;
    const token = gameState.tokens.find(t => t.id === tokenId);
    if (!token) return null;

    token.x = x;
    token.y = y;
    if (currentlyFacing !== undefined) token.currentlyFacing = currentlyFacing;

    // Persist according to token type
    if (token.actor && token.actor.player) {
      // Player token
      savePlayerToken(token);
    } else {
      // NPC token
      saveNPCToken(token);
    }

    return token;
  } catch (err) {
    console.error('tokens.updateTokenPosition failed:', err);
    return null;
  }
}

export {
  getPlayerTokensPath,
  loadPlayerTokens,
  savePlayerToken,
  deletePlayerToken,
  getNPCTokensPath,
  loadNPCTokens,
  saveNPCToken,
  deleteNPCToken,
  // updateTokenPosition is exported via its function declaration
};

// Register express routes related to tokens
export function registerRoutes(app, options = {}) {
  const gameStateRef = options.gameState;
  const saveScenarioGameState = options.saveScenarioGameState;

  app.post('/api/update-token-position', express.json(), (req, res) => {
    console.log('Update token position request (tokens.registerRoutes):', req.body);
    const { tokenId, x, y, currentlyFacing } = req.body;
    if (!tokenId || x === undefined || y === undefined) {
      return res.status(400).json({ error: 'Token ID, x, and y are required' });
    }

    const tokenToUpdate = gameStateRef.tokens.find(t => t.id === tokenId);
    if (!tokenToUpdate) return res.status(404).json({ error: 'Token not found' });

    const isGM = req.user && req.user.role === 'gm';
    const isPlayerToken = tokenToUpdate.actor?.player === true;
    if (!isGM && !isPlayerToken) return res.status(403).json({ error: 'Not authorized to move this token' });

    const updated = updateTokenPosition(gameStateRef, tokenId, x, y, currentlyFacing);
    if (!updated) return res.status(500).json({ error: 'Failed to update token' });

    // revealedPath logic (for player tokens)
    if (isPlayerToken) {
      let cellSize = 50;
      if (gameStateRef.imageDimensions && gameStateRef.imageDimensions.width && gameStateRef.gridColumns > 0) {
        cellSize = gameStateRef.imageDimensions.width / gameStateRef.gridColumns;
      }
      const gridX = Math.floor(x / cellSize);
      const gridY = Math.floor(y / cellSize);
      const isAlreadyRevealed = gameStateRef.revealedPath.some(p => p.x === gridX && p.y === gridY);
      if (!isAlreadyRevealed) gameStateRef.revealedPath.push({ x: gridX, y: gridY });
    }

    if (typeof saveScenarioGameState === 'function') saveScenarioGameState(gameStateRef);
    res.json({ success: true, token: updated });
  });

  app.post('/api/update-token-state', express.json(), (req, res) => {
    console.log('Update token state request (tokens.registerRoutes):', req.body);
    const { tokenId, activeState } = req.body;
    if (!tokenId) return res.status(400).json({ error: 'Token ID is required' });

    const tokenToUpdate = gameStateRef.tokens.find(t => t.id === tokenId);
    if (!tokenToUpdate) return res.status(404).json({ error: 'Token not found' });

    const isGM = req.user && req.user.role === 'gm';
    const isPlayerToken = tokenToUpdate.actor?.player === true;
    if (!isGM && !isPlayerToken) return res.status(403).json({ error: 'Not authorized to change this token state' });

    tokenToUpdate.activeState = activeState;
    if (isPlayerToken) savePlayerToken(tokenToUpdate); else saveNPCToken(tokenToUpdate);
    if (typeof saveScenarioGameState === 'function') saveScenarioGameState(gameStateRef);
    res.json({ success: true, token: tokenToUpdate });
  });
}

// Helper function to fix image paths in a token or prop
export function fixTokenImagePaths(item, shareKey) {
  if (!item || !shareKey) return item;

  // Fix base image URL
  if (item.imageUrl) {
    item.imageUrl = fixImagePath(item.imageUrl, shareKey);
  }

  // Fix state image URLs
  if (item.states && Array.isArray(item.states)) {
    item.states = item.states.map(state => ({
      ...state,
      imageUrl: state.imageUrl ? fixImagePath(state.imageUrl, shareKey) : state.imageUrl
    }));
  }

  return item;
}
