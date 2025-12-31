// Scenario state helpers (moved out for modularization)
let ctx = {};

export function setContext(context) {
  ctx = context || {};
}

export function getScenarioGameStatePath() {
  const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
  const currentScenario = ctx.getCurrentScenario ? ctx.getCurrentScenario() : null;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
  const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
  const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
  const fs = ctx.fs;
  const path = ctx.path;
  const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;

  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);

  if (isSessionActive && currentSessionName) {
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, '.runtime-state.json');
  }

  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);
  return path.join(scenarioPath, '.scenario-state.json');
}

export function loadScenarioGameState() {
  const fs = ctx.fs;
  const path = ctx.path;
  const getScenarioGameStatePathFn = getScenarioGameStatePath;
  const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;

  const statePath = getScenarioGameStatePathFn();
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
    const playerTokens = ctx.loadPlayerTokens ? ctx.loadPlayerTokens() : [];
    const npcTokens = ctx.loadNPCTokens ? ctx.loadNPCTokens() : [];
    const props = ctx.loadProps ? ctx.loadProps() : [];

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
    console.error('scenarioState.loadScenarioGameState failed:', error);
    return null;
  }
}

export function saveScenarioGameState(state) {
  try {
    const currentCampaign = ctx.getCurrentCampaign ? ctx.getCurrentCampaign() : null;
    const currentScenario = ctx.getCurrentScenario ? ctx.getCurrentScenario() : null;
    const currentShareKey = ctx.getCurrentShareKey ? ctx.getCurrentShareKey() : null;
    const isSessionActive = ctx.isSessionActive ? ctx.isSessionActive() : false;
    const currentSessionName = ctx.getCurrentSessionName ? ctx.getCurrentSessionName() : null;
    const getShareKeyCampaignsDir = ctx.getShareKeyCampaignsDir;
    const fs = ctx.fs;
    const path = ctx.path;
    const saveMapMetadata = ctx.saveMapMetadata;
    const savePlayerToken = ctx.savePlayerToken;

    if (!currentCampaign || !currentScenario || !currentShareKey) return;

    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const definitionPath = path.join(scenarioPath, '.scenario-state.json');

    // Filter out tokens and props - they're saved separately
    const stateToSave = {
      ...state,
      tokens: [],
      props: []
    };

    // Strip API URL prefix and sharekey prefix from backgroundImage before saving
    if (stateToSave.backgroundImage) {
      let cleanPath = stateToSave.backgroundImage.replace(/^(https?:\/\/[^\/]+)+/g, '');
      if (cleanPath.startsWith(`/users/${currentShareKey}/`)) {
        cleanPath = cleanPath.replace(`/users/${currentShareKey}`, '');
      }
      stateToSave.backgroundImage = cleanPath;
    }

    if (isSessionActive && currentSessionName) {
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, '.runtime-state.json');
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      fs.writeFileSync(runtimePath, JSON.stringify(stateToSave, null, 2));
    } else {
      let existingData = {};
      if (fs.existsSync(definitionPath)) {
        existingData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      }
      const finalState = {
        ...stateToSave,
        lastSessionPlayed: existingData.lastSessionPlayed
      };
      fs.writeFileSync(definitionPath, JSON.stringify(finalState, null, 2));

      // Also save map metadata (fog settings, reveal zones, etc.)
      if (typeof saveMapMetadata === 'function') saveMapMetadata(state);
    }
  } catch (error) {
    console.error('scenarioState.saveScenarioGameState failed:', error);
  }
}

// exports are provided via the individual `export function` declarations above
