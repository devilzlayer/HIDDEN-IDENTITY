const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;
const PLAYER_SPEED = 4.5;
const KILL_DISTANCE = 60;
const KILL_COOLDOWN_MS = 20000;
const MEETING_DURATION_MS = 30000; // 30-second structural discussion/voting limit

const AVAILABLE_COLORS = ['#FF3B30', '#007AFF', '#34C759', '#FFCC00', '#AF52DE', '#FF9500', '#5AC8FA', '#E5E5EA'];

const MAP_VENTS = [
    { id: 'vent_cafeteria', x: 650, y: 150, cluster: 'system_alpha', targetId: 'vent_admin' },
    { id: 'vent_admin',     x: 850, y: 420, cluster: 'system_alpha', targetId: 'vent_cafeteria' },
    { id: 'vent_medbay',    x: 150, y: 380, cluster: 'system_beta',  targetId: 'vent_electrical' },
    { id: 'vent_electrical',x: 150, y: 600, cluster: 'system_beta',  targetId: 'vent_medbay' },
    { id: 'vent_weapons',   x: 120, y: 120, cluster: 'system_gamma', targetId: 'vent_storage' },
    { id: 'vent_storage',   x: 500, y: 620, cluster: 'system_gamma', targetId: 'vent_weapons' }
];

const TASK_TEMPLATES = [
    { id: 'task_wires', name: 'Fix Wiring', room: 'Electrical', x: 200, y: 610 },
    { id: 'task_download', name: 'Download Data', room: 'Cafeteria', x: 600, y: 150 },
    { id: 'task_divert', name: 'Divert Power', room: 'Admin', x: 850, y: 380 },
    { id: 'task_scan', name: 'ID Scan', room: 'MedBay', x: 140, y: 340 },
    { id: 'task_swipe', name: 'Swipe Card', room: 'Admin', x: 880, y: 360 }
];

// Wall collision data (must match client.js)
const WALL_RECTS = [
    { x: 18, y: 16, w: 964, h: 8 },  { x: 18, y: 676, w: 964, h: 8 },
    { x: 16, y: 16, w: 8, h: 660 },   { x: 976, y: 16, w: 8, h: 660 },
    { x: 256, y: 20, w: 8, h: 95 },   { x: 256, y: 155, w: 8, h: 95 },
    { x: 736, y: 20, w: 8, h: 95 },   { x: 736, y: 155, w: 8, h: 95 },
    { x: 256, y: 280, w: 8, h: 210 },
    { x: 736, y: 280, w: 8, h: 210 },
    { x: 256, y: 520, w: 8, h: 95 },  { x: 256, y: 655, w: 8, h: 25 },
    { x: 736, y: 520, w: 8, h: 95 },  { x: 736, y: 655, w: 8, h: 25 },
    { x: 30, y: 256, w: 95, h: 8 },   { x: 165, y: 256, w: 85, h: 8 },
    { x: 270, y: 256, w: 85, h: 8 },  { x: 395, y: 256, w: 210, h: 8 },
    { x: 645, y: 256, w: 85, h: 8 },  { x: 750, y: 256, w: 95, h: 8 },
    { x: 885, y: 256, w: 85, h: 8 },  { x: 30, y: 496, w: 95, h: 8 },
    { x: 165, y: 496, w: 85, h: 8 },  { x: 270, y: 496, w: 85, h: 8 },
    { x: 395, y: 496, w: 210, h: 8 }, { x: 645, y: 496, w: 85, h: 8 },
    { x: 750, y: 496, w: 95, h: 8 },  { x: 885, y: 496, w: 85, h: 8 },
];

function checkWallCollision(px, py, radius) {
    for (const w of WALL_RECTS) {
        const closestX = Math.max(w.x, Math.min(px, w.x + w.w));
        const closestY = Math.max(w.y, Math.min(py, w.y + w.h));
        const dx = px - closestX;
        const dy = py - closestY;
        if (dx * dx + dy * dy < radius * radius) return true;
    }
    return false;
}

const rooms = {};

io.on('connection', (socket) => {
    socket.on('host_room', (username) => {
        const cleanedUsername = username?.trim().substring(0, 12) || "Crewmate";
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        rooms[code] = {
            code,
            gameState: 'LOBBY', // LOBBY, INGAME, MEETING
            players: {},
            deadBodies: [],
            sabotageActive: false,
            sabotageType: null,
            totalTasksRequired: 0,
            totalTasksCompleted: 0,
            meetingTimerId: null,
            votes: {}, // Key: voterId, Value: votedTargetId ('skip' or playerId)
            intervalId: setInterval(() => { if (rooms[code]) processLobbyTicks(code); }, TICK_INTERVAL)
        };
        registerPlayer(socket, code, cleanedUsername);
    });

    socket.on('join_room', ({ username, roomCode }) => {
        const cleanedUsername = username?.trim().substring(0, 12) || "Crewmate";
        const code = roomCode?.toUpperCase().trim();
        if (!rooms[code] || rooms[code].gameState !== 'LOBBY') return socket.emit('network_error', 'Lobby unavailable.');
        registerPlayer(socket, code, cleanedUsername);
    });

    socket.on('start_match', () => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'LOBBY') return;

        const playerIds = Object.keys(room.players);
        if (playerIds[0] !== socket.id) return socket.emit('network_error', 'Denied.');

        room.gameState = 'INGAME';
        room.totalTasksCompleted = 0;
        room.deadBodies = [];
        
        const impostorIndex = Math.floor(Math.random() * playerIds.length);
        let crewmateCount = 0;

        playerIds.forEach((id, index) => {
            const p = room.players[id];
            p.role = (index === impostorIndex) ? 'IMPOSTOR' : 'CREWMATE';
            p.isAlive = true;
            p.inVent = null;
            p.lastKillTime = 0;
            p.x = 450 + (index * 20);
            p.y = 370;
            
            if (p.role === 'CREWMATE') {
                crewmateCount++;
                p.tasks = TASK_TEMPLATES.map(t => ({ ...t, completed: false }));
            } else {
                p.tasks = [];
            }
            io.to(id).emit('identity_assignment', { role: p.role, tasks: p.tasks });
        });

        room.totalTasksRequired = crewmateCount * TASK_TEMPLATES.length;
        io.to(roomCode).emit('match_begun');
    });

    socket.on('player_input', (inputVector) => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME') return;

        const player = room.players[socket.id];
        if (!player || !player.isAlive || player.inVent) return;

        // Store input for continuous processing in the tick loop
        player.lastInput = {
            up: !!inputVector.up,
            down: !!inputVector.down,
            left: !!inputVector.left,
            right: !!inputVector.right
        };
    });

    // --- Action: Initiate Emergency Cycle ---
    socket.on('trigger_meeting', () => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME') return;

        const player = room.players[socket.id];
        if (!player || !player.isAlive) return;

        // Verify context proximity to the Cafeteria emergency button table (500, 130)
        const distanceToButton = Math.hypot(500 - player.x, 130 - player.y);
        let nearABody = false;

        room.deadBodies.forEach(body => {
            if (Math.hypot(body.x - player.x, body.y - player.y) <= 80) nearABody = true;
        });

        if (distanceToButton <= 55 || nearABody) {
            executeMeetingCall(room, `${player.username} called an Emergency Meeting!`);
        }
    });

    // --- Action: Broadcast Meeting Room Chat ---
    socket.on('send_meeting_msg', (msgText) => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'MEETING') return;

        const player = room.players[socket.id];
        if (!player) return;

        const logPayload = {
            sender: player.username,
            color: player.color,
            text: msgText.substring(0, 60),
            isAlive: player.isAlive
        };
        io.to(roomCode).emit('receive_meeting_msg', logPayload);
    });

    // --- Action: Cast Ballot Registration ---
    socket.on('cast_vote', (targetId) => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'MEETING') return;

        const voter = room.players[socket.id];
        if (!voter || !voter.isAlive || room.votes[socket.id]) return; // Only living entities can vote once

        // Verify target is valid player or skip token
        if (targetId === 'skip' || (room.players[targetId] && room.players[targetId].isAlive)) {
            room.votes[socket.id] = targetId;
            io.to(roomCode).emit('player_voted', { voterId: socket.id });

            // Check if everyone alive has registered their ballot early
            const livingCount = Object.values(room.players).filter(p => p.isAlive).length;
            if (Object.keys(room.votes).length === livingCount) {
                clearTimeout(room.meetingTimerId);
                evaluateVotes(room);
            }
        }
    });

    socket.on('complete_task', (taskId) => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME') return;

        const player = room.players[socket.id];
        if (!player || player.role !== 'CREWMATE' || !player.isAlive) return;

        const task = player.tasks.find(t => t.id === taskId);
        if (task && !task.completed) {
            if (Math.hypot(task.x - player.x, task.y - player.y) <= 75) {
                task.completed = true;
                room.totalTasksCompleted++;
                io.to(socket.id).emit('task_updated', player.tasks);
                io.to(roomCode).emit('global_progress_updated', {
                    completed: room.totalTasksCompleted,
                    required: room.totalTasksRequired
                });
                evaluateWinConditions(room);
            }
        }
    });

    socket.on('trigger_sabotage', (type) => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME' || room.sabotageActive) return;

        const player = room.players[socket.id];
        if (!player || player.role !== 'IMPOSTOR' || !player.isAlive) return;

        if (type === 'LIGHTS') {
            room.sabotageActive = true;
            room.sabotageType = 'LIGHTS';
            io.to(roomCode).emit('sabotage_triggered', { type: 'LIGHTS' });
        }
    });

    socket.on('repair_sabotage', () => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME' || !room.sabotageActive) return;

        const player = room.players[socket.id];
        if (!player || !player.isAlive || player.inVent) return;

        if (Math.hypot(180 - player.x, 620 - player.y) <= 55) {
            room.sabotageActive = false;
            room.sabotageType = null;
            io.to(roomCode).emit('sabotage_resolved');
        }
    });

    socket.on('execute_kill', () => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME') return;

        const attacker = room.players[socket.id];
        if (!attacker || attacker.role !== 'IMPOSTOR' || !attacker.isAlive || attacker.inVent) return;

        const now = Date.now();
        if (now - attacker.lastKillTime < KILL_COOLDOWN_MS) return;

        let target = null;
        let closestDist = KILL_DISTANCE;

        Object.values(room.players).forEach(p => {
            if (p.id === attacker.id || p.role === 'IMPOSTOR' || !p.isAlive || p.inVent) return;
            const dist = Math.hypot(p.x - attacker.x, p.y - attacker.y);
            if (dist < closestDist) { closestDist = dist; target = p; }
        });

        if (target) {
            target.isAlive = false;
            attacker.lastKillTime = now;
            room.deadBodies.push({
                id: `body_${target.id}_${now}`, x: target.x, y: target.y, color: target.color, username: target.username
            });
            io.to(roomCode).emit('kill_confirmed', { victimId: target.id });
            evaluateWinConditions(room);
        }
    });

    socket.on('disconnect', () => {
        const { roomCode } = socket;
        if (roomCode && rooms[roomCode]) {
            delete rooms[roomCode].players[socket.id];
            if (Object.keys(rooms[roomCode].players).length === 0) {
                clearInterval(rooms[roomCode].intervalId);
                clearTimeout(rooms[roomCode].meetingTimerId);
                delete rooms[roomCode];
            } else {
                evaluateWinConditions(rooms[roomCode]);
            }
        }
    });

    // Clear lastInput on vent enter/exit so player doesn't keep moving
    socket.on('interact_vent', () => {
        const { roomCode } = socket;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'INGAME') return;

        const player = room.players[socket.id];
        if (!player || player.role !== 'IMPOSTOR' || !player.isAlive) return;

        if (player.inVent) {
            const currentVent = MAP_VENTS.find(v => v.id === player.inVent);
            if (!currentVent) return;
            const targetVent = MAP_VENTS.find(v => v.id === currentVent.targetId);
            if (targetVent) { player.x = targetVent.x; player.y = targetVent.y; player.inVent = null; player.lastInput = null; }
            socket.emit('vent_status', { inVent: false });
        } else {
            const nearbyVent = MAP_VENTS.find(v => Math.hypot(v.x - player.x, v.y - player.y) < 45);
            if (nearbyVent) { player.inVent = nearbyVent.id; player.lastInput = null; }
            socket.emit('vent_status', { inVent: true });
        }
    });
});

function registerPlayer(socket, roomCode, username) {
    const activeRoom = rooms[roomCode];
    const assignedIndex = Object.keys(activeRoom.players).length;
    activeRoom.players[socket.id] = {
        id: socket.id, username,
        color: AVAILABLE_COLORS[assignedIndex % AVAILABLE_COLORS.length],
        x: 500, y: 370,
        role: 'CREWMATE', isAlive: true, inVent: null, tasks: [],
        lastInput: null
    };
    socket.roomCode = roomCode;
    socket.join(roomCode);
    socket.emit('connection_acknowledged', { myId: socket.id, roomCode, mapVents: MAP_VENTS, taskTemplates: TASK_TEMPLATES });
}

function executeMeetingCall(room, reasonText) {
    room.gameState = 'MEETING';
    room.votes = {};
    room.deadBodies = []; // Clear away old physical body nodes upon transition
    room.sabotageActive = false; // System baseline reset
    room.sabotageType = null;

    // Reset positions to the central alignment matrix
    Object.values(room.players).forEach((p, idx) => {
        p.inVent = null;
        p.x = 500;
        p.y = 300 + (idx * 25);
    });

    io.to(room.code).emit('meeting_started', { reason: reasonText, players: room.players });

    // Enforce definitive timer execution limits
    room.meetingTimerId = setTimeout(() => {
        evaluateVotes(room);
    }, MEETING_DURATION_MS);
}

function evaluateVotes(room) {
    const tally = {};
    let skipCount = 0;

    Object.values(room.votes).forEach(targetId => {
        if (targetId === 'skip') skipCount++;
        else tally[targetId] = (tally[targetId] || 0) + 1;
    });

    let ejectedId = null;
    let maxVotes = skipCount;
    let tie = false;

    Object.keys(tally).forEach(id => {
        if (tally[id] > maxVotes) {
            maxVotes = tally[id];
            ejectedId = id;
            tie = false;
        } else if (tally[id] === maxVotes) {
            tie = true;
        }
    });

    let details = "Tie or Skip won. Nobody was ejected.";
    if (ejectedId && !tie) {
        const victim = room.players[ejectedId];
        victim.isAlive = false;
        details = `${victim.username} was ejected. They were an ${victim.role}.`;
    }

    io.to(room.code).emit('meeting_concluded', { log: details, players: room.players });

    // Structural grace period break before kicking dynamic play cycle back alive
    setTimeout(() => {
        if (!rooms[room.code]) return;
        if (evaluateWinConditions(room)) return;
        room.gameState = 'INGAME';
        io.to(room.code).emit('resume_game');
    }, 4000);
}

function evaluateWinConditions(room) {
    if (room.gameState === 'LOBBY') return false;

    const roster = Object.values(room.players);
    const impostorsAlive = roster.filter(p => p.role === 'IMPOSTOR' && p.isAlive).length;
    const crewmatesAlive = roster.filter(p => p.role === 'CREWMATE' && p.isAlive).length;

    let crewWin = false;
    let impWin = false;

    // Condition 1: All tasks hit 100% completion metrics
    if (room.totalTasksRequired > 0 && room.totalTasksCompleted >= room.totalTasksRequired) {
        crewWin = true;
    }
    // Condition 2: All Impostors eliminated
    if (impostorsAlive === 0) {
        crewWin = true;
    }
    // Condition 3: Impostors outnumber or match living Crewmates
    if (impostorsAlive >= crewmatesAlive && crewmatesAlive > 0) {
        impWin = true;
    }

    if (crewWin || impWin) {
        const victoryMsg = crewWin ? "CREWMATES WIN!" : "IMPOSTORS WIN!";
        io.to(room.code).emit('match_ended', { message: victoryMsg });
        
        // Reset room state machine layer back to lobby definitions
        room.gameState = 'LOBBY';
        room.deadBodies = [];
        room.sabotageActive = false;
        clearTimeout(room.meetingTimerId);
        return true;
    }
    return false;
}

function processLobbyTicks(code) {
    const room = rooms[code];

    // Server-authoritative continuous movement: apply stored input every tick at 60Hz
    if (room.gameState === 'INGAME') {
        Object.values(room.players).forEach(player => {
            if (!player.isAlive || player.inVent || !player.lastInput) return;
            let dx = 0, dy = 0;
            if (player.lastInput.up) dy -= 1;
            if (player.lastInput.down) dy += 1;
            if (player.lastInput.left) dx -= 1;
            if (player.lastInput.right) dx += 1;
            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
            
            // Apply wall collision with axis-separate sliding
            const pr = 14;
            const newX = player.x + dx * PLAYER_SPEED;
            const newY = player.y + dy * PLAYER_SPEED;
            
            if (!checkWallCollision(newX, player.y, pr)) {
                player.x = newX;
            }
            if (!checkWallCollision(player.x, newY, pr)) {
                player.y = newY;
            }
        });
    }

    const clientSnapshot = {
        gameState: room.gameState,
        deadBodies: room.deadBodies,
        sabotageActive: room.sabotageActive,
        players: {}
    };

    Object.keys(room.players).forEach(id => {
        const p = room.players[id];
        if (p.inVent) return; 
        clientSnapshot.players[id] = {
            id: p.id, username: p.username, color: p.color, x: p.x, y: p.y, isAlive: p.isAlive
        };
    });
    io.to(code).emit('state_snapshot', clientSnapshot);
}

const PORT = 3000;
server.listen(PORT, () => console.log(`Stage 5 Matrix Engine online on port ${PORT}`));