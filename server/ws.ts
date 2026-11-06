import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  MAX_PLAYERS, TICK_RATE, WORLD_W, WORLD_H,
  parseClientMessage, sanitizeInput, asEntityId,
  type ClientMessage, type InputMessage, type JoinMessage,
  type PingMessage, type ConfigMessage, type ChatMessage,
} from 'shared';
import { roomManager, type Room, type Player } from './rooms.ts';
import { LinkSim } from './netsim.ts';

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket: WebSocket) => {
    let currentRoom: Room | null = null;
    let currentPlayer: Player | null = null;
    let codec: 'json' | 'binary' = 'binary';
    const link = new LinkSim();

    let messageCount = 0;
    const rateLimitInterval = setInterval(() => {
      messageCount = 0;
    }, 1000);

    const sendJson = (msg: unknown): void => {
      if (socket.readyState !== socket.OPEN) return;
      link.deliver(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      });
    };

    const broadcastPlayers = (): void => {
      if (!currentRoom) return;
      const players = [...currentRoom.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: 0,
      }));
      for (const p of currentRoom.players.values()) {
        p.sendJson({ type: 'players', players });
      }
    };

    const handleInput = (msg: { seq: number; thrust: number; turn: number; fire: number }): void => {
      if (!currentPlayer || !currentRoom) return;
      const input = sanitizeInput(msg);
      if (!input) {
        currentRoom.match.stats.invalidInputs++;
        return;
      }
      currentRoom.match.receiveInput(currentPlayer, input);
    };

    const handleJoin = (msg: JoinMessage): void => {
      if (currentPlayer) return;

      const room = roomManager.get(msg.room);
      if (!room) {
        socket.close(1008, 'Room not found');
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        socket.close(1008, 'Room full');
        return;
      }
      currentRoom = room;

      let name = msg.name.slice(0, 24);
      const taken = new Set([...currentRoom.players.values()].map((p) => p.name));
      for (let n = 2; taken.has(name); n++) {
        name = `${msg.name.slice(0, 20)} (${n})`;
      }

      currentPlayer = {
        id: asEntityId(0),
        name,
        socket,
        link,
        codec,
        queue: [],
        lastSeq: 0,
        ack: 0,
        bytesIn: 0,
        bytesOut: 0,
        sendJson,
        sendRaw(data: string | Uint8Array): void {
          if (socket.readyState !== socket.OPEN || socket.bufferedAmount > 1 << 20) return;
          link.deliver(() => {
            if (socket.readyState !== socket.OPEN) return;
            socket.send(data, { binary: typeof data !== 'string' });
            if (currentPlayer) {
              currentPlayer.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
            }
          });
        },
      };

      const ship = currentRoom.match.addPlayer(currentPlayer);
      currentRoom.emit('join', currentPlayer);
      console.log(`${name} joined room ${msg.room}`);

      sendJson({
        type: 'welcome',
        id: ship.id,
        seed: currentRoom.match.seed,
        tickRate: TICK_RATE,
        world: { w: WORLD_W, h: WORLD_H },
        codec,
        net: link.settings,
      });
      broadcastPlayers();
    };

    const handlePing = (msg: PingMessage): void => {
      sendJson({ type: 'pong', t: msg.t });
    };

    const handleConfig = (msg: ConfigMessage): void => {
      link.set(msg);
      if (currentPlayer && (msg.codec === 'json' || msg.codec === 'binary')) {
        currentPlayer.codec = msg.codec;
      }
      sendJson({ type: 'config', net: link.settings, codec: currentPlayer?.codec ?? codec });
    };

    const handleChat = (_msg: ChatMessage): void => {
      // Chat message placeholder
    };

    const dispatchClientMessage = (msg: ClientMessage): void => {
      switch (msg.type) {
        case 'input':
          handleInput(msg);
          break;
        case 'join':
          handleJoin(msg);
          break;
        case 'ping':
          handlePing(msg);
          break;
        case 'config':
          handleConfig(msg);
          break;
        case 'chat':
          handleChat(msg);
          break;
        default: {
          const _exhaustive: never = msg;
          return _exhaustive;
        }
      }
    };

    socket.on('message', (data: RawData, isBinary: boolean) => {
      const byteLen = Array.isArray(data)
        ? data.reduce((acc, b) => acc + b.length, 0)
        : data instanceof ArrayBuffer ? data.byteLength : data.length;

      if (byteLen > 1024) {
        socket.close(1009, 'Message too large');
        return;
      }

      link.deliver(() => {
        try {
          const payload: string | Uint8Array = isBinary
            ? (data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : Array.isArray(data)
                  ? Buffer.concat(data)
                  : data)
            : data.toString();

          const result = parseClientMessage(payload);
          if (!result.ok) {
            console.warn(`[ws] parseClientMessage error: ${result.error}`);
            socket.close(1003, 'Invalid message');
            return;
          }

          const msg = result.value;
          if (currentPlayer) currentPlayer.bytesIn += byteLen;

          if (msg.type === 'input') {
            handleInput(msg);
            return;
          }

          messageCount++;
          if (messageCount > 20) {
            socket.close(1008, 'Rate limit exceeded');
            return;
          }

          dispatchClientMessage(msg);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn('[ws] message processing error:', errMsg);
          socket.close(1003, 'Invalid message');
        }
      });
    });

    socket.on('close', () => {
      clearInterval(rateLimitInterval);
      link.close();
      if (currentRoom && currentPlayer) {
        currentRoom.match.removePlayer(currentPlayer);
        broadcastPlayers();
        if (currentRoom.players.size === 0) {
          currentRoom.emit('empty');
        }
      }
      console.log('WebSocket connection closed');
    });
  });

  return wss;
}
