// WebSocket message handlers for server
import * as tokens from './tokens.js';

export function handleWebSocketMessage(message, context) {
  try {
    const { gameState, campaign, session, sessionKey, saveScenarioGameState, broadcast } = context;
    console.log('wsHandlers: handling message', message.type, 'for', sessionKey);

    if (message.type === 'fogToggled') {
      gameState.fogEnabled = message.data.fogEnabled;
      if (typeof saveScenarioGameState === 'function') saveScenarioGameState(gameState);
      // Broadcast to all clients in this session
      if (typeof broadcast === 'function') {
        broadcast(campaign, session, {
          type: 'fogToggled',
          data: { fogEnabled: message.data.fogEnabled }
        });
      }
    } else if (message.type === 'tokenMoved') {
      // Delegate update & persistence to tokens module
      const updated = tokens.updateTokenPosition(gameState, message.data.tokenId, message.data.x, message.data.y, message.data.currentlyFacing);
      if (updated) {
        if (typeof saveScenarioGameState === 'function') saveScenarioGameState(gameState);
        if (typeof broadcast === 'function') {
          broadcast(campaign, session, {
            type: 'tokenMoved',
            data: {
              tokenId: message.data.tokenId,
              x: message.data.x,
              y: message.data.y,
              currentlyFacing: message.data.currentlyFacing
            }
          });
        }
      }
    } else {
      // Unknown message type - ignore or log
      console.log('wsHandlers: unknown message type', message.type);
    }
  } catch (err) {
    console.error('wsHandlers error handling message:', err);
  }
}