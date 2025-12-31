import { useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config';

interface WebSocketMessage {
  type: string;
  data: any;
}

type MessageHandler = (data: any) => void;

export function useGameWebSocket(campaign: string | undefined, session: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, MessageHandler[]>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Subscribe to a message type
  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, []);
    }
    handlersRef.current.get(type)!.push(handler);

    return () => {
      const handlers = handlersRef.current.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }, []);

  // Send a message
  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    if (!campaign || !session) {
      return;
    }

    const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws?campaign=${encodeURIComponent(campaign)}&session=${encodeURIComponent(session)}`;
    console.log('WebSocket: Connecting to', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected to session:', `${campaign}/${session}`);
        wsRef.current = ws;
        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log('WebSocket received:', message.type);
          
          // Call all handlers for this message type
          const handlers = handlersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach(handler => handler(message.data));
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        wsRef.current = null;
        
        // Attempt reconnect after 3 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('WebSocket: Attempting to reconnect...');
          // Re-trigger the effect by changing dependencies
        }, 3000);
      };

      return () => {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
    }
  }, [campaign, session]);

  return { send, subscribe, isConnected: wsRef.current?.readyState === WebSocket.OPEN };
}
