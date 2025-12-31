/**
 * Scenario and Map Management Module
 * Handles scenario creation, editing, archiving, and map loading/saving
 */

import fs from 'fs';
import path from 'path';

let context = null;

/**
 * Initialize module with runtime context
 */
export function setContext(ctx) {
  context = ctx;
}

/**
 * Helper function to save map metadata (fog settings, reveal zones, etc.)
 */
function saveMapMetadata(state) {
  if (!context.getCurrentCampaign() || !context.getCurrentScenario() || !context.getCurrentShareKey()) {
    return;
  }

  const campaignsDir = context.getShareKeyCampaignsDir(context.getCurrentShareKey());
  const scenarioPath = path.join(campaignsDir, context.getCurrentCampaign(), 'scenarios', context.getCurrentScenario());

  // Extract filename from backgroundImage path
  const filename = state.backgroundImage.split('/').pop();
  if (!filename) return;

  const metadataPath = path.join(scenarioPath, ".scenario-state.json");

  try {
    let metadata = {};
    if (fs.existsSync(metadataPath)) {
      const data = fs.readFileSync(metadataPath, 'utf8');
      metadata = JSON.parse(data);
    }

    // Update metadata with current state values
    metadata.backgroundImage = state.backgroundImage;
    metadata.fogEnabled = state.fogEnabled;
    metadata.fogRevealDistance = state.fogRevealDistance;
    metadata.lightingCondition = state.lightingCondition;
    metadata.revealedPath = state.revealedPath || [];
    metadata.revealZones = state.revealZones || [];
    metadata.permanentlyRevealedZones = state.permanentlyRevealedZones || [];
    metadata.gridColumns = state.gridColumns;
    metadata.gridRows = state.gridRows;
    metadata.showGrid = state.showGrid !== undefined ? state.showGrid : true;

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log('Map metadata saved to:', metadataPath);
  } catch (error) {
    console.error('Failed to save map metadata:', error);
  }
}

/**
 * Register scenario-related HTTP endpoints
 */
export function registerRoutes(app, dependencies) {
  const { 
    requireAuth, 
    requireGM, 
    provideShareKey, 
    getShareKeyCampaignsDir,
    getShareKeyArchivedCampaignsDir,
    gameState,
    loadScenarioGameState,
    saveScenarioGameState,
    loadPlayerTokens,
    loadNPCTokens,
    loadProps,
    fixTokenImagePaths,
    express
  } = dependencies;

  // Save map metadata endpoint
  app.post('/api/map-metadata/:filename', requireGM, (req, res) => {
    const { state } = req.body;
    if (!state) {
      return res.status(400).json({ error: 'State required' });
    }
    saveMapMetadata(state);
    res.json({ success: true });
  });

  // Get scenarios for a campaign
  app.get('/api/campaigns/:campaignName/scenarios', requireAuth, provideShareKey, (req, res) => {
    const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
    const campaignPath = path.join(campaignsDir, req.params.campaignName);
    const scenariosPath = path.join(campaignPath, 'scenarios');

    // Get campaign metadata for background image
    let campaignBackgroundImage = undefined;
    const campaignMetadataPath = path.join(campaignPath, '.metadata.json');
    if (fs.existsSync(campaignMetadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(campaignMetadataPath, 'utf-8'));
        // Convert old image paths to sharekey-based paths
        if (metadata.backgroundImage) {
          if (metadata.backgroundImage.startsWith('/images/')) {
            metadata.backgroundImage = `/users/${req.shareKey}${metadata.backgroundImage}`;
          } else {
            campaignBackgroundImage = metadata.backgroundImage;
          }
        }
      } catch (err) {
        console.error('Failed to read campaign metadata:', err);
      }
    }

    if (!fs.existsSync(scenariosPath)) {
      return res.json({ scenarios: [], campaignBackgroundImage });
    }

    fs.readdir(scenariosPath, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read scenarios' });
      }

      const scenarios = files
        .filter(file => {
          const stat = fs.statSync(path.join(scenariosPath, file));
          return stat.isDirectory();
        })
        .map(scenarioName => {
          const scenarioPath = path.join(scenariosPath, scenarioName);
          const maps = fs.readdirSync(scenarioPath).filter(file => file.endsWith('.json'));

          let description = '';
          const metadataPath = path.join(scenarioPath, '.metadata.json');
          if (fs.existsSync(metadataPath)) {
            try {
              const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
              description = JSON.parse(metadataContent).description || '';
            } catch (err) {
              console.error('Failed to read scenario metadata:', err);
            }
          }

          // Get background image from scenario state
          let mapImageUrl = undefined;
          const scenarioStatePath = path.join(scenarioPath, '.scenario-state.json');
          if (fs.existsSync(scenarioStatePath)) {
            try {
              const stateContent = fs.readFileSync(scenarioStatePath, 'utf-8');
              const state = JSON.parse(stateContent);
              if (state.backgroundImage) {
                if (state.backgroundImage.startsWith('/images/')) {
                  mapImageUrl = `/users/${req.shareKey}${state.backgroundImage}`;
                } else {
                  mapImageUrl = state.backgroundImage;
                }
              }
            } catch (err) {
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

  // Create a new scenario
  app.post('/api/campaigns/:campaignName/scenarios', requireGM, provideShareKey, express.json(), (req, res) => {
    const { name } = req.body;
    const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
    const campaignPath = path.join(campaignsDir, req.params.campaignName);
    const scenariosPath = path.join(campaignPath, 'scenarios');

    if (!name) {
      return res.status(400).json({ error: 'Scenario name required' });
    }

    if (!fs.existsSync(campaignPath)) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (!fs.existsSync(scenariosPath)) {
      fs.mkdirSync(scenariosPath, { recursive: true });
    }

    const scenarioPath = path.join(scenariosPath, name);

    if (fs.existsSync(scenarioPath)) {
      return res.status(400).json({ error: 'Scenario already exists' });
    }

    // Create scenario directory
    fs.mkdirSync(scenarioPath, { recursive: true });

    res.json({ success: true, name });
  });

  // Check if scenario has any existing maps
  app.get('/api/scenario-maps', requireAuth, (req, res) => {
    const currentCampaign = context.getCurrentCampaign();
    const currentScenario = context.getCurrentScenario();
    const currentShareKey = context.getCurrentShareKey();

    if (!currentCampaign || !currentScenario || !currentShareKey) {
      return res.status(400).json({ error: 'No campaign/scenario context set' });
    }

    const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);

    if (!fs.existsSync(scenarioPath)) {
      return res.json({ hasExistingMap: false });
    }

    try {
      // Check if there's a saved scenario state with backgroundImage
      const savedState = loadScenarioGameState();
      if (savedState && savedState.backgroundImage) {
        return res.json({
          hasExistingMap: true,
          backgroundImage: savedState.backgroundImage
        });
      }

      return res.json({ hasExistingMap: false });
    } catch (error) {
      console.error('Error checking scenario maps:', error);
      return res.json({ hasExistingMap: false });
    }
  });

  // Update scenario (description and/or rename)
  app.patch('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, express.json(), (req, res) => {
    const { description, newName } = req.body;
    const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
    const campaignPath = path.join(campaignsDir, req.params.campaignName);
    const scenariosPath = path.join(campaignPath, 'scenarios');
    const scenarioPath = path.join(scenariosPath, req.params.scenarioName);

    if (!fs.existsSync(scenarioPath)) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    try {
      if (description !== undefined) {
        const metadataPath = path.join(scenarioPath, '.metadata.json');
        const metadata = { description };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      }

      if (newName && newName !== req.params.scenarioName) {
        const newPath = path.join(scenariosPath, newName);

        if (fs.existsSync(newPath)) {
          return res.status(400).json({ error: 'A scenario with that name already exists' });
        }

        if (context.getCurrentCampaign() === req.params.campaignName && context.getCurrentScenario() === req.params.scenarioName) {
          return res.status(400).json({ error: 'Cannot rename the current active scenario' });
        }

        try {
          fs.cpSync(scenarioPath, newPath, { recursive: true });
          fs.rmSync(scenarioPath, { recursive: true, force: true });
        } catch (err) {
          if (fs.existsSync(newPath)) {
            try {
              fs.rmSync(newPath, { recursive: true, force: true });
            } catch (cleanupErr) {
              console.error('Failed to clean up partial copy:', cleanupErr);
            }
          }
          throw err;
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error updating scenario:', err);
      res.status(500).json({ error: 'Failed to update scenario' });
    }
  });

  // Archive a scenario (delete with archive)
  app.delete('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, (req, res) => {
    const { campaignName, scenarioName } = req.params;
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const campaignsDir = getShareKeyCampaignsDir(shareKey);
    const campaignPath = path.join(campaignsDir, campaignName);
    const scenariosPath = path.join(campaignPath, 'scenarios');
    const scenarioPath = path.join(scenariosPath, scenarioName);
    const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

    if (!fs.existsSync(scenarioPath)) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    // Create archived scenarios path with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const archivedPath = path.join(archivedScenariosPath, `${scenarioName}_${timestamp}`);

    try {
      // Use copy + delete approach to avoid Windows permission issues
      fs.cpSync(scenarioPath, archivedPath, { recursive: true });
      fs.rmSync(scenarioPath, { recursive: true, force: true });
      res.json({ success: true, message: 'Scenario archived successfully' });
    } catch (error) {
      console.error('Error archiving scenario:', error);
      // Clean up partial copy if it exists
      if (fs.existsSync(archivedPath)) {
        try {
          fs.rmSync(archivedPath, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.error('Failed to clean up partial copy:', cleanupErr);
        }
      }
      res.status(500).json({ error: 'Failed to archive scenario' });
    }
  });

  // Get archived scenarios for a campaign
  app.get('/api/campaigns/:campaignName/archived-scenarios', requireGM, provideShareKey, (req, res) => {
    const { campaignName } = req.params;
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.json({ archived: [] });
    }

    const campaignsDir = getShareKeyCampaignsDir(shareKey);
    const campaignPath = path.join(campaignsDir, campaignName);
    const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

    if (!fs.existsSync(archivedScenariosPath)) {
      return res.json({ archived: [] });
    }

    fs.readdir(archivedScenariosPath, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read archived scenarios' });
      }

      const archived = files
        .filter(file => {
          const stat = fs.statSync(path.join(archivedScenariosPath, file));
          return stat.isDirectory();
        })
        .map(folderName => {
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
  app.post('/api/campaigns/:campaignName/archived-scenarios/:folderName/restore', requireGM, provideShareKey, (req, res) => {
    const { campaignName, folderName } = req.params;
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const campaignsDir = getShareKeyCampaignsDir(shareKey);
    const campaignPath = path.join(campaignsDir, campaignName);
    const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
    const scenariosPath = path.join(campaignPath, 'scenarios');
    const archivedPath = path.join(archivedScenariosPath, folderName);

    if (!fs.existsSync(archivedPath)) {
      return res.status(404).json({ error: 'Archived scenario not found' });
    }

    // Extract original name
    const lastUnderscore = folderName.lastIndexOf('_');
    const originalName = folderName.substring(0, lastUnderscore);
    const restoredPath = path.join(scenariosPath, originalName);

    // Check if a scenario with the same name already exists
    if (fs.existsSync(restoredPath)) {
      return res.status(400).json({ error: 'A scenario with this name already exists' });
    }

    try {
      // Move archived folder back to scenarios
      fs.renameSync(archivedPath, restoredPath);
      res.json({ success: true, message: 'Scenario restored successfully' });
    } catch (error) {
      console.error('Error restoring scenario:', error);
      res.status(500).json({ error: 'Failed to restore scenario' });
    }
  });

  // Permanently delete archived scenario
  app.delete('/api/campaigns/:campaignName/archived-scenarios/:folderName', requireGM, provideShareKey, (req, res) => {
    const { campaignName, folderName } = req.params;
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const campaignsDir = getShareKeyCampaignsDir(shareKey);
    const campaignPath = path.join(campaignsDir, campaignName);
    const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
    const archivedPath = path.join(archivedScenariosPath, folderName);

    if (!fs.existsSync(archivedPath)) {
      return res.status(404).json({ error: 'Archived scenario not found' });
    }

    try {
      // Permanently delete the archived folder
      fs.rmSync(archivedPath, { recursive: true, force: true });
      res.json({ success: true, message: 'Scenario permanently deleted' });
    } catch (error) {
      console.error('Error deleting archived scenario:', error);
      res.status(500).json({ error: 'Failed to delete scenario' });
    }
  });

  // Set campaign/scenario context
  app.post('/api/set-context', requireGM, provideShareKey, express.json(), (req, res) => {
    const { campaign, scenario } = req.body;
    const shareKey = req.shareKey;

    if (!shareKey) {
      return res.status(400).json({ error: 'No share key selected' });
    }

    const campaignsDir = getShareKeyCampaignsDir(shareKey);

    if (!campaign || !scenario) {
      return res.status(400).json({ error: 'Campaign and scenario required' });
    }

    const scenarioPath = path.join(campaignsDir, campaign, 'scenarios', scenario);

    if (!fs.existsSync(scenarioPath)) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    context.setCurrentCampaign(campaign);
    context.setCurrentScenario(scenario);
    context.setCurrentUserId(req.user.id);
    context.setCurrentShareKey(shareKey);

    // Only clear session state if we're not already in an active session
    // If a session is already active, preserve it (GM is continuing a game)
    if (!context.isSessionActive()) {
      context.setCurrentSessionName(null);
      console.log('Context set to:', campaign, '/', scenario, '(EDIT MODE)');
    } else {
      console.log('Context set to:', campaign, '/', scenario, '(GAME MODE - preserving active session:', context.getCurrentSessionName(), ')');
    }

    // Load scenario game state from file if it exists
    const savedState = loadScenarioGameState();
    if (savedState) {
      context.setGameState({ ...savedState });
      console.log('Loaded scenario game state from file');
    } else {
      // Reset to default state if no saved state exists
      context.setGameState({
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
      });
    }

    res.json({ success: true, campaign, scenario });
  });

  // Load a map - reads from JSON file and sets it as current state
  app.post('/api/load-map', requireGM, express.json(), (req, res) => {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename required' });
    }

    const currentCampaign = context.getCurrentCampaign();
    const currentScenario = context.getCurrentScenario();
    const currentShareKey = context.getCurrentShareKey();

    if (!currentCampaign || !currentScenario || !currentShareKey) {
      return res.status(400).json({ error: 'No campaign/scenario context set' });
    }

    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const metadataPath = path.join(scenarioPath, '.scenario-state.json');

    // Load metadata from file
    if (fs.existsSync(metadataPath)) {
      try {
        const data = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(data);

        // Load player tokens from campaign directory and NPC tokens from scenario directory
        const playerTokens = loadPlayerTokens();
        const npcTokens = loadNPCTokens();
        const props = loadProps();

        // Preserve runtime-only values from existing gameState
        const currentGameState = context.getGameState();
        const currentActorId = currentGameState.currentActorId;
        const showObserverCards = currentGameState.showObserverCards;

        // Set as current game state, merging player and NPC tokens
        const newGameState = {
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

        context.setGameState(newGameState);
        res.json({ success: true, state: newGameState });
      } catch (error) {
        console.error('Failed to parse metadata:', error);
        res.status(500).json({ error: 'Failed to parse metadata file' });
      }
    } else {
      // No metadata file, create default state with player tokens
      const playerTokens = loadPlayerTokens();
      const props = loadProps();

      // Preserve runtime-only values from existing gameState
      const currentGameState = context.getGameState();
      const currentActorId = currentGameState.currentActorId;
      const showObserverCards = currentGameState.showObserverCards;

      const newGameState = {
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

      context.setGameState(newGameState);
      res.json({ success: true, state: newGameState });
    }
  });

  // Get scenario metadata (including lastSessionPlayed)
  app.get('/api/scenario-metadata', requireAuth, (req, res) => {
    const currentCampaign = context.getCurrentCampaign();
    const currentScenario = context.getCurrentScenario();
    const currentShareKey = context.getCurrentShareKey();

    if (!currentCampaign || !currentScenario || !currentShareKey) {
      return res.json({ lastSessionPlayed: null });
    }

    try {
      const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
      const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
      const definitionPath = path.join(scenarioPath, '.scenario-state.json');

      if (!fs.existsSync(definitionPath)) {
        return res.json({ lastSessionPlayed: null });
      }

      const definitionData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      res.json({ lastSessionPlayed: definitionData.lastSessionPlayed || null });
    } catch (err) {
      console.error('Failed to get scenario metadata:', err);
      res.status(500).json({ error: 'Failed to get scenario metadata' });
    }
  });
}
