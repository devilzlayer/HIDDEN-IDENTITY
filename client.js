const socket = io();

// DOM refs - top panel
const setupPanel = document.getElementById('setup-panel');
const canvasWrapper = document.getElementById('canvas-wrapper');
const usernameIn = document.getElementById('username-in');
const codeIn = document.getElementById('code-in');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('start-btn');
const roleBadge = document.getElementById('role-badge');
const roomCodeDisplay = document.getElementById('room-code-display');
const taskListElement = document.getElementById('task-list');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const sabotageAlert = document.getElementById('sabotage-alert');

// DOM refs - kill cooldown
const killCooldownWrap = document.getElementById('kill-cooldown-wrap');
const killCooldownRing = document.getElementById('kill-cooldown-ring');
const killCooldownText = document.getElementById('kill-cooldown-text');
const killCooldownCircle = killCooldownRing?.querySelector('circle');

// DOM refs - player status
const playerStatusList = document.getElementById('player-status-list');

// DOM refs - meeting
const meetingOverlay = document.getElementById('meeting-overlay');
const meetingBanner = document.getElementById('meeting-banner');
const meetingStatusLog = document.getElementById('meeting-status-log');
const meetingTimer = document.getElementById('meeting-timer');
const votingGrid = document.getElementById('voting-grid');
const skipVoteBtn = document.getElementById('skip-vote-btn');
const chatWindow = document.getElementById('chat-window');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

// DOM refs - task modal
const taskModal = document.getElementById('task-modal');
const modalTaskTitle = document.getElementById('modal-task-title');
const modalStatus = document.getElementById('modal-status');
const modalProgressBar = document.getElementById('modal-progress-bar');
const taskActionBtn = document.getElementById('task-action-btn');
const closeModalBtn = document.getElementById('close-modal-btn');

// DOM refs - toast
const toastContainer = document.getElementById('toast-container');

// Starfield
const starCanvas = document.getElementById('starfield-canvas');
const starCtx = starCanvas?.getContext('2d');

// Game canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// State
let myId = null;
let currentGameState = 'LOBBY';
const LOCAL_SPEED = 4.5;
let worldActivePlayers = {};
let deadBodies = [];
let mapVents = [];
let taskTemplates = [];
let myTasks = [];
let myRole = 'CREWMATE';
let sabotageActive = false;
let hasVotedThisMeeting = false;
let inVent = false;
let lastKillTime = 0;
const KILL_COOLDOWN_MS = 20000;

let activeProcessingTask = null;
let taskTimer = null;
let meetingTimerInterval = null;
let meetingSecondsLeft = 30;

const inputState = { up: false, down: false, left: false, right: false };
const keyMap = {
    'KeyW': 'up', 'ArrowUp': 'up', 'KeyS': 'down', 'ArrowDown': 'down',
    'KeyA': 'left', 'ArrowLeft': 'left', 'KeyD': 'right', 'ArrowRight': 'right'
};

// ===================== TOAST SYSTEM =====================
function showToast(message, type) {
    if (!toastContainer) return;
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ===================== STARFIELD =====================
function initStarfield() {
    if (!starCanvas || !starCtx) return;
    let w = starCanvas.width = window.innerWidth;
    let h = starCanvas.height = window.innerHeight;
    const stars = Array.from({ length: 140 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.5 + 0.3, a: Math.random(), s: Math.random() * 0.008 + 0.004
    }));
    function drawStars() {
        starCtx.clearRect(0, 0, w, h);
        stars.forEach(st => {
            st.a += st.s;
            const alpha = (Math.sin(st.a) + 1) / 2 * 0.6 + 0.15;
            starCtx.fillStyle = `rgba(200,220,255,${alpha})`;
            starCtx.beginPath(); starCtx.arc(st.x, st.y, st.r, 0, Math.PI * 2); starCtx.fill();
        });
        requestAnimationFrame(drawStars);
    }
    drawStars();
    window.addEventListener('resize', () => {
        w = starCanvas.width = window.innerWidth;
        h = starCanvas.height = window.innerHeight;
    });
}
initStarfield();

// ===================== KILL COOLDOWN RING =====================
function updateKillCooldownUI() {
    const isImpostor = myRole === 'IMPOSTOR' && currentGameState === 'INGAME';
    if (!killCooldownWrap) return;
    if (!isImpostor) { killCooldownWrap.classList.remove('visible'); return; }
    killCooldownWrap.classList.add('visible');
    
    const elapsed = Date.now() - lastKillTime;
    const remaining = Math.max(0, KILL_COOLDOWN_MS - elapsed);
    const pct = remaining / KILL_COOLDOWN_MS;
    
    if (killCooldownCircle) {
        const circ = 2 * Math.PI * 9;
        killCooldownCircle.style.strokeDashoffset = circ * (1 - pct);
        killCooldownCircle.style.strokeDasharray = circ;
    }
    if (killCooldownText) {
        killCooldownText.textContent = remaining > 0 ? Math.ceil(remaining / 1000) : '✓';
        killCooldownText.style.color = remaining > 0 ? '#ff3b30' : '#34C759';
    }
}

// ===================== PLAYER STATUS LIST =====================
function renderPlayerStatusList() {
    if (!playerStatusList) return;
    playerStatusList.innerHTML = '';
    if (currentGameState === 'LOBBY') return;
    Object.keys(worldActivePlayers).forEach(id => {
        const p = worldActivePlayers[id];
        const div = document.createElement('div');
        div.className = `player-status-item ${p.isAlive ? 'player-status-alive' : 'player-status-dead'}`;
        div.innerHTML = `
            <span class="player-status-dot" style="background:${p.color}"></span>
            <span class="player-status-name ${id === myId ? 'player-status-you' : ''}">${p.username}${id === myId ? ' (you)' : ''}</span>
            <span style="font-size:9px;color:#5a5e6a;">${p.isAlive ? '●' : '✕'}</span>
        `;
        playerStatusList.appendChild(div);
    });
}

// Helper: skip game input when typing in a text field
function isInputFocused() {
    const tag = document.activeElement?.tagName || '';
    return tag === 'INPUT' || tag === 'TEXTAREA';
}

window.addEventListener('keydown', (e) => {
    if (currentGameState === 'MEETING') return; // Absolute typing locking interface focus
    if (isInputFocused()) return; // Don't steal keys from text fields
    if (keyMap[e.code]) {
        e.preventDefault();
        inputState[keyMap[e.code]] = true;
        socket.emit('player_input', inputState);
    }
    if (e.code === 'KeyQ' && myRole === 'IMPOSTOR') socket.emit('execute_kill');
    if (e.code === 'Digit1' && myRole === 'IMPOSTOR') socket.emit('trigger_sabotage', 'LIGHTS');
    if (e.code === 'KeyE') evaluateInteractions();
});

window.addEventListener('keyup', (e) => {
    if (isInputFocused()) return;
    if (keyMap[e.code]) {
        inputState[keyMap[e.code]] = false;
        socket.emit('player_input', inputState);
    }
});

function evaluateInteractions() {
    // If in a vent, only allow vent exit
    if (inVent && myRole === 'IMPOSTOR') {
        socket.emit('interact_vent');
        return;
    }

    // 1. Check for Report Engine / Meeting calls first
    socket.emit('trigger_meeting');

    const me = worldActivePlayers[myId];
    if (!me || !me.isAlive) return;

    if (myRole === 'IMPOSTOR') {
        socket.emit('interact_vent');
    }

    if (sabotageActive && Math.hypot(180 - me.x, 620 - me.y) <= 55) {
        socket.emit('repair_sabotage');
        return;
    }

    if (myRole === 'CREWMATE') {
        const incompleteTask = myTasks.find(t => !t.completed && Math.hypot(t.x - me.x, t.y - me.y) <= 75);
        if (incompleteTask) openTaskModal(incompleteTask);
    }
}

function openTaskModal(task) {
    activeProcessingTask = task;
    modalTaskTitle.innerText = task.name;
    modalStatus.innerText = "Click to initiate system sequence.";
    if (modalProgressBar) modalProgressBar.style.width = '0%';
    taskActionBtn.disabled = false;
    taskActionBtn.textContent = '⚡ Execute';
    taskModal.classList.remove('hidden');
}

taskActionBtn.addEventListener('click', () => {
    taskActionBtn.disabled = true;
    taskActionBtn.textContent = '⏳ Processing...';
    modalStatus.innerText = "Running system diagnostics...";
    
    // Animate progress bar over 3 seconds
    let progress = 0;
    const interval = setInterval(() => {
        progress += 3.33;
        if (modalProgressBar) modalProgressBar.style.width = `${Math.min(100, progress)}%`;
    }, 100);
    
    taskTimer = setTimeout(() => {
        clearInterval(interval);
        if (modalProgressBar) modalProgressBar.style.width = '100%';
        if (activeProcessingTask) {
            socket.emit('complete_task', activeProcessingTask.id);
            showToast(`✅ ${activeProcessingTask.name} complete!`, 'success');
            closeTaskModal();
        }
        taskActionBtn.disabled = false;
        taskActionBtn.textContent = '⚡ Execute';
    }, 3000);
});

function closeTaskModal() { clearTimeout(taskTimer); activeProcessingTask = null; taskModal.classList.add('hidden'); if (modalProgressBar) modalProgressBar.style.width = '0%'; }
closeModalBtn.addEventListener('click', closeTaskModal);

// --- Meeting Overlay View Actions Engine ---
socket.on('meeting_started', (data) => {
    currentGameState = 'MEETING';
    hasVotedThisMeeting = false;
    inVent = false; // Reset vent state — meeting exits everyone
    closeTaskModal();
    
    // Populate worldActivePlayers from meeting data so vented players can vote
    worldActivePlayers = {};
    Object.values(data.players).forEach(p => {
        worldActivePlayers[p.id] = p;
    });
    
    meetingBanner.innerText = data.reason;
    meetingStatusLog.innerText = "Discuss and select a target player to eject:";
    chatWindow.innerHTML = `<div style="color:#5ac8fa;">⟡ Audio Channel Open ⟡</div>`;
    
    // Timer countdown
    meetingSecondsLeft = 30;
    if (meetingTimer) meetingTimer.textContent = meetingSecondsLeft;
    clearInterval(meetingTimerInterval);
    meetingTimerInterval = setInterval(() => {
        meetingSecondsLeft--;
        if (meetingTimer) meetingTimer.textContent = Math.max(0, meetingSecondsLeft);
        if (meetingSecondsLeft <= 5 && meetingTimer) meetingTimer.style.color = '#ff3b30';
        if (meetingSecondsLeft <= 0) clearInterval(meetingTimerInterval);
    }, 1000);
    
    buildVotingGrid(data.players);
    meetingOverlay.classList.remove('hidden');
    skipVoteBtn.classList.remove('voted');
    skipVoteBtn.textContent = '⏭ Skip Vote';
});

function buildVotingGrid(players) {
    votingGrid.innerHTML = '';
    Object.values(players).forEach(p => {
        const row = document.createElement('div');
        row.className = `player-row ${!p.isAlive ? 'dead-player' : ''}`;
        const dotColor = p.color || '#888';
        row.innerHTML = `
            <div class="player-info">
                <span class="player-color-dot" style="background:${dotColor}"></span>
                <span>${p.username}</span>
            </div>
            <span class="vote-badge" id="vote-badge-${p.id}">✓</span>
        `;
        
        if (p.isAlive && worldActivePlayers[myId]?.isAlive) {
            row.addEventListener('click', () => {
                if (hasVotedThisMeeting) return;
                hasVotedThisMeeting = true;
                socket.emit('cast_vote', p.id);
                row.classList.add('voted');
                const badge = document.getElementById(`vote-badge-${p.id}`);
                if (badge) badge.classList.add('show');
            });
        }
        votingGrid.appendChild(row);
    });
}

skipVoteBtn.addEventListener('click', () => {
    if (hasVotedThisMeeting || !worldActivePlayers[myId]?.isAlive) return;
    hasVotedThisMeeting = true;
    socket.emit('cast_vote', 'skip');
    skipVoteBtn.classList.add('voted');
    skipVoteBtn.textContent = '⏭ Voted Skip';
});

function sendChatMessage() {
    if (!chatInput.value.trim()) return;
    socket.emit('send_meeting_msg', chatInput.value);
    chatInput.value = '';
}
sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

socket.on('receive_meeting_msg', (payload) => {
    const msg = document.createElement('div');
    msg.innerHTML = `<span style="color:${payload.color}">${payload.sender}</span>: ${payload.text}`;
    if(!payload.isAlive) msg.style.opacity = "0.5";
    chatWindow.appendChild(msg);
    chatWindow.scrollTop = chatWindow.scrollHeight;
});

socket.on('player_voted', (data) => {
    const badge = document.getElementById(`vote-badge-${data.voterId}`);
    if (badge) badge.classList.add('show');
});

socket.on('meeting_concluded', (data) => {
    meetingStatusLog.innerText = data.log;
    meetingBanner.innerText = "Voting Concluded";
    clearInterval(meetingTimerInterval);
    if (meetingTimer) meetingTimer.textContent = '✓';
    if (meetingTimer) meetingTimer.style.color = '#34C759';
    showToast(data.log, data.log.includes('Nobody') ? '' : 'error');
});

socket.on('resume_game', () => {
    meetingOverlay.classList.add('hidden');
    skipVoteBtn.classList.remove('voted');
    skipVoteBtn.textContent = '⏭ Skip Vote';
    if (meetingTimer) {
        meetingTimer.textContent = '30';
        meetingTimer.style.color = '#ffcc00';
    }
    currentGameState = 'INGAME';
});

socket.on('match_ended', (data) => {
    meetingOverlay.classList.add('hidden');
    showToast(`🏆 ${data.message}`, data.message.includes('CREW') ? 'success' : 'error');
    
    currentGameState = 'LOBBY';
    setupPanel.classList.remove('hidden');
    canvasWrapper.classList.add('hidden');
    if (playerStatusList) playerStatusList.innerHTML = '';
});

hostBtn.addEventListener('click', () => {
    if(!usernameIn.value.trim()) return;
    socket.emit('host_room', usernameIn.value);
    startBtn.classList.remove('hidden');
});

joinBtn.addEventListener('click', () => {
    if(!usernameIn.value.trim() || !codeIn.value.trim()) return;
    socket.emit('join_room', { username: usernameIn.value, roomCode: codeIn.value });
});

startBtn.addEventListener('click', () => socket.emit('start_match'));

socket.on('connection_acknowledged', (data) => {
    myId = data.myId;
    mapVents = data.mapVents || [];
    taskTemplates = data.taskTemplates || [];
    roomCodeDisplay.innerText = `◆ Room: ${data.roomCode}`;
    setupPanel.classList.add('hidden');
    canvasWrapper.classList.remove('hidden');
    roleBadge.innerText = '◈ Identity: Pending';
    showToast(`🔗 Connected to room ${data.roomCode}`, 'success');
    requestAnimationFrame(renderTick);
});

socket.on('identity_assignment', (data) => {
    myRole = data.role;
    myTasks = data.tasks || [];
    roleBadge.innerText = `◈ ${myRole}`;
    roleBadge.style.color = (myRole === 'IMPOSTOR') ? '#FF3B30' : '#34C759';
    showToast(`Assigned: ${myRole}`, myRole === 'IMPOSTOR' ? 'error' : 'success');
    updateTaskUI();
});

socket.on('task_updated', (updatedTasks) => { myTasks = updatedTasks; updateTaskUI(); });

socket.on('global_progress_updated', (data) => {
    const pct = Math.min(100, (data.completed / data.required) * 100);
    progressBar.style.width = `${pct}%`;
    if (progressText) progressText.innerText = `${Math.round(pct)}%`;
});

socket.on('sabotage_triggered', (data) => {
    if (data.type === 'LIGHTS') { sabotageActive = true; sabotageAlert.classList.remove('hidden'); showToast('⚠ Lights sabotaged!', 'error'); }
});
socket.on('sabotage_resolved', () => { sabotageActive = false; sabotageAlert.classList.add('hidden'); showToast('✅ Sabotage repaired', 'success'); });
socket.on('match_begun', () => {
    currentGameState = 'INGAME';
    startBtn.classList.add('hidden');
    lastKillTime = Date.now();
    showToast('🚀 Match started!', 'success');
});

socket.on('kill_confirmed', (data) => {
    if (data.victimId === myId) {
        roleBadge.innerText = '◈ ELIMINATED';
        roleBadge.style.color = '#ff3b30';
        showToast('☠ You were eliminated!', 'error');
    } else {
        showToast('☠ A body was discovered!', 'error');
    }
    // Reset kill cooldown for impostor
    lastKillTime = Date.now();
});

socket.on('vent_status', (data) => {
    inVent = data.inVent;
});

socket.on('state_snapshot', (snapshot) => {
    if (currentGameState === 'MEETING') return;
    currentGameState = snapshot.gameState;
    worldActivePlayers = snapshot.players;
    deadBodies = snapshot.deadBodies || [];
    sabotageActive = snapshot.sabotageActive;
    renderPlayerStatusList();
});

// ===================== MAP DESIGN =====================
const ROOM_DEFS = [
    // Top level
    { name: 'Weapons',    x: 30,  y: 20,  w: 220, h: 230, color: '#191d2a', floor: '#1e2230', label: 'WEAPONS' },
    { name: 'Cafeteria',  x: 270, y: 20,  w: 460, h: 230, color: '#1e222e', floor: '#232738', label: 'CAFETERIA' },
    { name: 'Navigation', x: 750, y: 20,  w: 220, h: 230, color: '#191d2a', floor: '#1e2230', label: 'NAVIGATION' },
    // Middle level
    { name: 'MedBay',     x: 30,  y: 280, w: 220, h: 210, color: '#1a261a', floor: '#1f2e1f', label: 'MEDBAY' },
    { name: 'Corridor',   x: 270, y: 280, w: 460, h: 210, color: '#181b24', floor: '#1c1f28', label: null },
    { name: 'Admin',      x: 750, y: 280, w: 220, h: 210, color: '#221e2e', floor: '#28233a', label: 'ADMIN' },
    // Bottom level
    { name: 'Electrical', x: 30,  y: 520, w: 220, h: 160, color: '#2a1e1a', floor: '#33221e', label: 'ELECTRICAL' },
    { name: 'Storage',    x: 270, y: 520, w: 460, h: 160, color: '#202226', floor: '#26282c', label: 'STORAGE' },
    { name: 'Shields',    x: 750, y: 520, w: 220, h: 160, color: '#1a2626', floor: '#1e2e2e', label: 'SHIELDS' },
];

// Wall rectangles with door gaps (dark borders)
const WALL_RECTS = [
    // Outer hull
    { x: 18, y: 16, w: 964, h: 8 },
    { x: 18, y: 676, w: 964, h: 8 },
    { x: 16, y: 16, w: 8, h: 660 },
    { x: 976, y: 16, w: 8, h: 660 },

    // Vertical: Weapons | Cafeteria (door y: 115-155)
    { x: 256, y: 20, w: 8, h: 95 },
    { x: 256, y: 155, w: 8, h: 95 },
    // Vertical: Cafeteria | Navigation (door y: 115-155)
    { x: 736, y: 20, w: 8, h: 95 },
    { x: 736, y: 155, w: 8, h: 95 },

    // Vertical: MedBay | Corridor (no door — solid wall)
    { x: 256, y: 280, w: 8, h: 210 },
    // Vertical: Corridor | Admin (no door — solid wall)
    { x: 736, y: 280, w: 8, h: 210 },

    // Vertical: Electrical | Storage (door y: 615-655)
    { x: 256, y: 520, w: 8, h: 95 },
    { x: 256, y: 655, w: 8, h: 25 },
    // Vertical: Storage | Shields (door y: 615-655)
    { x: 736, y: 520, w: 8, h: 95 },
    { x: 736, y: 655, w: 8, h: 25 },

    // Horizontal: Weapons | MedBay (door x: 125-165)
    { x: 30, y: 256, w: 95, h: 8 },
    { x: 165, y: 256, w: 85, h: 8 },
    // Horizontal: Cafeteria | Corridor (doors: x 355-395, x 605-645)
    { x: 270, y: 256, w: 85, h: 8 },
    { x: 395, y: 256, w: 210, h: 8 },
    { x: 645, y: 256, w: 85, h: 8 },
    // Horizontal: Navigation | Admin (door x: 845-885)
    { x: 750, y: 256, w: 95, h: 8 },
    { x: 885, y: 256, w: 85, h: 8 },

    // Horizontal: MedBay | Electrical (door x: 125-165)
    { x: 30, y: 496, w: 95, h: 8 },
    { x: 165, y: 496, w: 85, h: 8 },
    // Horizontal: Corridor | Storage (doors: x 355-395, x 605-645)
    { x: 270, y: 496, w: 85, h: 8 },
    { x: 395, y: 496, w: 210, h: 8 },
    { x: 645, y: 496, w: 85, h: 8 },
    // Horizontal: Admin | Shields (door x: 845-885)
    { x: 750, y: 496, w: 95, h: 8 },
    { x: 885, y: 496, w: 85, h: 8 },
];

function drawRoomFloors() {
    ROOM_DEFS.forEach(r => {
        ctx.fillStyle = r.floor;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // Subtle floor tile lines
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let tx = r.x + 20; tx < r.x + r.w; tx += 40) {
            ctx.beginPath(); ctx.moveTo(tx, r.y); ctx.lineTo(tx, r.y + r.h); ctx.stroke();
        }
        for (let ty = r.y + 20; ty < r.y + r.h; ty += 40) {
            ctx.beginPath(); ctx.moveTo(r.x, ty); ctx.lineTo(r.x + r.w, ty); ctx.stroke();
        }
    });
}

function drawWalls() {
    ctx.fillStyle = '#0a0c14';
    WALL_RECTS.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
    // Wall highlights for depth
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    WALL_RECTS.forEach(w => {
        ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    });
}

function drawDecorations() {
    // --- WEAPONS: Gun rack ---
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(100, 60, 80, 12);
    ctx.fillRect(105, 80, 70, 8);
    ctx.fillRect(110, 96, 60, 6);
    ctx.fillStyle = '#5a5e6a';
    ctx.fillRect(105, 62, 4, 8); ctx.fillRect(170, 62, 4, 8);
    
    // --- CAFETERIA: Dining tables ---
    ctx.fillStyle = '#2d3240';
    // Long table 1
    ctx.fillRect(340, 70, 100, 14);
    ctx.fillStyle = '#3a3e4a';
    ctx.fillRect(345, 72, 6, 10); ctx.fillRect(430, 72, 6, 10);
    // Long table 2
    ctx.fillStyle = '#2d3240';
    ctx.fillRect(560, 70, 100, 14);
    ctx.fillStyle = '#3a3e4a';
    ctx.fillRect(565, 72, 6, 10); ctx.fillRect(650, 72, 6, 10);
    // Chairs around tables
    ctx.fillStyle = '#222530';
    [[350,90], [420,90], [570,90], [640,90]].forEach(([cx, cy]) => {
        ctx.fillRect(cx, cy, 12, 8);
    });
    // Emergency table (center)
    const etX = 500, etY = 130;
    ctx.fillStyle = '#3a3e4a';
    ctx.beginPath(); ctx.arc(etX, etY, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2d3240';
    ctx.beginPath(); ctx.arc(etX, etY, 16, 0, Math.PI * 2); ctx.fill();
    // Glowing emergency button
    ctx.fillStyle = '#ff3b30';
    ctx.shadowColor = '#ff3b30';
    ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.arc(etX, etY, 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Potted plants
    ctx.fillStyle = '#2d4a2d';
    ctx.beginPath(); ctx.arc(300, 210, 14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(700, 210, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(297, 218, 6, 10);
    ctx.fillRect(697, 218, 6, 10);
    
    // --- NAVIGATION: Console ---
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(830, 60, 60, 14);
    ctx.fillStyle = '#3a3e4a';
    ctx.fillRect(835, 62, 50, 10);
    // Screen glow
    ctx.fillStyle = 'rgba(90,200,250,0.08)';
    ctx.fillRect(840, 50, 40, 12);
    ctx.fillStyle = '#5a5e6a';
    ctx.fillRect(830, 80, 60, 6);
    
    // --- MEDBAY: Medical bed ---
    ctx.fillStyle = '#2a3a2a';
    ctx.fillRect(60, 320, 100, 20);
    ctx.fillStyle = '#3a4a3a';
    ctx.fillRect(65, 322, 90, 16);
    // Pillow
    ctx.fillStyle = '#4a5a4a';
    ctx.fillRect(62, 322, 16, 14);
    // Heart monitor
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(180, 310, 30, 30);
    ctx.strokeStyle = '#34C759';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(185, 325); ctx.lineTo(190, 325);
    ctx.lineTo(192, 318); ctx.lineTo(196, 332);
    ctx.lineTo(198, 325); ctx.lineTo(205, 325);
    ctx.stroke();
    // Cabinet
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(60, 350, 40, 60);
    ctx.strokeStyle = '#3a3e4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(62, 352, 17, 17);
    ctx.strokeRect(82, 352, 17, 17);
    ctx.strokeRect(62, 375, 17, 17);
    ctx.strokeRect(82, 375, 17, 17);
    
    // --- CORRIDOR: Floor lights & plant ---
    // Center floor lights
    ctx.fillStyle = 'rgba(90,200,250,0.06)';
    [380, 430, 480, 530, 580, 630].forEach(fx => {
        ctx.beginPath(); ctx.arc(fx, 390, 8, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#2a2e3a';
    ctx.beginPath(); ctx.arc(350, 440, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2d4a2d';
    ctx.beginPath(); ctx.arc(350, 435, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(348, 443, 4, 10);
    // Side displays
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(290, 320, 40, 30);
    ctx.fillStyle = 'rgba(90,200,250,0.05)';
    ctx.fillRect(294, 324, 32, 22);
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(670, 320, 40, 30);
    ctx.fillStyle = 'rgba(90,200,250,0.05)';
    ctx.fillRect(674, 324, 32, 22);
    
    // --- ADMIN: Desk & filing ---
    ctx.fillStyle = '#2d3240';
    ctx.fillRect(820, 340, 80, 14);
    ctx.fillStyle = '#3a3e4a';
    ctx.fillRect(825, 342, 70, 10);
    // Monitor
    ctx.fillStyle = '#1a1d28';
    ctx.fillRect(840, 310, 40, 30);
    ctx.fillStyle = 'rgba(90,200,250,0.06)';
    ctx.fillRect(842, 312, 36, 26);
    // Filing cabinet
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(820, 370, 30, 50);
    ctx.strokeStyle = '#3a3e4a';
    ctx.strokeRect(822, 372, 11, 11);
    ctx.strokeRect(834, 372, 11, 11);
    ctx.strokeRect(822, 388, 11, 11);
    ctx.strokeRect(834, 388, 11, 11);
    ctx.strokeRect(822, 404, 11, 11);
    ctx.strokeRect(834, 404, 11, 11);
    
    // --- ELECTRICAL: Panels & wires ---
    // Main panel
    ctx.fillStyle = '#2a2e3a';
    ctx.fillRect(60, 560, 50, 60);
    ctx.fillStyle = '#3a3e4a';
    ctx.fillRect(65, 565, 18, 18);
    ctx.fillRect(88, 565, 18, 18);
    ctx.fillRect(65, 588, 18, 18);
    ctx.fillRect(88, 588, 18, 18);
    // Small indicators
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(74, 573, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#34C759';
    ctx.beginPath(); ctx.arc(97, 573, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath(); ctx.arc(74, 596, 3, 0, Math.PI * 2); ctx.fill();
    // Wires on floor
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(130, 580); ctx.quadraticCurveTo(160, 570, 180, 600); ctx.stroke();
    ctx.strokeStyle = '#007AFF';
    ctx.beginPath(); ctx.moveTo(130, 590); ctx.quadraticCurveTo(155, 610, 190, 590); ctx.stroke();
    // Sabotage panel area hint
    ctx.fillStyle = '#b7791f';
    ctx.fillRect(175, 610, 50, 30);
    ctx.fillStyle = '#8a5e1a';
    ctx.fillRect(180, 615, 40, 20);
    // Sparks
    ctx.fillStyle = 'rgba(255,200,50,0.3)';
    ctx.beginPath(); ctx.arc(200, 560, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(220, 575, 4, 0, Math.PI * 2); ctx.fill();
    
    // --- STORAGE: Crates ---
    ctx.fillStyle = '#2d3240';
    ctx.fillRect(380, 560, 50, 40);
    ctx.fillRect(450, 550, 50, 50);
    ctx.fillRect(530, 570, 45, 30);
    ctx.fillRect(610, 555, 55, 45);
    // Crate lines
    ctx.strokeStyle = '#3a3e4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(380, 560, 50, 40);
    ctx.strokeRect(450, 550, 50, 50);
    ctx.strokeRect(530, 570, 45, 30);
    ctx.strokeRect(610, 555, 55, 45);
    // Cross lines on crates
    ctx.beginPath(); ctx.moveTo(380, 560); ctx.lineTo(430, 600); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(430, 560); ctx.lineTo(380, 600); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(450, 550); ctx.lineTo(500, 600); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(500, 550); ctx.lineTo(450, 600); ctx.stroke();
    
    // --- SHIELDS: Generators ---
    ctx.fillStyle = '#2a3a3a';
    ctx.beginPath(); ctx.arc(830, 600, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a4a4a';
    ctx.beginPath(); ctx.arc(830, 600, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(90,200,250,0.08)';
    ctx.beginPath(); ctx.arc(830, 600, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a3a3a';
    ctx.beginPath(); ctx.arc(910, 580, 25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a4a4a';
    ctx.beginPath(); ctx.arc(910, 580, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(90,200,250,0.08)';
    ctx.beginPath(); ctx.arc(910, 580, 23, 0, Math.PI * 2); ctx.fill();
    
    // --- ROOM LABELS ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ROOM_DEFS.forEach(r => {
        if (!r.label) return;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.font = 'bold 18px "Orbitron", sans-serif';
        ctx.fillText(r.label, r.x + r.w/2, r.y + 12);
    });
}

// ===================== DOOR COLLISION =====================
// Door openings defined as rects (passable zones)
const DOOR_RECTS = [
    // Top row: horizontal doors between top rooms
    { x: 125, y: 254, w: 40, h: 12 },  // Weapons <-> MedBay (top)
    { x: 355, y: 254, w: 40, h: 12 },  // Cafeteria <-> Corridor (top-left)
    { x: 605, y: 254, w: 40, h: 12 },  // Cafeteria <-> Corridor (top-right)
    { x: 845, y: 254, w: 40, h: 12 },  // Navigation <-> Admin (top)
    // Top row: vertical doors between top rooms
    { x: 254, y: 115, w: 12, h: 40 },  // Weapons <-> Cafeteria
    { x: 734, y: 115, w: 12, h: 40 },  // Cafeteria <-> Navigation
    // Middle row: horizontal doors
    { x: 125, y: 494, w: 40, h: 12 },  // MedBay <-> Electrical
    { x: 355, y: 494, w: 40, h: 12 },  // Corridor <-> Storage (mid-left)
    { x: 605, y: 494, w: 40, h: 12 },  // Corridor <-> Storage (mid-right)
    { x: 845, y: 494, w: 40, h: 12 },  // Admin <-> Shields
    // Middle row: these paths are blocked — use alternative routes
    // Bottom row: vertical doors
    { x: 254, y: 615, w: 12, h: 40 },  // Electrical <-> Storage
    { x: 734, y: 615, w: 12, h: 40 },  // Storage <-> Shields
];

// Check if a circle (player) collides with any wall rect
function checkWallCollision(px, py, radius) {
    for (const w of WALL_RECTS) {
        // Find closest point on rect to circle center
        const closestX = Math.max(w.x, Math.min(px, w.x + w.w));
        const closestY = Math.max(w.y, Math.min(py, w.y + w.h));
        const dx = px - closestX;
        const dy = py - closestY;
        if (dx * dx + dy * dy < radius * radius) {
            return true;
        }
    }
    return false;
}

function updateTaskUI() {
    taskListElement.innerHTML = '';
    if (myRole === 'IMPOSTOR') {
        taskListElement.innerHTML = `<li style="color:#ff3b30; list-style-type:none;">• Hunt the crew.<br>• Press [1] for Sabotage.<br>• [E] near vents to move.</li>`;
        return;
    }
    myTasks.forEach(t => {
        const item = document.createElement('li');
        item.innerText = `${t.name} (${t.room})`;
        item.style.color = t.completed ? '#34C759' : '#ffcc00';
        if(t.completed) item.style.textDecoration = "line-through";
        taskListElement.appendChild(item);
    });
}

function renderTick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const me = worldActivePlayers[myId];
    
    // 1. Run local client-side prediction if we exist
    if (currentGameState === 'INGAME' && me && me.isAlive && !inVent) {
        let dx = 0, dy = 0;
        if (inputState.up) dy -= 1;
        if (inputState.down) dy += 1;
        if (inputState.left) dx -= 1;
        if (inputState.right) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
        
        // Apply wall collision with axis-separate sliding
        const newX = me.x + dx * LOCAL_SPEED;
        const newY = me.y + dy * LOCAL_SPEED;
        const pr = 14; // player collision radius
        
        if (!checkWallCollision(newX, me.y, pr)) {
            me.x = newX;
        }
        if (!checkWallCollision(me.x, newY, pr)) {
            me.y = newY;
        }
    }

    // 2. Protect the canvas clipping context
    ctx.save();
    
    if (currentGameState === 'INGAME' && me) {
        ctx.beginPath();
        let visionRadius = (sabotageActive && myRole === 'CREWMATE') ? 45 : 180;
        ctx.arc(me.x, me.y, visionRadius, 0, Math.PI * 2);
        ctx.clip();
    } else {
        ctx.beginPath();
        ctx.arc(500, 350, 1000, 0, Math.PI * 2);
        ctx.clip();
    }

    // ==================== MAP DRAWING ====================
    drawRoomFloors();
    drawWalls();
    drawDecorations();

    // ==================== TASK MARKERS ====================
    taskTemplates.forEach(task => {
        ctx.fillStyle = '#3182ce';
        ctx.shadowColor = '#3182ce';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(task.x, task.y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // Pulsing ring
        ctx.strokeStyle = 'rgba(49,130,206,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(task.x, task.y, 15, 0, Math.PI * 2); ctx.stroke();
    });

    // ==================== VENTS ====================
    mapVents.forEach(vent => {
        ctx.fillStyle = '#1a1d28';
        ctx.fillRect(vent.x - 20, vent.y - 10, 40, 20);
        ctx.strokeStyle = '#3a3e4a';
        ctx.lineWidth = 2;
        ctx.strokeRect(vent.x - 20, vent.y - 10, 40, 20);
        // Vent grate lines
        ctx.strokeStyle = '#2a2e3a';
        ctx.lineWidth = 1;
        for (let gx = vent.x - 14; gx <= vent.x + 14; gx += 7) {
            ctx.beginPath(); ctx.moveTo(gx, vent.y - 6); ctx.lineTo(gx, vent.y + 6); ctx.stroke();
        }
    });

    // ==================== DEAD BODIES ====================
    deadBodies.forEach(body => {
        ctx.fillStyle = body.color;
        ctx.shadowColor = 'rgba(255,0,0,0.3)';
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(body.x, body.y + 4, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    });

    // ==================== PLAYERS ====================
    Object.keys(worldActivePlayers).forEach(id => {
        const p = worldActivePlayers[id];
        if (!p.isAlive) return;
        
        // Player shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 18, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
        
        // Player body
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = id === myId ? 10 : 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        
        // Player outline
        ctx.strokeStyle = (id === myId) ? '#ffffff' : '#000000';
        ctx.lineWidth = (id === myId) ? 3 : 2;
        ctx.stroke();
        
        // Player name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(p.username, p.x, p.y - 20);
        ctx.shadowBlur = 0;
        
        // Self highlight ring
        if (id === myId) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
    });

    ctx.restore();

    // 3. Darkness overlay
    if (currentGameState === 'INGAME' && me) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
    
    // 4. Extra UI updates tied to render loop
    updateKillCooldownUI();
    
    requestAnimationFrame(renderTick);
}

// ===================== TOUCH CONTROLS =====================
(function initTouchControls() {
    const touchControls = document.getElementById('touch-controls');
    const joystickArea = document.getElementById('joystick-area');
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    const useBtn = document.getElementById('touch-use-btn');
    const killBtn = document.getElementById('touch-kill-btn');
    const sabotageBtn = document.getElementById('touch-sabotage-btn');

    if (!joystickArea || !joystickKnob) return;

    // Only show on touch-capable devices
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice && window.innerWidth > 1024) {
        if (touchControls) touchControls.style.display = 'none';
    }

    let joystickActive = false;
    let joystickTouchId = null;
    const JOYSTICK_MAX_DIST = 40;

    function getJoystickCenter() {
        const rect = joystickBase.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function handleJoystickStart(touch) {
        joystickActive = true;
        joystickTouchId = touch.identifier;
    }

    function handleJoystickMove(touch) {
        if (!joystickActive) return;
        const center = getJoystickCenter();
        let dx = touch.clientX - center.x;
        let dy = touch.clientY - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Clamp to max distance
        if (dist > JOYSTICK_MAX_DIST) {
            dx = (dx / dist) * JOYSTICK_MAX_DIST;
            dy = (dy / dist) * JOYSTICK_MAX_DIST;
        }

        // Move knob
        joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        // Set input state based on joystick position
        const threshold = 10; // deadzone
        inputState.up = dy < -threshold;
        inputState.down = dy > threshold;
        inputState.left = dx < -threshold;
        inputState.right = dx > threshold;

        if (currentGameState === 'INGAME') {
            socket.emit('player_input', inputState);
        }
    }

    function handleJoystickEnd() {
        joystickActive = false;
        joystickTouchId = null;
        joystickKnob.style.transform = 'translate(-50%, -50%)';
        inputState.up = false;
        inputState.down = false;
        inputState.left = false;
        inputState.right = false;
        if (currentGameState === 'INGAME') {
            socket.emit('player_input', inputState);
        }
    }

    // Joystick touch events
    joystickArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        if (touch) handleJoystickStart(touch);
    }, { passive: false });

    joystickArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === joystickTouchId || !joystickActive) {
                handleJoystickMove(touch);
            }
        }
    }, { passive: false });

    joystickArea.addEventListener('touchend', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
                handleJoystickEnd();
            }
        }
    }, { passive: false });

    joystickArea.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        handleJoystickEnd();
    }, { passive: false });

    // Action buttons
    function setupTouchButton(btn, action) {
        if (!btn) return;
        
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            btn.classList.add('pressed');
            
            switch (action) {
                case 'kill':
                    if (myRole === 'IMPOSTOR' && currentGameState === 'INGAME') {
                        socket.emit('execute_kill');
                    }
                    break;
                case 'use':
                    if (currentGameState === 'INGAME') {
                        evaluateInteractions();
                    }
                    break;
                case 'sabotage':
                    if (myRole === 'IMPOSTOR' && currentGameState === 'INGAME') {
                        socket.emit('trigger_sabotage', 'LIGHTS');
                    }
                    break;
            }
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            btn.classList.remove('pressed');
        }, { passive: false });

        btn.addEventListener('touchcancel', (e) => {
            btn.classList.remove('pressed');
        }, { passive: false });
    }

    setupTouchButton(useBtn, 'use');
    setupTouchButton(killBtn, 'kill');
    setupTouchButton(sabotageBtn, 'sabotage');

    // Also support mouse for testing on desktop
    let mouseJoystick = false;
    joystickArea.addEventListener('mousedown', (e) => {
        mouseJoystick = true;
        handleJoystickStart({ clientX: e.clientX, clientY: e.clientY, identifier: 0 });
    });

    document.addEventListener('mousemove', (e) => {
        if (!mouseJoystick) return;
        handleJoystickMove({ clientX: e.clientX, clientY: e.clientY, identifier: 0 });
    });

    document.addEventListener('mouseup', () => {
        if (!mouseJoystick) return;
        mouseJoystick = false;
        handleJoystickEnd();
    });
})();