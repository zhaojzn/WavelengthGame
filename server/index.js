import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// Serve built files in production
app.use(express.static(join(__dirname, '..', 'dist')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
});

// ==================== SPECTRUM CARDS ====================
const spectrumCards = [
  ["Hot","Cold"],["Overrated","Underrated"],["Good","Evil"],["Fantasy","Reality"],
  ["Rough","Smooth"],["Sad Song","Happy Song"],["Useless Superpower","Useful Superpower"],
  ["Harmless","Harmful"],["Boring","Exciting"],["Ugly","Beautiful"],
  ["Terrible Movie","Great Movie"],["Easy to Spell","Hard to Spell"],
  ["Guilty Pleasure","Healthy Hobby"],["Round","Pointy"],["Smells Bad","Smells Good"],
  ["Mainstream","Niche"],["Old School","Modern"],["Cheap","Expensive"],
  ["Quiet","Loud"],["Small","Big"],["Slow","Fast"],["Weak","Strong"],
  ["Simple","Complex"],["Common","Rare"],["Light","Heavy"],["Sweet","Sour"],
  ["Safe","Dangerous"],["Normal","Weird"],["Easy","Difficult"],["Funny","Serious"],
  ["Tastes Bad","Tastes Good"],["Villain","Hero"],["Short-lived","Long-lasting"],
  ["Forgettable","Unforgettable"],["Relaxing","Stressful"],["Soft","Hard"],
  ["Wet","Dry"],["Man-made","Natural"],["Empty","Full"],["Young","Old"],
  ["Bad First Date","Good First Date"],["Needs Salt","Too Salty"],
  ["Underpaid","Overpaid"],["Movie","Book"],["Brain","Brawn"],
  ["Introvert","Extrovert"],["Cat Person","Dog Person"],
  ["Morning Person","Night Owl"],["Indoor Activity","Outdoor Activity"],
  ["Sandwich","Not a Sandwich"],["Skill","Luck"],["Art","Science"],
  ["Tourist Trap","Hidden Gem"],["Trend","Classic"],["Cringe","Cool"],
  ["Snack","Meal"],["Bad Habit","Good Habit"],["Scary","Not Scary"],
  ["Romantic","Unromantic"],["Childhood","Adulthood"],
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomTarget() {
  return Math.random() * 140 + 20;
}

function getPoints(diff) {
  if (diff <= 5) return 4;
  if (diff <= 12) return 3;
  if (diff <= 22) return 2;
  if (diff <= 35) return 1;
  return 0;
}

// ==================== ROOM MANAGEMENT ====================
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const sessionToRoom = new Map(); // sessionId -> { roomCode, playerName }

function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function createRoom(hostSocketId, playerName, sessionId) {
  const code = generateCode();
  if (!code) return null;

  const room = {
    code,
    hostId: sessionId,
    players: new Map(), // sessionId -> { name, socketId, teamIndex, isMaster, connected }
    game: null,
    createdAt: Date.now(),
  };

  room.players.set(sessionId, {
    name: playerName,
    socketId: hostSocketId,
    teamIndex: null,
    isMaster: false,
    connected: true,
  });

  rooms.set(code, room);
  sessionToRoom.set(sessionId, code);
  return room;
}

function getRoomState(room) {
  const players = [];
  for (const [sessionId, p] of room.players) {
    players.push({
      sessionId,
      name: p.name,
      teamIndex: p.teamIndex,
      isMaster: p.isMaster,
      connected: p.connected,
      isHost: sessionId === room.hostId,
    });
  }

  const state = {
    code: room.code,
    hostId: room.hostId,
    players,
    teamNames: room.teamNames || ['Team 1', 'Team 2'],
  };

  if (room.game) {
    state.game = {
      mode: room.game.mode || 'classic',
      phase: room.game.phase,
      offenseTeamIdx: room.game.offenseTeamIdx,
      round: room.game.round,
      scores: room.game.scores,
      card: room.game.cards[room.game.cardIndex],
      clue: room.game.clue,
      offenseAngle: room.game.offenseAngle,
      defenseAngle: room.game.defenseAngle,
      revealResult: room.game.revealResult,
    };
  }

  return state;
}

function getPlayerRole(room, sessionId) {
  const player = room.players.get(sessionId);
  if (!player || player.teamIndex === null) return 'spectator';
  const game = room.game;
  if (!game) return 'lobby';

  const isOffenseTeam = player.teamIndex === game.offenseTeamIdx;
  if (isOffenseTeam && player.isMaster) return 'offense-master';
  if (isOffenseTeam) return 'offense-player';
  if (!isOffenseTeam && player.isMaster) return 'defense-master';
  return 'defense-player';
}

// ==================== SOCKET HANDLERS ====================
io.on('connection', (socket) => {
  console.log(`[connect] socket=${socket.id}`);
  let mySessionId = null;
  let myRoomCode = null;

  socket.on('create-room', ({ playerName, sessionId }) => {
    console.log(`[create-room] player=${playerName} session=${sessionId}`);
    const room = createRoom(socket.id, playerName, sessionId);
    if (!room) {
      socket.emit('error-msg', { message: 'Could not create room, try again.' });
      return;
    }
    mySessionId = sessionId;
    myRoomCode = room.code;
    socket.join(room.code);
    console.log(`[create-room] created room=${room.code}, total rooms=${rooms.size}`);
    socket.emit('room-created', { roomCode: room.code });
    io.to(room.code).emit('room-state', getRoomState(room));
  });

  socket.on('join-room', ({ roomCode, playerName, sessionId }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    console.log(`[join-room] player=${playerName} code=${code} found=${!!room} allRooms=[${[...rooms.keys()].join(',')}]`);
    if (!room) {
      socket.emit('error-msg', { message: 'Room not found.' });
      return;
    }

    // Reconnection: if sessionId already in room, re-associate
    if (room.players.has(sessionId)) {
      const existing = room.players.get(sessionId);
      existing.socketId = socket.id;
      existing.connected = true;
      mySessionId = sessionId;
      myRoomCode = code;
      socket.join(code);
      sessionToRoom.set(sessionId, code);

      // Send full state
      socket.emit('room-joined', { roomCode: code });
      io.to(code).emit('room-state', getRoomState(room));

      // If game is in progress and this player is offense master, resend target
      if (room.game && getPlayerRole(room, sessionId) === 'offense-master' &&
          (room.game.phase === 'master-peek' || room.game.phase === 'offense-guess')) {
        socket.emit('target-angle', { targetAngle: room.game.targetAngle });
      }
      return;
    }

    // New player
    if (room.game && room.game.phase !== 'lobby') {
      socket.emit('error-msg', { message: 'Game already in progress.' });
      return;
    }

    room.players.set(sessionId, {
      name: playerName,
      socketId: socket.id,
      teamIndex: null,
      isMaster: false,
      connected: true,
    });

    mySessionId = sessionId;
    myRoomCode = code;
    sessionToRoom.set(sessionId, code);
    socket.join(code);
    socket.emit('room-joined', { roomCode: code });
    io.to(code).emit('room-state', getRoomState(room));
  });

  socket.on('join-team', ({ teamIndex, isMaster }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;

    const player = room.players.get(mySessionId);
    if (!player) return;

    // If claiming master, check if another player is already master on that team
    if (isMaster) {
      for (const [sid, p] of room.players) {
        if (sid !== mySessionId && p.teamIndex === teamIndex && p.isMaster) {
          socket.emit('error-msg', { message: 'That team already has a Master.' });
          return;
        }
      }
    }

    player.teamIndex = teamIndex;
    player.isMaster = isMaster;
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  socket.on('leave-team', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;
    const player = room.players.get(mySessionId);
    if (!player) return;

    player.teamIndex = null;
    player.isMaster = false;
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  socket.on('kick-player', ({ targetSessionId }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || room.hostId !== mySessionId) return; // host only
    if (targetSessionId === mySessionId) return; // can't kick yourself

    const kicked = room.players.get(targetSessionId);
    if (!kicked) return;

    // Notify the kicked player's socket
    const kickedSocket = io.sockets.sockets.get(kicked.socketId);
    if (kickedSocket) {
      kickedSocket.emit('kicked');
      kickedSocket.leave(myRoomCode);
    }

    room.players.delete(targetSessionId);
    sessionToRoom.delete(targetSessionId);
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  socket.on('update-team-name', ({ teamIndex, name }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;
    if (!room.teamNames) room.teamNames = ['Team 1', 'Team 2'];
    room.teamNames[teamIndex] = name || `Team ${teamIndex + 1}`;
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  socket.on('start-game', ({ customCards, gameMode } = {}) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || room.hostId !== mySessionId) return;

    // Validate: each team needs a master and at least one player
    const teamCounts = [{ master: false, players: 0 }, { master: false, players: 0 }];
    for (const [, p] of room.players) {
      if (p.teamIndex === 0 || p.teamIndex === 1) {
        teamCounts[p.teamIndex].players++;
        if (p.isMaster) teamCounts[p.teamIndex].master = true;
      }
    }

    if (!teamCounts[0].master || !teamCounts[1].master) {
      socket.emit('error-msg', { message: 'Each team needs a Master.' });
      return;
    }
    if (teamCounts[0].players < 2 || teamCounts[1].players < 2) {
      socket.emit('error-msg', { message: 'Each team needs a Master and at least 1 player.' });
      return;
    }

    // Build rotation order per team (masters first, then players)
    const team0Roster = [];
    const team1Roster = [];
    for (const [sid, p] of room.players) {
      if (p.teamIndex === 0) team0Roster.push(sid);
      if (p.teamIndex === 1) team1Roster.push(sid);
    }
    // Put current master first in the rotation
    team0Roster.sort((a, b) => (room.players.get(b).isMaster ? 1 : 0) - (room.players.get(a).isMaster ? 1 : 0));
    team1Roster.sort((a, b) => (room.players.get(b).isMaster ? 1 : 0) - (room.players.get(a).isMaster ? 1 : 0));

    const mode = gameMode === 'freeplay' ? 'freeplay' : 'classic';

    // Initialize game
    room.game = {
      mode,
      phase: 'master-peek',
      cards: shuffle(customCards && customCards.length >= 3 ? customCards : spectrumCards),
      cardIndex: 0,
      targetAngle: randomTarget(),
      offenseTeamIdx: 0, // In freeplay, this is the "master team" for this round
      offenseAngle: 90,
      defenseAngle: 90,
      clue: '',
      scores: [0, 0],
      round: 1,
      revealResult: null,
      masterRotation: [team0Roster, team1Roster],
      masterIndex: [0, 0],
      dialController: null,
    };

    io.to(myRoomCode).emit('room-state', getRoomState(room));

    // Send target to the master of the current team
    sendTargetToMaster(room);
  });

  socket.on('master-peek', () => {
    // Master already gets target on game start, this is just for UI confirmation
  });

  socket.on('submit-clue', ({ clue }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game || room.game.phase !== 'master-peek') return;
    if (getPlayerRole(room, mySessionId) !== 'offense-master') return;

    room.game.clue = clue;
    room.game.phase = 'offense-guess';
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  socket.on('grab-dial', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game) return;
    const role = getPlayerRole(room, mySessionId);
    const phase = room.game.phase;
    // Only allow the correct team's non-master players to grab
    if ((phase === 'offense-guess' && role === 'offense-player') ||
        (phase === 'defense-guess' && role === 'defense-player')) {
      if (!room.game.dialController || room.game.dialController === mySessionId) {
        room.game.dialController = mySessionId;
        const controllerName = room.players.get(mySessionId)?.name || '';
        io.to(myRoomCode).emit('dial-controller', { sessionId: mySessionId, name: controllerName });
      }
    }
  });

  socket.on('release-dial', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game) return;
    if (room.game.dialController === mySessionId) {
      room.game.dialController = null;
      io.to(myRoomCode).emit('dial-controller', { sessionId: null, name: null });
    }
  });

  socket.on('update-needle', ({ angle }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game) return;

    const role = getPlayerRole(room, mySessionId);
    // Only the current dial controller can move the needle
    if (room.game.dialController !== mySessionId) return;

    if (room.game.phase === 'offense-guess' && role === 'offense-player') {
      room.game.offenseAngle = angle;
      io.to(myRoomCode).emit('needle-update', { team: 'offense', angle });
    } else if (room.game.phase === 'defense-guess' && role === 'defense-player') {
      room.game.defenseAngle = angle;
      io.to(myRoomCode).emit('needle-update', { team: 'defense', angle });
    }
  });

  socket.on('lock-guess', ({ angle }) => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game) return;

    const role = getPlayerRole(room, mySessionId);

    // Only non-master players can lock guesses
    if (room.game.phase === 'offense-guess' && role === 'offense-player') {
      room.game.offenseAngle = angle;
      room.game.phase = 'defense-guess';
      room.game.dialController = null;
      io.to(myRoomCode).emit('dial-controller', { sessionId: null, name: null });
      io.to(myRoomCode).emit('room-state', getRoomState(room));
    } else if (room.game.phase === 'defense-guess' && role === 'defense-player') {
      room.game.defenseAngle = angle;

      // Calculate result
      const offDiff = Math.abs(room.game.offenseAngle - room.game.targetAngle);
      const defDiff = Math.abs(room.game.defenseAngle - room.game.targetAngle);
      const offenseCloser = offDiff < defDiff;
      const tied = Math.abs(offDiff - defDiff) < 0.01;

      const offenseTeamIdx = room.game.offenseTeamIdx;
      const defenseTeamIdx = offenseTeamIdx === 0 ? 1 : 0;

      if (room.game.mode === 'freeplay') {
        // Points based on difference between teams — closer team scores more
        const gap = Math.abs(offDiff - defDiff);
        let closerPoints, fartherPoints;
        if (tied) {
          closerPoints = 1;
          fartherPoints = 1;
        } else if (gap <= 5) {
          closerPoints = 2;
          fartherPoints = 1;
        } else if (gap <= 15) {
          closerPoints = 3;
          fartherPoints = 1;
        } else if (gap <= 30) {
          closerPoints = 4;
          fartherPoints = 0;
        } else {
          closerPoints = 4;
          fartherPoints = 0;
        }
        const offPoints = offenseCloser ? closerPoints : (tied ? 1 : fartherPoints);
        const defPoints = offenseCloser ? fartherPoints : (tied ? 1 : closerPoints);
        room.game.scores[offenseTeamIdx] += offPoints;
        room.game.scores[defenseTeamIdx] += defPoints;

        room.game.revealResult = {
          targetAngle: room.game.targetAngle,
          offenseAngle: room.game.offenseAngle,
          defenseAngle: room.game.defenseAngle,
          offDiff: Math.round(offDiff * 10) / 10,
          defDiff: Math.round(defDiff * 10) / 10,
          offenseCloser,
          tied,
          points: offPoints,
          offPoints,
          defPoints,
          freeplay: true,
        };
      } else {
        // Classic mode: offense scores only if closer
        const points = offenseCloser ? getPoints(offDiff) : 0;
        if (offenseCloser) {
          room.game.scores[offenseTeamIdx] += points;
        }

        room.game.revealResult = {
          targetAngle: room.game.targetAngle,
          offenseAngle: room.game.offenseAngle,
          defenseAngle: room.game.defenseAngle,
          offDiff: Math.round(offDiff * 10) / 10,
          defDiff: Math.round(defDiff * 10) / 10,
          offenseCloser,
          tied,
          points,
        };
      }

      const POINTS_TO_WIN = 10;
      if (room.game.scores[0] >= POINTS_TO_WIN || room.game.scores[1] >= POINTS_TO_WIN) {
        room.game.phase = 'game-over';
      } else {
        room.game.phase = 'reveal';
      }

      io.to(myRoomCode).emit('room-state', getRoomState(room));
    }
  });

  socket.on('next-round', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || !room.game || room.game.phase !== 'reveal') return;
    // Only host can advance
    if (room.hostId !== mySessionId) return;

    room.game.cardIndex++;
    room.game.targetAngle = randomTarget();
    room.game.offenseAngle = 90;
    room.game.defenseAngle = 90;
    room.game.offenseTeamIdx = room.game.offenseTeamIdx === 0 ? 1 : 0;
    room.game.phase = 'master-peek';
    room.game.clue = '';
    room.game.dialController = null;
    room.game.round++;
    room.game.revealResult = null;

    // Rotate masters on both teams
    for (let t = 0; t < 2; t++) {
      const roster = room.game.masterRotation[t];
      if (roster.length > 0) {
        // Unset old master
        const oldMasterSid = roster[room.game.masterIndex[t]];
        const oldMaster = room.players.get(oldMasterSid);
        if (oldMaster) oldMaster.isMaster = false;

        // Advance to next player (wrap around)
        room.game.masterIndex[t] = (room.game.masterIndex[t] + 1) % roster.length;

        // Set new master
        const newMasterSid = roster[room.game.masterIndex[t]];
        const newMaster = room.players.get(newMasterSid);
        if (newMaster) newMaster.isMaster = true;
      }
    }

    io.to(myRoomCode).emit('room-state', getRoomState(room));
    sendTargetToMaster(room);
  });

  socket.on('play-again', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room || room.hostId !== mySessionId) return;

    room.game = null;
    io.to(myRoomCode).emit('room-state', getRoomState(room));
  });

  // Allow clients to request a full state sync
  socket.on('request-sync', () => {
    if (!myRoomCode) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;
    socket.emit('room-state', getRoomState(room));
  });

  socket.on('disconnect', () => {
    if (!myRoomCode || !mySessionId) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;

    const player = room.players.get(mySessionId);
    if (player) {
      player.connected = false;
      io.to(myRoomCode).emit('room-state', getRoomState(room));
    }

    // Clean up empty rooms after 5 minutes
    setTimeout(() => {
      const room = rooms.get(myRoomCode);
      if (!room) return;
      let anyConnected = false;
      for (const [, p] of room.players) {
        if (p.connected) { anyConnected = true; break; }
      }
      if (!anyConnected) {
        rooms.delete(myRoomCode);
        for (const [sid, code] of sessionToRoom) {
          if (code === myRoomCode) sessionToRoom.delete(sid);
        }
      }
    }, 5 * 60 * 1000);
  });

  function sendTargetToMaster(room) {
    // Find offense master socket and send target
    for (const [sid, p] of room.players) {
      if (p.teamIndex === room.game.offenseTeamIdx && p.isMaster && p.connected) {
        const masterSocket = io.sockets.sockets.get(p.socketId);
        if (masterSocket) {
          masterSocket.emit('target-angle', { targetAngle: room.game.targetAngle });
        }
      }
    }
  }
});

// Cleanup stale rooms every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 3 * 60 * 60 * 1000) { // 3 hours
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Wavelength server running on port ${PORT}`);
});
