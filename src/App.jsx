import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { io } from 'socket.io-client';
import defaultCards from './spectrumCards';

const POINTS_TO_WIN = 10;

const DEFAULT_PRESETS_TEXT = defaultCards.map(([l, r]) => `${l} / ${r}`).join('\n');

function parsePresetsText(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('/'))
    .map(line => {
      const [left, ...rest] = line.split('/');
      return [left.trim(), rest.join('/').trim()];
    })
    .filter(([l, r]) => l && r);
}

function loadSavedPresets() {
  try {
    const saved = localStorage.getItem('wavelength-presets');
    if (saved) return saved;
  } catch {}
  return DEFAULT_PRESETS_TEXT;
}

function savePresets(text) {
  try { localStorage.setItem('wavelength-presets', text); } catch {}
}

function getPointsLabel(points) {
  if (points === 4) return "BULLSEYE!";
  if (points === 3) return "So Close!";
  if (points === 2) return "Not Bad!";
  if (points === 1) return "Barely!";
  return "Way Off!";
}

// ==================== SESSION ID ====================
function getSessionId() {
  let id = sessionStorage.getItem('wavelength-session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('wavelength-session', id);
  }
  return id;
}

// ==================== SOCKET HOOK ====================
function useSocket() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [targetAngle, setTargetAngle] = useState(null);
  const [error, setError] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const sessionId = useRef(getSessionId()).current;

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || undefined;
    const s = io(serverUrl, { transports: ['websocket', 'polling'] });
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('room-created', ({ roomCode }) => setRoomCode(roomCode));
    s.on('room-joined', ({ roomCode }) => setRoomCode(roomCode));
    s.on('room-state', (state) => setRoomState(state));
    s.on('target-angle', ({ targetAngle }) => setTargetAngle(targetAngle));
    s.on('error-msg', ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    });
    s.on('kicked', () => {
      setRoomState(null);
      setRoomCode(null);
      setTargetAngle(null);
      setError('You were kicked from the room.');
    });
    s.on('needle-update', ({ team, angle }) => {
      setRoomState(prev => {
        if (!prev || !prev.game) return prev;
        const game = { ...prev.game };
        if (team === 'offense') game.offenseAngle = angle;
        else game.defenseAngle = angle;
        return { ...prev, game };
      });
    });

    // Periodic full-state sync to recover from dropped events
    const syncInterval = setInterval(() => {
      if (s.connected) {
        s.emit('request-sync');
      }
    }, 3000);

    return () => {
      clearInterval(syncInterval);
      s.disconnect();
    };
  }, []);

  const createRoom = useCallback((playerName) => {
    socket?.emit('create-room', { playerName, sessionId });
  }, [socket, sessionId]);

  const joinRoom = useCallback((code, playerName) => {
    socket?.emit('join-room', { roomCode: code, playerName, sessionId });
  }, [socket, sessionId]);

  const joinTeam = useCallback((teamIndex, isMaster) => {
    socket?.emit('join-team', { teamIndex, isMaster });
  }, [socket]);

  const leaveTeam = useCallback(() => {
    socket?.emit('leave-team');
  }, [socket]);

  const kickPlayer = useCallback((targetSessionId) => {
    socket?.emit('kick-player', { targetSessionId });
  }, [socket]);

  const updateTeamName = useCallback((teamIndex, name) => {
    socket?.emit('update-team-name', { teamIndex, name });
  }, [socket]);

  const startGame = useCallback((customCards) => {
    socket?.emit('start-game', { customCards });
  }, [socket]);

  const submitClue = useCallback((clue) => {
    socket?.emit('submit-clue', { clue });
  }, [socket]);

  const updateNeedle = useCallback((angle) => {
    socket?.emit('update-needle', { angle });
  }, [socket]);

  const lockGuess = useCallback((angle) => {
    socket?.emit('lock-guess', { angle });
  }, [socket]);

  const nextRound = useCallback(() => {
    socket?.emit('next-round');
  }, [socket]);

  const playAgain = useCallback(() => {
    socket?.emit('play-again');
    setTargetAngle(null);
  }, [socket]);

  // Determine my role
  const myRole = roomState?.game ? (() => {
    const me = roomState.players.find(p => p.sessionId === sessionId);
    if (!me || me.teamIndex === null) return 'spectator';
    const isOffense = me.teamIndex === roomState.game.offenseTeamIdx;
    if (isOffense && me.isMaster) return 'offense-master';
    if (isOffense) return 'offense-player';
    if (!isOffense && me.isMaster) return 'defense-master';
    return 'defense-player';
  })() : null;

  const isHost = roomState?.hostId === sessionId;

  return {
    connected, roomState, targetAngle, error, roomCode, sessionId, myRole, isHost,
    createRoom, joinRoom, joinTeam, leaveTeam, kickPlayer, updateTeamName,
    startGame, submitClue, updateNeedle, lockGuess, nextRound, playAgain,
  };
}

// ==================== PARTICLES ====================
function Particles({ count = 30 }) {
  const colors = ['#4f7df9', '#8b5cf6', '#ec4899', '#06b6d4', '#fbbf24', '#34d399'];
  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="particle" style={{
          left: `${Math.random() * 100}%`,
          width: `${Math.random() * 8 + 4}px`,
          height: `${Math.random() * 8 + 4}px`,
          backgroundColor: colors[Math.floor(Math.random() * colors.length)],
          borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          animationDelay: `${Math.random() * 1}s`,
          animationDuration: `${Math.random() * 2 + 2}s`,
        }} />
      ))}
    </div>
  );
}

// ==================== TITLE SCREEN ====================
function TitleScreen({ onCreateLobby, onJoinLobby }) {
  return (
    <div className="bg-gradient-game min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] opacity-10">
          <div className="w-full h-full border border-white/10 rounded-full animate-spin-slow" />
          <div className="absolute inset-8 border border-white/10 rounded-full animate-spin-slow" style={{ animationDirection: 'reverse', animationDuration: '25s' }} />
          <div className="absolute inset-16 border border-white/10 rounded-full animate-spin-slow" style={{ animationDuration: '30s' }} />
        </div>
      </div>

      <div className="relative z-10 text-center max-w-2xl animate-fade-in-up">
        <div className="mb-8">
          <svg width="120" height="70" viewBox="0 0 120 70" className="mx-auto">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4f7df9" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="url(#logoGrad)" strokeWidth="4" strokeLinecap="round" />
            <line x1="60" y1="65" x2="60" y2="20" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="60" cy="16" r="5" fill="url(#logoGrad)" />
          </svg>
        </div>

        <h1 className="text-6xl md:text-8xl font-bold glow-text mb-4 tracking-tight">Wavelength</h1>
        <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-md mx-auto leading-relaxed">
          Play online with friends. Offense vs Defense. Read your Master's mind!
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button onClick={onCreateLobby} className="btn-primary px-10 py-4 rounded-2xl text-lg font-semibold text-white relative z-10">
            <span className="relative z-10">Create Lobby</span>
          </button>
          <button onClick={onJoinLobby} className="btn-secondary px-10 py-4 rounded-2xl text-lg font-semibold text-white">
            Join Game
          </button>
        </div>

        <div className="mt-16 flex items-center justify-center gap-8 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            4+ Players
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
            Play Online
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            Offense & Defense
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== NAME ENTRY SCREEN ====================
function NameScreen({ mode, onSubmit, error }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (mode === 'join' && !code.trim()) return;
    onSubmit(name.trim(), code.trim().toUpperCase());
  };

  return (
    <div className="bg-gradient-game min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full animate-fade-in-up">
        <h2 className="text-4xl font-bold text-center mb-2">
          {mode === 'create' ? 'Create Lobby' : 'Join Game'}
        </h2>
        <p className="text-gray-400 text-center mb-8">
          {mode === 'create' ? 'Enter your name to create a room.' : 'Enter the room code and your name.'}
        </p>

        <div className="space-y-4">
          {mode === 'join' && (
            <div className="glass rounded-2xl p-5">
              <label className="block text-sm font-medium text-yellow-400 mb-2">Room Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="ABCD"
                maxLength={4}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-3xl font-bold tracking-[0.3em] placeholder-gray-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all uppercase"
                autoFocus
              />
            </div>
          )}
          <div className="glass rounded-2xl p-5">
            <label className="block text-sm font-medium text-blue-400 mb-2">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Enter your name..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
              autoFocus={mode === 'create'}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!name.trim() || (mode === 'join' && code.length < 4)}
          className="btn-primary w-full mt-6 px-8 py-4 rounded-2xl text-lg font-semibold text-white relative disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="relative z-10">{mode === 'create' ? 'Create Room' : 'Join Room'}</span>
        </button>
      </div>
    </div>
  );
}

// ==================== LOBBY SCREEN ====================
function LobbyScreen({ state, sessionId, isHost, error, onJoinTeam, onLeaveTeam, onKickPlayer, onUpdateTeamName, onStartGame }) {
  const [copied, setCopied] = useState(false);
  const [presetsText, setPresetsText] = useState(loadSavedPresets);
  const [showPresets, setShowPresets] = useState(false);
  const parsedCards = parsePresetsText(presetsText);

  const handlePresetsChange = (text) => {
    setPresetsText(text);
    savePresets(text);
  };

  const handleResetPresets = () => {
    setPresetsText(DEFAULT_PRESETS_TEXT);
    savePresets(DEFAULT_PRESETS_TEXT);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const team1Players = state.players.filter(p => p.teamIndex === 0);
  const team2Players = state.players.filter(p => p.teamIndex === 1);
  const unassigned = state.players.filter(p => p.teamIndex === null);
  const me = state.players.find(p => p.sessionId === sessionId);
  const myTeam = me?.teamIndex;

  const team1HasMaster = team1Players.some(p => p.isMaster);
  const team2HasMaster = team2Players.some(p => p.isMaster);
  const team1HasPlayer = team1Players.some(p => !p.isMaster);
  const team2HasPlayer = team2Players.some(p => !p.isMaster);
  const canStart = team1HasMaster && team2HasMaster && team1HasPlayer && team2HasPlayer;

  const PlayerPill = ({ player }) => (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
      player.connected ? 'bg-white/5' : 'bg-white/5 opacity-40'
    } ${player.sessionId === sessionId ? 'ring-1 ring-white/20' : ''}`}>
      <div className={`w-2 h-2 rounded-full ${player.connected ? 'bg-green-400' : 'bg-gray-600'}`} />
      <span className="text-sm text-white flex-1">{player.name}</span>
      {player.isMaster && (
        <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded-full font-bold uppercase">
          Master
        </span>
      )}
      {player.isHost && (
        <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-full font-bold uppercase">
          Host
        </span>
      )}
      {!player.connected && <span className="text-[10px] text-gray-500">(disconnected)</span>}
      {isHost && player.sessionId !== sessionId && (
        <button
          onClick={() => onKickPlayer(player.sessionId)}
          className="ml-auto text-gray-600 hover:text-red-400 transition-colors p-0.5 rounded hover:bg-red-500/10"
          title={`Kick ${player.name}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );

  const TeamColumn = ({ teamIndex, players, teamName, color, hasMaster }) => {
    const colorClasses = color === 'blue'
      ? { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', btn: 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300', badge: 'bg-blue-500/20 text-blue-300' }
      : { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20', btn: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300', badge: 'bg-purple-500/20 text-purple-300' };

    return (
      <div className="glass rounded-2xl p-5 flex-1">
        <input
          type="text"
          value={teamName}
          onChange={(e) => onUpdateTeamName(teamIndex, e.target.value)}
          placeholder={`Team ${teamIndex + 1}`}
          className={`w-full bg-transparent text-xl font-bold ${colorClasses.text} placeholder-gray-600 focus:outline-none mb-4 text-center`}
        />

        <div className="space-y-2 mb-4">
          {players.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">No players yet</div>
          )}
          {players.map(p => <PlayerPill key={p.sessionId} player={p} />)}
        </div>

        {/* Join buttons */}
        {myTeam === null && (
          <div className="space-y-2">
            {!hasMaster && (
              <button
                onClick={() => onJoinTeam(teamIndex, true)}
                className={`w-full py-2 rounded-lg text-sm font-semibold transition-all ${colorClasses.btn} border ${colorClasses.border}`}
              >
                Join as Master
              </button>
            )}
            <button
              onClick={() => onJoinTeam(teamIndex, false)}
              className={`w-full py-2 rounded-lg text-sm font-semibold transition-all ${colorClasses.btn} border ${colorClasses.border}`}
            >
              Join as Player
            </button>
          </div>
        )}

        {myTeam === teamIndex && (
          <button
            onClick={onLeaveTeam}
            className="w-full py-2 rounded-lg text-sm text-gray-500 hover:text-red-400 transition-colors border border-white/5 hover:border-red-500/20"
          >
            Leave Team
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-gradient-game min-h-screen flex flex-col items-center px-4 py-8">
      <div className="max-w-3xl w-full animate-fade-in-up">
        {/* Room Code */}
        <div className="text-center mb-8">
          <p className="text-sm text-gray-400 mb-2">Share this code with your friends</p>
          <button onClick={copyCode} className="group inline-flex items-center gap-3 glass-strong rounded-2xl px-8 py-4 hover:bg-white/10 transition-all">
            <span className="text-4xl font-bold tracking-[0.3em] text-white">{state.code}</span>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {copied && <p className="text-sm text-green-400 mt-2">Copied!</p>}
        </div>

        {/* Teams */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <TeamColumn teamIndex={0} players={team1Players} teamName={state.teamNames[0]} color="blue" hasMaster={team1HasMaster} />
          <div className="flex items-center justify-center">
            <span className="text-2xl font-bold text-gray-600">VS</span>
          </div>
          <TeamColumn teamIndex={1} players={team2Players} teamName={state.teamNames[1]} color="purple" hasMaster={team2HasMaster} />
        </div>

        {/* Unassigned players */}
        {unassigned.length > 0 && (
          <div className="glass rounded-xl p-4 mb-6">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Waiting to join a team</p>
            <div className="flex flex-wrap gap-2">
              {unassigned.map(p => <PlayerPill key={p.sessionId} player={p} />)}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="glass rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 text-center uppercase tracking-wider">How it Works</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs text-gray-400">
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-yellow-400 text-sm font-bold">1</div>
              <span>Master sees target & gives a clue</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 text-sm font-bold">2</div>
              <span>Offense team guesses on the dial</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 text-sm font-bold">3</div>
              <span>Defense team tries to block</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center text-green-400 text-sm font-bold">4</div>
              <span>Offense scores only if closer!</span>
            </div>
          </div>
        </div>

        {/* Spectrum Presets Editor (host only) */}
        {isHost && (
          <div className="glass rounded-xl mb-6 overflow-hidden">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
            >
              <div>
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Spectrum Cards</h3>
                <p className="text-xs text-gray-500 mt-0.5">{parsedCards.length} cards loaded</p>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform ${showPresets ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showPresets && (
              <div className="px-4 pb-4 border-t border-white/5 pt-3">
                <p className="text-xs text-gray-500 mb-2">One per line, format: <span className="text-gray-400">Left / Right</span>. Saved to your browser automatically.</p>
                <textarea
                  value={presetsText}
                  onChange={(e) => handlePresetsChange(e.target.value)}
                  rows={12}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all resize-y leading-relaxed"
                  placeholder="Hot / Cold&#10;Good / Evil&#10;..."
                />
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs ${parsedCards.length < 3 ? 'text-red-400' : 'text-gray-500'}`}>
                    {parsedCards.length < 3 ? 'Need at least 3 valid cards' : `${parsedCards.length} cards ready`}
                  </span>
                  <button
                    onClick={handleResetPresets}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-white/5"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Start Button (host only) */}
        {isHost && (
          <button
            onClick={() => onStartGame(parsedCards.length >= 3 ? parsedCards : null)}
            disabled={!canStart || parsedCards.length < 3}
            className="btn-primary w-full px-8 py-4 rounded-2xl text-lg font-semibold text-white relative disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="relative z-10">Start Game</span>
          </button>
        )}
        {isHost && !canStart && (
          <p className="text-center text-xs text-gray-500 mt-2">Each team needs a Master and at least 1 player to start</p>
        )}
        {!isHost && (
          <p className="text-center text-sm text-gray-500 mt-2">Waiting for the host to start the game...</p>
        )}
      </div>
    </div>
  );
}

// ==================== DIAL COMPONENT ====================
function Dial({
  offenseAngle, defenseAngle, targetAngle,
  revealed, onNeedleChange, interactive,
  leftLabel, rightLabel, masterView,
  showOffenseNeedle, showDefenseNeedle,
  offenseColor, defenseColor,
}) {
  const svgRef = useRef(null);
  const isDragging = useRef(false);

  const getAngleFromEvent = useCallback((e) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height * 0.85;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - centerX;
    const dy = centerY - clientY;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = Math.max(5, Math.min(175, angle));
    return angle;
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (!interactive) return;
    isDragging.current = true;
    const angle = getAngleFromEvent(e);
    if (angle !== null) onNeedleChange(angle);
  }, [interactive, getAngleFromEvent, onNeedleChange]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current || !interactive) return;
    e.preventDefault();
    const angle = getAngleFromEvent(e);
    if (angle !== null) onNeedleChange(angle);
  }, [interactive, getAngleFromEvent, onNeedleChange]);

  const handlePointerUp = useCallback(() => { isDragging.current = false; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const cx = 250, cy = 230, r = 200;

  const makeArc = (centerAngle, halfSpan, radius) => {
    const startRad = (180 - centerAngle - halfSpan) * Math.PI / 180;
    const endRad = (180 - centerAngle + halfSpan) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy - radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy - radius * Math.sin(endRad);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${halfSpan * 2 > 180 ? 1 : 0} 0 ${x2} ${y2} Z`;
  };

  const makeNeedle = (angle, color, label) => {
    const rad = (180 - angle) * Math.PI / 180;
    const nx = cx + (r - 10) * Math.cos(rad);
    const ny = cy - (r - 10) * Math.sin(rad);
    const labelX = cx + (r + 18) * Math.cos(rad);
    const labelY = cy - (r + 18) * Math.sin(rad);
    return (
      <g>
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="3" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }} />
        <circle cx={nx} cy={ny} r="6" fill={color} stroke="white" strokeWidth="2" />
        {label && <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize="10" fontWeight="600" fontFamily="Space Grotesk">{label}</text>}
      </g>
    );
  };

  const ticks = [];
  for (let a = 0; a <= 180; a += 10) {
    const rad = (180 - a) * Math.PI / 180;
    const inner = a % 30 === 0 ? r - 15 : r - 8;
    ticks.push(<line key={a} x1={cx + inner * Math.cos(rad)} y1={cy - inner * Math.sin(rad)}
      x2={cx + r * Math.cos(rad)} y2={cy - r * Math.sin(rad)}
      stroke="rgba(255,255,255,0.2)" strokeWidth={a % 30 === 0 ? 2 : 1} />);
  }

  const spectrumSegments = [];
  for (let i = 0; i < 36; i++) {
    const sa = (180 - (i / 36) * 180) * Math.PI / 180;
    const ea = (180 - ((i + 1) / 36) * 180) * Math.PI / 180;
    const t = i / 36;
    let color;
    if (t < 0.5) { const lt = t * 2; color = `rgb(${Math.round(79+60*lt)},${Math.round(125-33*lt)},${Math.round(249-3*lt)})`; }
    else { const lt = (t-0.5)*2; color = `rgb(${Math.round(139+97*lt)},${Math.round(92-20*lt)},${Math.round(246-93*lt)})`; }
    spectrumSegments.push(<path key={i}
      d={`M ${cx+r*Math.cos(sa)} ${cy-r*Math.sin(sa)} A ${r} ${r} 0 0 0 ${cx+r*Math.cos(ea)} ${cy-r*Math.sin(ea)} L ${cx+(r-3)*Math.cos(ea)} ${cy-(r-3)*Math.sin(ea)} A ${r-3} ${r-3} 0 0 1 ${cx+(r-3)*Math.cos(sa)} ${cy-(r-3)*Math.sin(sa)} Z`}
      fill={color} opacity={0.6} />);
  }

  return (
    <div className="relative w-full max-w-lg mx-auto">
      <div className="flex justify-between items-end mb-2 px-2">
        <span className="text-sm md:text-base font-semibold text-blue-400 bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">{leftLabel}</span>
        <span className="text-sm md:text-base font-semibold text-pink-400 bg-pink-500/10 px-3 py-1 rounded-lg border border-pink-500/20">{rightLabel}</span>
      </div>
      <svg ref={svgRef} viewBox="0 0 500 260" className={`w-full ${interactive ? 'dial-area' : ''}`}
        onMouseDown={handlePointerDown} onTouchStart={handlePointerDown}>
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        {spectrumSegments}

        {(revealed || masterView) && targetAngle != null && (
          <g opacity={masterView && !revealed ? 0.45 : 1}>
            <path d={makeArc(targetAngle, 23, r-5)} fill="rgba(251,191,36,0.1)" stroke="rgba(251,191,36,0.3)" strokeWidth="1" />
            <path d={makeArc(targetAngle, 14, r-5)} fill="rgba(251,191,36,0.2)" stroke="rgba(251,191,36,0.4)" strokeWidth="1" />
            <path d={makeArc(targetAngle, 5, r-5)} fill="rgba(251,191,36,0.4)" stroke="rgba(251,191,36,0.7)" strokeWidth="1.5" />
          </g>
        )}

        {!revealed && !masterView && (
          <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="url(#coverGrad)" opacity="0.85" />
        )}
        <defs>
          <radialGradient id="coverGrad" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor="#1a1a3a" /><stop offset="100%" stopColor="#0a0a1a" />
          </radialGradient>
        </defs>

        {ticks}
        <line x1={cx-r-10} y1={cy} x2={cx+r+10} y2={cy} stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="8" fill="#1a1a3a" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />

        {showOffenseNeedle && makeNeedle(offenseAngle, offenseColor, revealed ? 'OFF' : null)}
        {showDefenseNeedle && makeNeedle(defenseAngle, defenseColor, revealed ? 'DEF' : null)}

        {revealed && targetAngle != null && (() => {
          const rad = (180-targetAngle)*Math.PI/180;
          return <line x1={cx} y1={cy} x2={cx+(r-5)*Math.cos(rad)} y2={cy-(r-5)*Math.sin(rad)}
            stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 4" opacity="0.6" />;
        })()}
      </svg>
    </div>
  );
}

// ==================== GAME SCREEN ====================
function GameScreen({ state, myRole, targetAngle, isHost, sessionId, onSubmitClue, onUpdateNeedle, onLockGuess, onNextRound }) {
  const game = state.game;
  const [localAngle, setLocalAngle] = useState(90);
  const [clue, setClue] = useState('');
  const [showParticles, setShowParticles] = useState(false);
  const throttle = useRef(null);

  const offenseTeamIdx = game.offenseTeamIdx;
  const defenseTeamIdx = offenseTeamIdx === 0 ? 1 : 0;

  const offenseColor = offenseTeamIdx === 0 ? '#3b82f6' : '#a855f7';
  const defenseColor = defenseTeamIdx === 0 ? '#3b82f6' : '#a855f7';

  // Find master name for offense
  const offenseMaster = state.players.find(p => p.teamIndex === offenseTeamIdx && p.isMaster);
  const defenseMaster = state.players.find(p => p.teamIndex === defenseTeamIdx && p.isMaster);
  const offensePlayerNames = state.players.filter(p => p.teamIndex === offenseTeamIdx && !p.isMaster).map(p => p.name);
  const defensePlayerNames = state.players.filter(p => p.teamIndex === defenseTeamIdx && !p.isMaster).map(p => p.name);
  const team0Master = state.players.find(p => p.teamIndex === 0 && p.isMaster);
  const team0Players = state.players.filter(p => p.teamIndex === 0 && !p.isMaster).map(p => p.name);
  const team1Master = state.players.find(p => p.teamIndex === 1 && p.isMaster);
  const team1Players = state.players.filter(p => p.teamIndex === 1 && !p.isMaster).map(p => p.name);

  // Can I interact with the dial?
  const canDrag = (game.phase === 'offense-guess' && myRole === 'offense-player') ||
                  (game.phase === 'defense-guess' && myRole === 'defense-player');

  // Show master view of target
  const showMasterView = myRole === 'offense-master' && targetAngle != null && game.phase !== 'reveal' && game.phase !== 'game-over';

  // Which needles to show
  const showOffNeedle = ['offense-guess', 'defense-guess', 'reveal', 'game-over'].includes(game.phase);
  const showDefNeedle = ['defense-guess', 'reveal', 'game-over'].includes(game.phase);

  const currentOffAngle = canDrag && game.phase === 'offense-guess' ? localAngle : game.offenseAngle;
  const currentDefAngle = canDrag && game.phase === 'defense-guess' ? localAngle : game.defenseAngle;

  // Reset local angle when phase changes
  useEffect(() => {
    setLocalAngle(90);
  }, [game.phase]);

  // Show particles on reveal
  useEffect(() => {
    if (game.phase === 'reveal' && game.revealResult?.offenseCloser && game.revealResult?.points >= 3) {
      setShowParticles(true);
      const t = setTimeout(() => setShowParticles(false), 3000);
      return () => clearTimeout(t);
    }
  }, [game.phase, game.revealResult]);

  const latestAngle = useRef(90);
  const handleNeedleChange = (angle) => {
    setLocalAngle(angle);
    latestAngle.current = angle;
    // Throttle network updates — always send latest angle when throttle fires
    if (!throttle.current) {
      throttle.current = setTimeout(() => {
        onUpdateNeedle(latestAngle.current);
        throttle.current = null;
      }, 50);
    }
  };

  const handleLock = () => {
    onLockGuess(localAngle);
  };

  const handleSubmitClue = () => {
    if (clue.trim()) {
      onSubmitClue(clue.trim());
      setClue('');
    }
  };

  const revealTargetAngle = game.revealResult?.targetAngle ?? null;

  return (
    <div className="bg-gradient-game min-h-screen flex flex-col">
      {showParticles && <Particles />}

      {/* Header */}
      <header className="glass-strong border-b border-white/10 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-3 h-3 rounded-full ${offenseTeamIdx === 0 ? 'bg-blue-400 animate-pulse' : 'bg-blue-400/30'}`} />
            <div>
              <div className="text-sm font-semibold text-blue-400 flex items-center gap-2">
                {state.teamNames[0]}
                {offenseTeamIdx === 0 && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">OFF</span>}
                {defenseTeamIdx === 0 && <span className="text-[10px] bg-gray-500/20 text-gray-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">DEF</span>}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="h-1.5 bg-gray-700 rounded-full w-24 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (game.scores[0]/POINTS_TO_WIN)*100)}%` }} />
                </div>
                <span className="text-xs text-gray-400 ml-1">{game.scores[0]}/{POINTS_TO_WIN}</span>
              </div>
            </div>
          </div>
          <div className="text-center px-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Round {game.round}</div>
            <div className="text-sm font-bold text-white mt-0.5">vs</div>
          </div>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <div className="text-right">
              <div className="text-sm font-semibold text-purple-400 flex items-center justify-end gap-2">
                {offenseTeamIdx === 1 && <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">OFF</span>}
                {defenseTeamIdx === 1 && <span className="text-[10px] bg-gray-500/20 text-gray-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">DEF</span>}
                {state.teamNames[1]}
              </div>
              <div className="flex items-center gap-1 mt-0.5 justify-end">
                <span className="text-xs text-gray-400 mr-1">{game.scores[1]}/{POINTS_TO_WIN}</span>
                <div className="h-1.5 bg-gray-700 rounded-full w-24 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (game.scores[1]/POINTS_TO_WIN)*100)}%` }} />
                </div>
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${offenseTeamIdx === 1 ? 'bg-purple-400 animate-pulse' : 'bg-purple-400/30'}`} />
          </div>
        </div>
      </header>

      {/* Team rosters */}
      <div className="max-w-4xl mx-auto w-full px-4 pt-2 flex justify-between">
        <div className="flex flex-col gap-0.5 max-w-[40%]">
          {team0Master && (
            <div className="text-xs text-blue-300 font-semibold flex items-center gap-1">
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded">M</span>
              {team0Master.name}
            </div>
          )}
          {team0Players.map(name => (
            <div key={name} className="text-xs text-blue-400/70 pl-4 truncate">{name}</div>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 items-end max-w-[40%]">
          {team1Master && (
            <div className="text-xs text-purple-300 font-semibold flex items-center gap-1">
              {team1Master.name}
              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1 py-0.5 rounded">M</span>
            </div>
          )}
          {team1Players.map(name => (
            <div key={name} className="text-xs text-purple-400/70 pr-4 truncate">{name}</div>
          ))}
        </div>
      </div>

      {/* Your role badge */}
      <div className="flex justify-center pt-3 gap-2">
        <span className={`text-xs uppercase tracking-widest font-semibold px-3 py-1 rounded-full ${
          offenseTeamIdx === 0 ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' : 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
        }`}>
          {state.teamNames[offenseTeamIdx]} on Offense
        </span>
        <span className="text-xs uppercase tracking-widest font-medium px-3 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10">
          You: {myRole?.replace('-', ' ') || 'spectator'}
        </span>
      </div>

      <main className="flex-1 flex flex-col items-center px-4 py-4 max-w-2xl mx-auto w-full">
        {/* Dial */}
        <Dial
          offenseAngle={game.phase === 'offense-guess' && canDrag ? localAngle : game.offenseAngle}
          defenseAngle={game.phase === 'defense-guess' && canDrag ? localAngle : game.defenseAngle}
          targetAngle={game.phase === 'reveal' || game.phase === 'game-over' ? revealTargetAngle : targetAngle}
          revealed={game.phase === 'reveal' || game.phase === 'game-over'}
          masterView={showMasterView}
          onNeedleChange={handleNeedleChange}
          interactive={canDrag}
          leftLabel={game.card[0]}
          rightLabel={game.card[1]}
          showOffenseNeedle={showOffNeedle}
          showDefenseNeedle={showDefNeedle}
          offenseColor={offenseColor}
          defenseColor={defenseColor}
        />

        {/* Phase UI */}
        <div className="w-full mt-4">
          {/* MASTER PEEK */}
          {game.phase === 'master-peek' && (
            <div className="text-center animate-fade-in-up">
              <div className="glass rounded-2xl p-6 max-w-md mx-auto">
                {myRole === 'offense-master' ? (
                  <>
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                        You're the Master
                      </span>
                    </div>
                    {targetAngle ? (
                      <>
                        <p className="text-sm text-green-400 mb-3">You can see the target on the dial! Give your team a clue.</p>
                        <div className="flex gap-2">
                          <input type="text" value={clue} onChange={(e) => setClue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmitClue()}
                            placeholder="Type your clue..."
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all"
                            autoFocus />
                          <button onClick={handleSubmitClue} disabled={!clue.trim()}
                            className="btn-primary px-5 py-3 rounded-xl font-semibold text-white relative disabled:opacity-50 disabled:cursor-not-allowed">
                            <span className="relative z-10">Go</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-white">Loading target...</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-sm text-gray-400 mb-2">Waiting for the Master...</div>
                    <p className="text-white">
                      <span className="font-bold text-yellow-400">{offenseMaster?.name || 'Master'}</span> is crafting a clue
                    </p>
                    <div className="mt-4 flex justify-center">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-yellow-400/60 animate-bounce" style={{ animationDelay: '0s' }} />
                        <div className="w-2 h-2 rounded-full bg-yellow-400/60 animate-bounce" style={{ animationDelay: '0.15s' }} />
                        <div className="w-2 h-2 rounded-full bg-yellow-400/60 animate-bounce" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* OFFENSE GUESS */}
          {game.phase === 'offense-guess' && (
            <div className="text-center animate-fade-in-up">
              <div className="glass rounded-2xl p-5 max-w-md mx-auto">
                <p className="text-sm text-gray-400 mb-1">The Master's clue is:</p>
                <div className="text-2xl font-bold text-white mb-3">"{game.clue}"</div>
                {myRole === 'offense-player' ? (
                  <>
                    <p className="text-sm text-gray-400 mb-4">Drag the needle to your guess!</p>
                    <button onClick={handleLock}
                      className="btn-primary px-8 py-3 rounded-xl font-semibold text-white relative">
                      <span className="relative z-10 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        Lock In Guess
                      </span>
                    </button>
                  </>
                ) : myRole === 'offense-master' ? (
                  <div className="text-sm text-gray-400">
                    <p>Your team is guessing — watch and hope!</p>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">
                    <p>{state.teamNames[offenseTeamIdx]} is guessing...</p>
                    <div className="mt-3 flex justify-center">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '0s' }} />
                        <div className="w-2 h-2 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '0.15s' }} />
                        <div className="w-2 h-2 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DEFENSE GUESS */}
          {game.phase === 'defense-guess' && (
            <div className="text-center animate-fade-in-up">
              <div className="glass rounded-2xl p-5 max-w-md mx-auto">
                <p className="text-sm text-gray-400 mb-1">The clue was:</p>
                <div className="text-2xl font-bold text-white mb-3">"{game.clue}"</div>
                {myRole === 'defense-player' ? (
                  <>
                    <p className="text-sm text-gray-400 mb-4">Try to get closer to the target than offense!</p>
                    <button onClick={handleLock}
                      className="btn-primary px-8 py-3 rounded-xl font-semibold text-white relative">
                      <span className="relative z-10 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                        Lock In Defense
                      </span>
                    </button>
                  </>
                ) : myRole === 'defense-master' ? (
                  <div className="text-sm text-gray-400">
                    <p>Your team is defending — watch them block!</p>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">
                    <p>{state.teamNames[defenseTeamIdx]} is defending...</p>
                    <div className="mt-3 flex justify-center">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '0s' }} />
                        <div className="w-2 h-2 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '0.15s' }} />
                        <div className="w-2 h-2 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* REVEAL */}
          {(game.phase === 'reveal' || game.phase === 'game-over') && game.revealResult && (
            <div className="text-center animate-fade-in-up">
              <div className="glass rounded-2xl p-6 max-w-md mx-auto">
                {game.revealResult.offenseCloser ? (
                  <>
                    <div className="text-4xl font-bold text-green-400 mb-1">{getPointsLabel(game.revealResult.points)}</div>
                    <div className="text-sm text-gray-400 mb-2">{state.teamNames[offenseTeamIdx]} was closer!</div>
                    <div className="text-6xl font-bold text-white mb-1">+{game.revealResult.points}</div>
                    <p className="text-sm text-gray-400">points for {state.teamNames[offenseTeamIdx]}</p>
                  </>
                ) : game.revealResult.tied ? (
                  <>
                    <div className="text-4xl font-bold text-yellow-400 mb-1">Tied!</div>
                    <div className="text-sm text-gray-400 mb-2">Both teams equally close</div>
                    <div className="text-6xl font-bold text-white mb-1">+0</div>
                  </>
                ) : (
                  <>
                    <div className="text-4xl font-bold text-red-400 mb-1">Blocked!</div>
                    <div className="text-sm text-gray-400 mb-2">{state.teamNames[defenseTeamIdx]} was closer!</div>
                    <div className="text-6xl font-bold text-white mb-1">+0</div>
                    <p className="text-sm text-gray-400">{state.teamNames[offenseTeamIdx]} scores nothing</p>
                  </>
                )}

                <div className="mt-4 flex justify-center gap-4">
                  <div className={`rounded-xl px-4 py-2 ${offenseTeamIdx === 0 ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-purple-500/10 border border-purple-500/20'}`}>
                    <div className="text-xs text-gray-400">Offense</div>
                    <div className={`text-lg font-bold ${offenseTeamIdx === 0 ? 'text-blue-400' : 'text-purple-400'}`}>{game.revealResult.offDiff.toFixed(1)}° off</div>
                  </div>
                  <div className={`rounded-xl px-4 py-2 ${defenseTeamIdx === 0 ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-purple-500/10 border border-purple-500/20'}`}>
                    <div className="text-xs text-gray-400">Defense</div>
                    <div className={`text-lg font-bold ${defenseTeamIdx === 0 ? 'text-blue-400' : 'text-purple-400'}`}>{game.revealResult.defDiff.toFixed(1)}° off</div>
                  </div>
                </div>

                {game.phase === 'game-over' ? (
                  <div className="mt-4 text-xl font-bold text-yellow-400">Game Over!</div>
                ) : isHost ? (
                  <button onClick={onNextRound} className="btn-primary mt-5 px-8 py-3 rounded-xl font-semibold text-white relative">
                    <span className="relative z-10">Next Round</span>
                  </button>
                ) : (
                  <p className="text-sm text-gray-500 mt-4">Waiting for host to continue...</p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ==================== GAME OVER SCREEN ====================
function GameOverScreen({ state, isHost, onPlayAgain }) {
  const winner = state.game.scores[0] >= POINTS_TO_WIN ? 0 : 1;
  return (
    <div className="bg-gradient-game min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <Particles count={50} />
      <div className="relative z-10 text-center animate-fade-in-up">
        <div className="text-7xl mb-6">👑</div>
        <h1 className="text-5xl md:text-7xl font-bold glow-text mb-4">{state.teamNames[winner]} Wins!</h1>
        <p className="text-gray-400 text-lg mb-8">What a game!</p>
        <div className="flex items-center justify-center gap-8 mb-10">
          <div className={`glass rounded-2xl p-6 text-center min-w-[140px] ${winner === 0 ? 'ring-2 ring-yellow-400/50' : ''}`}>
            <div className="text-sm text-blue-400 font-medium mb-1">{state.teamNames[0]}</div>
            <div className="text-4xl font-bold text-white">{state.game.scores[0]}</div>
          </div>
          <div className="text-2xl text-gray-500 font-bold">vs</div>
          <div className={`glass rounded-2xl p-6 text-center min-w-[140px] ${winner === 1 ? 'ring-2 ring-yellow-400/50' : ''}`}>
            <div className="text-sm text-purple-400 font-medium mb-1">{state.teamNames[1]}</div>
            <div className="text-4xl font-bold text-white">{state.game.scores[1]}</div>
          </div>
        </div>
        {isHost ? (
          <button onClick={onPlayAgain} className="btn-primary px-10 py-4 rounded-2xl text-lg font-semibold text-white relative">
            <span className="relative z-10">Play Again</span>
          </button>
        ) : (
          <p className="text-sm text-gray-500">Waiting for host...</p>
        )}
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================
function App() {
  const {
    connected, roomState, targetAngle, error, roomCode, sessionId, myRole, isHost,
    createRoom, joinRoom, joinTeam, leaveTeam, kickPlayer, updateTeamName,
    startGame, submitClue, updateNeedle, lockGuess, nextRound, playAgain,
  } = useSocket();

  const [screen, setScreen] = useState('title'); // title, name-create, name-join

  // Once we have a roomState, we're in lobby or game
  const inRoom = roomState != null;
  const inGame = roomState?.game != null;
  const isGameOver = roomState?.game?.phase === 'game-over';

  // Auto-navigate when room state changes
  if (inRoom && (screen === 'name-create' || screen === 'name-join')) {
    // We've joined, will render lobby/game below
  }

  // Connection indicator
  const ConnectionDot = () => (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2 glass rounded-full px-3 py-1.5">
      <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
      <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Reconnecting...'}</span>
    </div>
  );

  // Error toast
  const ErrorToast = () => error ? (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm animate-fade-in-up">
      {error}
    </div>
  ) : null;

  // Not in a room yet - show title or name entry
  if (!inRoom) {
    return (
      <>
        <ConnectionDot />
        <ErrorToast />
        {screen === 'title' && (
          <TitleScreen
            onCreateLobby={() => setScreen('name-create')}
            onJoinLobby={() => setScreen('name-join')}
          />
        )}
        {screen === 'name-create' && (
          <NameScreen
            mode="create"
            error={error}
            onSubmit={(name) => createRoom(name)}
          />
        )}
        {screen === 'name-join' && (
          <NameScreen
            mode="join"
            error={error}
            onSubmit={(name, code) => joinRoom(code, name)}
          />
        )}
      </>
    );
  }

  // Game over
  if (isGameOver) {
    return (
      <>
        <ConnectionDot />
        <GameOverScreen state={roomState} isHost={isHost} onPlayAgain={playAgain} />
      </>
    );
  }

  // In game
  if (inGame) {
    return (
      <>
        <ConnectionDot />
        <ErrorToast />
        <GameScreen
          state={roomState}
          myRole={myRole}
          targetAngle={targetAngle}
          isHost={isHost}
          sessionId={sessionId}
          onSubmitClue={submitClue}
          onUpdateNeedle={updateNeedle}
          onLockGuess={lockGuess}
          onNextRound={nextRound}
        />
      </>
    );
  }

  // In lobby
  return (
    <>
      <ConnectionDot />
      <ErrorToast />
      <LobbyScreen
        state={roomState}
        sessionId={sessionId}
        isHost={isHost}
        error={error}
        onJoinTeam={joinTeam}
        onLeaveTeam={leaveTeam}
        onKickPlayer={kickPlayer}
        onUpdateTeamName={updateTeamName}
        onStartGame={startGame}
      />
    </>
  );
}

export default App;
