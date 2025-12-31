// session connection tracking and broadcast helpers
export const sessionConnections = new Map();

export function broadcast(campaign, session, message) {
  const sessionKey = `${campaign}/${session}`;
  const clients = sessionConnections.get(sessionKey);

  if (clients) {
    const data = JSON.stringify(message);
    clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    });
  }
}
