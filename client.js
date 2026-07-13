const socket = io();

// DOM Accessors
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
const sabotageIndicator = document.getElementById('sabotage-indicator');

const meetingOverlay = document.getElementById('meeting-overlay');
const meetingBanner = document.getElementById('meeting-banner');
const meetingReason = document.getElementById('meeting-reason');
const meetingTimer = document.getElementById('meeting-timer');
const meetingResult = document.getElementById('meeting-result');
const votingGrid = document.getElementById('voting-grid');
const skipVoteBtn = document.getElementById('skip-vote-btn');
const chatWindow = document.getElementById('chat-window');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

const taskModal = document.getElementById('task-modal');
const modalTaskTitle = document.getElementById('modal-task-title');
const modalStatus = document.getElementById('modal-status');
const taskActionBtn = document.getElementById('task-action-btn');
const closeModalBtn = document.getElementById('close-modal-btn');

// 3D Engine Variables
let scene, camera, renderer;
let playerMeshes = {};
let wallMeshes = [];
let taskMeshes = [];
let bodyMeshes = [];
let playerLight;
let ambientLights = [];
let ceilingLights = [];

// Client Logic State Variables
let myId = null;
let currentGameState = 'LOBBY';
const LOCAL_SPEED = 4.5;
let worldActivePlayers = {};
let deadBodies = [];
let taskTemplates = [];
let myTasks = [];
let myRole = 'CREWMATE';
let sabotageActive = false;
let hasVotedThisMeeting = false;
let amInVent = false;
let myLastPos = { x: 500, y: 370 };
let currentTask = null;
let playerRotationAngle = 0;

const inputState = { up: false, down: false, left: false, right: false };
const keyMap = {
    'KeyW': 'up', 'ArrowUp': 'up', 'KeyS': 'down', 'ArrowDown': 'down',
    'KeyA': 'left', 'ArrowLeft': 'left', 'KeyD': 'right', 'ArrowRight': 'right'
};

// ===================== EXCLUSIVE THREE.JS SETUP CONTEXT =====================
function init3DEngine() {
    const container = document.getElementById('3d-container');
    
    scene = new THREE.Scene();
    // Deep cosmic void vacuum black
    scene.background = new THREE.Color('#02050a');
    scene.fog = new THREE.FogExp2('#02050a', 0.002); // Darker falloff density

    // Changed: Optimized FOV for close-quarter immersion
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Changed: Drop the ambient light way down so the map drops into an unlit, dim base
    const ambientLight = new THREE.AmbientLight('#111422', 0.25); 
    scene.add(ambientLight);
    ambientLights.push(ambientLight);

    // Subtle dark blue fill to give shadows a moody space vibe without blowing out the floor
    const hemiLight = new THREE.HemisphereLight('#223355', '#080a10', 0.2);
    scene.add(hemiLight);
    ambientLights.push(hemiLight);

    // Save baseline states for Sabotages
    ambientLights.forEach(l => {
        l.userData = {
            normalIntensity: l.intensity,
            sabIntensity: 0.02 // Almost completely black during a sabotage
        };
    });

    // Changed: Your main vision ring. This light will cut through the dark base map!
    playerLight = new THREE.PointLight('#ffffff', 5.0, 320); 
    playerLight.castShadow = true; // Turn shadows back on so walls block vision dynamically!
    playerLight.shadow.mapSize.width = 1024;
    playerLight.shadow.mapSize.height = 1024;
    playerLight.shadow.bias = -0.002;
    scene.add(playerLight);

    // Remove or heavily dim the overhead ceiling lights array so they don't wash out rooms
    ceilingLights = []; // Clear old ceiling lights to prevent ghost lighting loops

    // Keep floor initialization
    buildMapFloors();
    buildMapWalls();
    buildMapFeatures();
    buildDetailedRooms(scene);

    window.addEventListener('resize', onWindowResize);
}

// Coordinate Mapper Engine (2D Level Array Map coordinates to 3D Space Coordinates)
function mapTo3D(x, y) {
    // Center map around world absolute zero coordinate vector matrices
    return { x: x - 500, z: y - 350 };
}

function buildMapFloors() {
    // Main floor - visible industrial ship floor (catches spotlight well)
    const floorGeo = new THREE.PlaneGeometry(1000, 700);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: '#0a101d', // Dark steel grid floor space
        roughness: 0.5, 
        metalness: 0.6  // Reflects structural neon way better
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -15;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid overlay for spatial reference
    const grid = new THREE.GridHelper(1000, 40, '#00f0ff', '#051122'); // Neon teal blueprint matrix
    grid.position.y = -14;
    grid.material.transparent = true;
    grid.material.opacity = 0.15; // Kept faint for subtle visual tracking metrics
    scene.add(grid);

    // Room accent lights (small glowing floor markers)
    const accentPositions = [
        { x: 0, z: 0 },
        { x: 200, z: 150 },
        { x: -200, z: -150 },
        { x: -250, z: 200 },
        { x: 250, z: -200 }
    ];
    accentPositions.forEach(pos => {
        const glowGeo = new THREE.CircleGeometry(6, 16);
        const glowMat = new THREE.MeshBasicMaterial({ color: '#5ac8fa', transparent: true, opacity: 0.15, side: THREE.DoubleSide });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(pos.x, -14.5, pos.z);
        scene.add(glow);
    });
}

// Map Layout Definitions (Imported from 2D Layout schema structure metrics)
const WALL_RECTS = [
    { x: 18, y: 16, w: 964, h: 8 },  { x: 18, y: 676, w: 964, h: 8 },
    { x: 16, y: 16, w: 8, h: 660 },   { x: 976, y: 16, w: 8, h: 660 },
    { x: 256, y: 20, w: 8, h: 95 },   { x: 256, y: 155, w: 8, h: 95 },
    { x: 736, y: 20, w: 8, h: 95 },   { x: 736, y: 155, w: 8, h: 95 },
    { x: 256, y: 280, w: 8, h: 210 }, { x: 736, y: 280, w: 8, h: 210 },
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

function buildMapWalls() {
    WALL_RECTS.forEach(w => {
        const geo = new THREE.BoxGeometry(w.w, 40, w.h);
        const mat = new THREE.MeshStandardMaterial({ color: '#3a3e4a', roughness: 0.3, metalness: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        
        const pos = mapTo3D(w.x + w.w / 2, w.y + w.h / 2);
        mesh.position.set(pos.x, 5, pos.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        wallMeshes.push(mesh);
    });
}

// ===================== MAP FEATURES (Room labels, Tasks, Buttons, Vents) =====================
// Helper: create a text sprite for 3D labels
function makeTextSprite(text, opts = {}) {
    const {
        fontSize = 24,
        fontFamily = 'Inter, sans-serif',
        fontWeight = 'bold',
        color = '#ffffff',
        bgColor = 'rgba(0,0,0,0.6)',
        padding = 12,
        borderRadius = 8,
        scale = 60
    } = opts;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    canvas.width = textWidth + padding * 2 + 8;
    canvas.height = fontSize * 1.8;
    // Background
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, borderRadius);
    ctx.fill();
    // Text
    ctx.fillStyle = color;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(scale * aspect, scale, 1);
    return sprite;
}

// Room definitions for labels
const ROOM_DEFS = [
    { name: 'Cafeteria', x: 620, y: 130 },
    { name: 'MedBay', x: 130, y: 280 },
    { name: 'Admin', x: 850, y: 320 },
    { name: 'Electrical', x: 170, y: 570 },
    { name: 'Storage', x: 520, y: 620 },
    { name: 'Weapons', x: 100, y: 80 },
    { name: 'Upper Engine', x: 400, y: 50 },
    { name: 'Lower Engine', x: 400, y: 660 },
    { name: 'Reactor', x: 260, y: 280 },
    { name: 'Security', x: 740, y: 280 },
    { name: 'Shields', x: 260, y: 470 },
    { name: 'Comms', x: 740, y: 470 },
];

// Interactive points on the map (task locations, button, sabotage, vents)
const MAP_VENTS = [
    { id: 'vent_cafeteria', x: 650, y: 150, targetId: 'vent_admin' },
    { id: 'vent_admin',     x: 850, y: 420, targetId: 'vent_cafeteria' },
    { id: 'vent_medbay',    x: 150, y: 380, targetId: 'vent_electrical' },
    { id: 'vent_electrical',x: 150, y: 600, targetId: 'vent_medbay' },
    { id: 'vent_weapons',   x: 120, y: 120, targetId: 'vent_storage' },
    { id: 'vent_storage',   x: 500, y: 620, targetId: 'vent_weapons' }
];

const MAP_INTERACTIVES = [
    // Emergency Meeting Button (Cafeteria)
    { type: 'emergency', label: '🚨 Meeting', x: 500, y: 130 },
    // Sabotage Repair (Electrical)
    { type: 'repair', label: '🔧 Repair', x: 180, y: 620 },
    // Tasks (from TASK_TEMPLATES)
    { type: 'task', label: 'Fix Wiring', subtitle: 'Electrical', x: 200, y: 610, color: '#ffcc00' },
    { type: 'task', label: 'Download Data', subtitle: 'Cafeteria', x: 600, y: 150, color: '#5ac8fa' },
    { type: 'task', label: 'Divert Power', subtitle: 'Admin', x: 850, y: 380, color: '#ff9500' },
    { type: 'task', label: 'ID Scan', subtitle: 'MedBay', x: 140, y: 340, color: '#34C759' },
    { type: 'task', label: 'Swipe Card', subtitle: 'Admin', x: 880, y: 360, color: '#AF52DE' },
    // Vents
    { type: 'vent', label: 'Vent', x: 650, y: 150 },
    { type: 'vent', label: 'Vent', x: 850, y: 420 },
    { type: 'vent', label: 'Vent', x: 150, y: 380 },
    { type: 'vent', label: 'Vent', x: 150, y: 600 },
    { type: 'vent', label: 'Vent', x: 120, y: 120 },
    { type: 'vent', label: 'Vent', x: 500, y: 620 },
];

function buildMapFeatures() {
    // 1. Room labels
    ROOM_DEFS.forEach(room => {
        const pos = mapTo3D(room.x, room.y);
        const sprite = makeTextSprite(room.name, {
            color: '#8a9aba',
            fontSize: 22,
            bgColor: 'rgba(0,0,0,0.5)',
            scale: 50
        });
        sprite.position.set(pos.x, -12, pos.z);
        scene.add(sprite);
    });

    // 2. Interactive markers
    MAP_INTERACTIVES.forEach(item => {
        const pos = mapTo3D(item.x, item.y);

        if (item.type === 'emergency') {
            // Big glowing red button
            const group = new THREE.Group();
            const baseGeo = new THREE.CylinderGeometry(14, 18, 6, 16);
            const baseMat = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0.4 });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = -12;
            group.add(base);
            // Glow ring
            const ringGeo = new THREE.RingGeometry(18, 26, 32);
            const ringMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.3, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = -11;
            group.add(ring);
            // Label
            const label = makeTextSprite(item.label, { color: '#ff6b6b', fontSize: 20, bgColor: 'rgba(255,59,48,0.2)', scale: 35 });
            label.position.set(0, -5, 0);
            group.add(label);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);
        } 
        else if (item.type === 'repair') {
            // Sabotage repair station
            const group = new THREE.Group();
            const geo = new THREE.BoxGeometry(20, 4, 20);
            const mat = new THREE.MeshStandardMaterial({ color: '#ffcc00', emissive: '#ffcc00', emissiveIntensity: 0.3 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = -13;
            group.add(mesh);
            // Pulsing ring
            const ringGeo = new THREE.RingGeometry(14, 22, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: '#ffcc00', transparent: true, opacity: 0.25, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = -12;
            group.add(ring);
            const label = makeTextSprite(item.label, { color: '#ffcc00', fontSize: 18, bgColor: 'rgba(255,204,0,0.15)', scale: 30 });
            label.position.set(0, -3, 0);
            group.add(label);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);
        }
        else if (item.type === 'task') {
            // Task station marker
            const group = new THREE.Group();
            // Pedestal
            const geo = new THREE.CylinderGeometry(6, 8, 4, 12);
            const mat = new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 0.3 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = -13;
            group.add(mesh);
            // Glow cone
            const coneGeo = new THREE.ConeGeometry(4, 10, 12);
            const coneMat = new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0.15 });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.y = -8;
            group.add(cone);
            // Short label
            const shortName = item.label.substring(0, 10);
            const label = makeTextSprite(shortName, { color: item.color, fontSize: 16, bgColor: `rgba(0,0,0,0.5)`, scale: 22 });
            label.position.set(0, -2, 0);
            group.add(label);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);
        }
        else if (item.type === 'vent') {
            // Vent indicator - bright visible marker
            const group = new THREE.Group();
            // Outer glow ring
            const ringGeo = new THREE.RingGeometry(10, 16, 28);
            const ringMat = new THREE.MeshBasicMaterial({ color: '#5ac8fa', transparent: true, opacity: 0.5, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = -14;
            group.add(ring);
            // Dark inner hole
            const dotGeo = new THREE.CircleGeometry(8, 20);
            const dotMat = new THREE.MeshBasicMaterial({ color: '#0a0a10', side: THREE.DoubleSide });
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.rotation.x = -Math.PI / 2;
            dot.position.y = -13.8;
            group.add(dot);
            // Arrow label above
            const label = makeTextSprite('▼ Vent', { color: '#5ac8fa', fontSize: 16, bgColor: 'rgba(0,0,0,0.4)', scale: 24 });
            label.position.set(0, -5, 0);
            group.add(label);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);
        }
    });
}

// ==========================================
// 1. DETAILED ENVIRONMENT PROPS & ROOM BOUNDS
// ==========================================
function buildDetailedRooms(scene) {
    // Structural Support Pillars
    const pillarGeo = new THREE.CylinderGeometry(0.4, 0.6, 12, 6);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#101c2c', metalness: 0.8, roughness: 0.2 });
    
    const coordinates = [
        {x: -15, z: -15}, {x: 15, z: -15},
        {x: -15, z: 15}, {x: 15, z: 15}
    ];
    
    coordinates.forEach(pos => {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(pos.x, 6, pos.z);
        scene.add(pillar);
        
        // Add neon status lights spiraling up columns
        const lightGeo = new THREE.BoxGeometry(0.1, 2, 0.1);
        const lightMat = new THREE.MeshBasicMaterial({ color: '#00f0ff' });
        const neonStrip = new THREE.Mesh(lightGeo, lightMat);
        neonStrip.position.set(pos.x, 6, pos.z + 0.6);
        scene.add(neonStrip);
    });
}

// ==========================================
// 2. DYNAMICALLY TRACK PLAYER ON THE MINI-MAP
// ==========================================
// Translates 3D scene coordinates into 2D SVG minimap space
// 3D range: x ≈ -500..+500, z ≈ -350..+350
// SVG range: 0..200 (width), 0..160 (height)
function updateMiniMapTracking(x3d, z3d) {
    const mapWidth = 200;
    const mapHeight = 160;
    
    // Convert from 3D centered coords back to game coords then map to SVG
    const gameX = x3d + 500;   // 0..1000
    const gameY = z3d + 350;   // 0..700
    
    const svgX = (gameX / 1000) * mapWidth;
    const svgY = (gameY / 700) * mapHeight;
    
    const playerBlip = document.getElementById('player-blip');
    if (playerBlip) {
        playerBlip.setAttribute('cx', Math.max(8, Math.min(mapWidth - 8, svgX)));
        playerBlip.setAttribute('cy', Math.max(8, Math.min(mapHeight - 8, svgY)));
    }
}

// ==========================================
// 3. SILENT VECTOR ALERTS (SABOTAGE VISUALS)
// ==========================================
function triggerShipwideAlert(roomKey, dangerLevel) {
    const targetRoom = document.getElementById(`room-${roomKey}`);
    const alertBlip = document.getElementById('map-alert-blip');
    
    if (!targetRoom) return;

    if (dangerLevel === 'critical') {
        targetRoom.style.fill = 'rgba(255, 0, 85, 0.4)';
        targetRoom.style.stroke = '#ff0055';
        
        if (roomKey === 'reactor') { alertBlip.setAttribute('cx', '40'); alertBlip.setAttribute('cy', '78'); }
        if (roomKey === 'nav') { alertBlip.setAttribute('cx', '100'); alertBlip.setAttribute('cy', '25'); }
        if (roomKey === 'medbay') { alertBlip.setAttribute('cx', '160'); alertBlip.setAttribute('cy', '78'); }
        if (roomKey === 'shields') { alertBlip.setAttribute('cx', '100'); alertBlip.setAttribute('cy', '133'); }
        
        alertBlip.classList.add('map-alert-active');
        
        // Drop ship lighting into intense Crimson Emergency State
        if (window.ambientLight) {
            window.ambientLight.color.setHex(0xff0033);
        }
    } else {
        targetRoom.style.fill = 'rgba(0, 240, 255, 0.1)';
        targetRoom.style.stroke = '#00f0ff';
        alertBlip.classList.remove('map-alert-active');
        
        if (window.ambientLight) {
            window.ambientLight.color.setHex(0x00f0ff);
        }
    }
}

// Camera smoothing state
let cameraTarget = { x: 0, y: 0, z: 0 };
let cameraLookTarget = { x: 0, y: 0, z: 0 };

function lerpVal(a, b, t) {
    return a + (b - a) * t;
}

// ===================== CLIENT LOOP RENDERING =====================
function animate() {
    requestAnimationFrame(animate);

    const me = worldActivePlayers[myId];
    
    if (me && me.isAlive) {
        myLastPos.x = me.x;
        myLastPos.y = me.y;

        const pos3D = mapTo3D(me.x, me.y);
        const isSabotageDark = sabotageActive && myRole === 'CREWMATE';
        
        // Handle Sabotage dark state changes
        ambientLights.forEach(l => { l.intensity = isSabotageDark ? l.userData.sabIntensity : l.userData.normalIntensity; });
        scene.background = isSabotageDark ? new THREE.Color('#020305') : new THREE.Color('#06080c');
        
        // Pin the bright point light just above your player's head (y = 35)
        playerLight.position.set(pos3D.x, 35, pos3D.z);
        
        if (isSabotageDark) {
            playerLight.intensity = 1.5;
            playerLight.distance = 90; // Very tiny vision radius during sabotage!
        } else {
            playerLight.intensity = 5.0; 
            playerLight.distance = 320; // Normal dynamic vision range through corridors
        }

        // Changed: High-Angle Wide Top-Down view offset configurations
        // Zooms the camera out and pulls it back to display neighboring rooms
        cameraTarget.x = pos3D.x;
        cameraTarget.y = 280;   // High altitude vantage point
        cameraTarget.z = pos3D.z + 180; // Pulled back for an angled perspective view

        // Look directly at the player model center point
        cameraLookTarget.x = pos3D.x;
        cameraLookTarget.y = 0;
        cameraLookTarget.z = pos3D.z;

    } else if (amInVent) {
        const pos3D = mapTo3D(myLastPos.x, myLastPos.y);
        cameraTarget.x = pos3D.x;
        cameraTarget.y = 280;
        cameraTarget.z = pos3D.z + 180;
        cameraLookTarget.x = pos3D.x;
        cameraLookTarget.y = 0;
        cameraLookTarget.z = pos3D.z;
    } else {
        cameraTarget.x = 0;
        cameraTarget.y = 350;
        cameraTarget.z = 350;
        cameraLookTarget.set(0, 0, 0);
    }

    // Smooth camera tracking interpolation (removes standard frame jittering)
    camera.position.x = lerpVal(camera.position.x, cameraTarget.x, 0.1);
    camera.position.y = lerpVal(camera.position.y, cameraTarget.y, 0.1);
    camera.position.z = lerpVal(camera.position.z, cameraTarget.z, 0.1);
    
    camera.lookAt(cameraLookTarget.x, cameraLookTarget.y, cameraLookTarget.z);

    // Update holographic minimap with player position
    const pos3D = mapTo3D(myLastPos.x, myLastPos.y);
    updateMiniMapTracking(pos3D.x, pos3D.z);

    syncNetworkElements();
    renderer.render(scene, camera);
}

function syncNetworkElements() {
    // Get your own player data to calculate distance metrics
    const me = worldActivePlayers[myId];
    const isSabotageDark = sabotageActive && myRole === 'CREWMATE';
    
    // Determine current vision threshold limit based on lighting state
    const maxVisionDistance = isSabotageDark ? 90 : 320; 

    // 1. Players Loop
    Object.keys(worldActivePlayers).forEach(id => {
        const p = worldActivePlayers[id];
        if (!p.isAlive) {
            if (playerMeshes[id]) {
                scene.remove(playerMeshes[id]);
                delete playerMeshes[id];
            }
            return;
        }

        const pos = mapTo3D(p.x, p.y);
        if (!playerMeshes[id]) {
            // Build capsule design mesh models for astronauts
            const group = new THREE.Group();
            const bodyGeo = new THREE.CylinderGeometry(14, 14, 32, 16);
            const bodyMat = new THREE.MeshStandardMaterial({ 
                color: p.color || '#fff', 
                roughness: 0.6, 
                metalness: 0.0, // Lower metalness for a less shiny, more cartoony skin look
                emissive: p.color || '#fff', 
                emissiveIntensity: 0.45 // Keeps their team colors glowing bright across the room
            });
            const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
            bodyMesh.castShadow = true;
            group.add(bodyMesh);

            // Outline ring around the body center to make it pop
            const ringGeo = new THREE.TorusGeometry(16, 2.5, 12, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = Math.PI / 2;
            ringMesh.position.y = 0;
            group.add(ringMesh);

            // Visor Glass
            const visorGeo = new THREE.BoxGeometry(16, 9, 7);
            const visorMat = new THREE.MeshStandardMaterial({ color: '#5ac8fa', roughness: 0.1, emissive: '#5ac8fa', emissiveIntensity: 0.8 });
            const visorMesh = new THREE.Mesh(visorGeo, visorMat);
            visorMesh.position.set(0, 6, 11);
            group.add(visorMesh);

            // Upward light beam on each player (cone above head for visibility in dark)
            const beamGeo = new THREE.ConeGeometry(20, 40, 12, 1, true);
            const beamMat = new THREE.MeshBasicMaterial({
                color: p.color || '#ffffff',
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const beam = new THREE.Mesh(beamGeo, beamMat);
            beam.position.y = 20;
            beam.rotation.x = Math.PI;
            group.add(beam);

            // Glow ring beneath feet so players are visible on the dark floor
            const glowGeo = new THREE.RingGeometry(18, 26, 32);
            const glowMat = new THREE.MeshBasicMaterial({ color: p.color || '#fff', transparent: true, opacity: 0.6, side: THREE.DoubleSide });
            const glowMesh = new THREE.Mesh(glowGeo, glowMat);
            glowMesh.rotation.x = -Math.PI / 2;
            glowMesh.position.y = -15;
            group.add(glowMesh);

            // Player name label (text sprite)
            const labelCanvas = document.createElement('canvas');
            labelCanvas.width = 256;
            labelCanvas.height = 64;
            const lctx = labelCanvas.getContext('2d');
            lctx.fillStyle = 'rgba(0,0,0,0.55)';
            lctx.beginPath();
            lctx.roundRect(8, 8, 240, 48, 12);
            lctx.fill();
            lctx.fillStyle = '#ffffff';
            lctx.font = 'bold 22px Inter, sans-serif';
            lctx.textAlign = 'center';
            lctx.textBaseline = 'middle';
            lctx.fillText(p.username, 128, 36);
            const labelTex = new THREE.CanvasTexture(labelCanvas);
            const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
            const labelSprite = new THREE.Sprite(labelMat);
            labelSprite.position.set(0, 28, 0);
            labelSprite.scale.set(40, 10, 1);
            group.add(labelSprite);

            scene.add(group);
            playerMeshes[id] = group;
        }

        playerMeshes[id].position.set(pos.x, 0, pos.z);

        // Rotate player meshes to face their movement direction
        if (id === myId) {
            playerMeshes[id].rotation.y = playerRotationAngle;
        } else {
            if (p.lastInput) {
                let pdx = 0, pdz = 0;
                if (p.lastInput.left) pdx = -1;
                if (p.lastInput.right) pdx = 1;
                if (p.lastInput.up) pdz = -1;
                if (p.lastInput.down) pdz = 1;
                if (pdx !== 0 || pdz !== 0) {
                    playerMeshes[id].rotation.y = Math.atan2(pdx, pdz);
                }
            }
        }

        // ===================== VISIBILITY RADIUS CHECK =====================
        // If it's another player, calculate how far they are from you
        if (id !== myId && me && me.isAlive) {
            const distanceToPlayer = Math.hypot(p.x - me.x, p.y - me.y);

            if (distanceToPlayer > maxVisionDistance) {
                playerMeshes[id].visible = false;
            } else {
                playerMeshes[id].visible = true;
            }
        } else {
            playerMeshes[id].visible = true;
        }
    });

    // Remove disconnected/dead players from world renderer execution loop array
    // (but keep our own mesh if we're in a vent — we'll reappear on exit)
    Object.keys(playerMeshes).forEach(id => {
        if (!worldActivePlayers[id] && !(id === myId && amInVent)) {
            scene.remove(playerMeshes[id]);
            delete playerMeshes[id];
        }
    });

    // 2. Dead Bodies
    while(bodyMeshes.length < deadBodies.length) {
        const b = deadBodies[bodyMeshes.length];
        const geo = new THREE.SphereGeometry(10, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);
        const pos = mapTo3D(b.x, b.y);
        mesh.position.set(pos.x, -10, pos.z);
        scene.add(mesh);
        bodyMeshes.push(mesh);
    }

    // Apply the same visibility rules to dead bodies so they don't pop up out of the dark
    deadBodies.forEach((b, index) => {
        if (bodyMeshes[index] && me && me.isAlive) {
            const distanceToBody = Math.hypot(b.x - me.x, b.y - me.y);
            bodyMeshes[index].visible = (distanceToBody <= maxVisionDistance);
        }
    });
}

// ===================== INPUT BINDINGS =====================
function isInputFocused() {
    return document.activeElement?.tagName === 'INPUT';
}

window.addEventListener('keydown', (e) => {
    if (currentGameState === 'MEETING' || isInputFocused()) return;
    if (keyMap[e.code]) {
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
    const me = worldActivePlayers[myId];

    // If we're in a vent, E always means exit/teleport
    if (amInVent) {
        socket.emit('interact_vent');
        return;
    }

    if (!me || !me.isAlive) return;

    // 1. Check emergency button (Cafeteria at 500,130) or dead body nearby → call meeting
    const nearMeetingButton = Math.hypot(500 - me.x, 130 - me.y) <= 55;
    const nearDeadBody = deadBodies.some(body => Math.hypot(body.x - me.x, body.y - me.y) <= 80);
    if (nearMeetingButton || nearDeadBody) {
        socket.emit('trigger_meeting');
        return;
    }

    // 2. Check sabotage repair (Electrical at 180,620)
    if (sabotageActive && Math.hypot(180 - me.x, 620 - me.y) <= 65) {
        socket.emit('repair_sabotage');
        return;
    }

    // 3. Check vent interaction (Impostor only)
    if (myRole === 'IMPOSTOR') {
        const nearVent = MAP_VENTS.find(v => Math.hypot(v.x - me.x, v.y - me.y) <= 45);
        if (nearVent) {
            socket.emit('interact_vent');
            showToast('🌀 Using vent...', 1000);
            return;
        }
    }

    // 4. Check task completion (Crewmate only)
    // Important: distance must match server's check (75 units)
    if (myRole === 'CREWMATE') {
        const incompleteTask = myTasks.find(t => !t.completed && Math.hypot(t.x - me.x, t.y - me.y) <= 75);
        if (incompleteTask) {
            openTaskModal(incompleteTask);
            return;
        }
    }
}

// ===================== INTERACTIVE MINIGAME CORE ENGINE =====================
let wireState = { leftWires: [], rightWires: [], activeWire: null };
let swipeState = { dragging: false, startX: 0, startTime: 0, currentX: 20 };
let holdIntervalId = null;

const wiresCanvas = document.getElementById('wires-canvas');
const wiresCtx = wiresCanvas ? wiresCanvas.getContext('2d') : null;

// Primary Modal Overhaul Injection Router
function openTaskModal(task) {
    currentTask = task;
    modalTaskTitle.innerText = task.name.toUpperCase();
    modalStatus.innerText = `Node location: [${task.room.toUpperCase()} SUBSYSTEM terminal]`;
    taskModal.classList.remove('hidden');

    // Hide all minigame layers initially
    document.getElementById('game-wires').classList.add('hidden');
    document.getElementById('game-swipe').classList.add('hidden');
    document.getElementById('game-progress').classList.add('hidden');
    document.getElementById('game-divert').classList.add('hidden');
    document.getElementById('game-download').classList.add('hidden'); // Clear new layer

    // Route Task templates matching template IDs from the server configuration layout
    if (task.id === 'task_wires') {
        document.getElementById('game-wires').classList.remove('hidden');
        initWiresGame();
    } else if (task.id === 'task_swipe') {
        document.getElementById('game-swipe').classList.remove('hidden');
        initSwipeGame();
    } else if (task.id === 'task_divert') {
        document.getElementById('game-divert').classList.remove('hidden');
        initDivertGame();
    } else if (task.id === 'task_download') { // NEW ROUTE INJECTION
        document.getElementById('game-download').classList.remove('hidden');
        initRunnerGame();
    } else {
        // Fallback catch-all structural framework for remaining utility triggers (e.g., task_scan)
        document.getElementById('game-progress').classList.remove('hidden');
        initHoldProgressGame(task);
    }
}

// Close helper clearing dynamic loop artifacts
closeModalBtn.addEventListener('click', () => {
    taskModal.classList.add('hidden');
    currentTask = null;
    cleanupActiveGames();
});

function cleanupActiveGames() {
    if (holdIntervalId) { clearInterval(holdIntervalId); holdIntervalId = null; }
    removeWireListeners();
    removeSwipeListeners();
    removeDivertListeners();
    removeRunnerListeners(); // Destroy running canvas animations safely
}

function triggerMinigameSuccess() {
    if (currentTask) {
        socket.emit('complete_task', currentTask.id);
        showToast(`✅ ${currentTask.name} Finished!`, 2000);
        taskModal.classList.add('hidden');
        currentTask = null;
    }
    cleanupActiveGames();
}

// --- GAME MODULE 1: FIX WIRING ENGINE ---
function initWiresGame() {
    const colors = ['#FF3B30', '#007AFF', '#FFCC00', '#AF52DE'];
    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
    
    let leftColors = shuffle([...colors]);
    let rightColors = shuffle([...colors]);

    wireState.leftWires = leftColors.map((color, i) => ({ x: 30, y: 45 + i * 60, color, connected: false, targetIdx: -1 }));
    wireState.rightWires = rightColors.map((color, i) => ({ x: 420, y: 45 + i * 60, color, connected: false }));
    wireState.activeWire = null;

    drawWires();
    wiresCanvas.addEventListener('mousedown', onWireMouseDown);
    wiresCanvas.addEventListener('mousemove', onWireMouseMove);
    window.addEventListener('mouseup', onWireMouseUp);
}

function drawWires() {
    if (!wiresCtx) return;
    wiresCtx.clearRect(0, 0, wiresCanvas.width, wiresCanvas.height);

    // Draw active dynamic connection drag pathing
    if (wireState.activeWire) {
        wiresCtx.beginPath();
        wiresCtx.moveTo(wireState.activeWire.startNode.x, wireState.activeWire.startNode.y);
        wiresCtx.lineTo(wireState.activeWire.currentX, wireState.activeWire.currentY);
        wiresCtx.strokeStyle = wireState.activeWire.startNode.color;
        wiresCtx.lineWidth = 5;
        wiresCtx.stroke();
    }

    // Draw standard node terminals
    wireState.leftWires.forEach(w => {
        wiresCtx.fillStyle = w.color;
        wiresCtx.beginPath(); wiresCtx.arc(w.x, w.y, 8, 0, Math.PI * 2); wiresCtx.fill();
        if (w.connected && wireState.rightWires[w.targetIdx]) {
            wiresCtx.beginPath();
            wiresCtx.moveTo(w.x, w.y);
            wiresCtx.lineTo(wireState.rightWires[w.targetIdx].x, wireState.rightWires[w.targetIdx].y);
            wiresCtx.strokeStyle = w.color;
            wiresCtx.lineWidth = 5;
            wiresCtx.stroke();
        }
    });

    wireState.rightWires.forEach(w => {
        wiresCtx.fillStyle = w.color;
        wiresCtx.beginPath(); wiresCtx.arc(w.x, w.y, 8, 0, Math.PI * 2); wiresCtx.fill();
    });
}

function onWireMouseDown(e) {
    const rect = wiresCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = wireState.leftWires.find(w => !w.connected && Math.hypot(w.x - mx, w.y - my) < 20);
    if (hit) {
        wireState.activeWire = { startNode: hit, currentX: mx, currentY: my };
    }
}

function onWireMouseMove(e) {
    if (!wireState.activeWire) return;
    const rect = wiresCanvas.getBoundingClientRect();
    wireState.activeWire.currentX = e.clientX - rect.left;
    wireState.activeWire.currentY = e.clientY - rect.top;
    drawWires();
}

function onWireMouseUp(e) {
    if (!wireState.activeWire) return;
    const rect = wiresCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const targetIdx = wireState.rightWires.findIndex(w => Math.hypot(w.x - mx, w.y - my) < 25);
    if (targetIdx !== -1 && wireState.rightWires[targetIdx].color === wireState.activeWire.startNode.color) {
        wireState.activeWire.startNode.connected = true;
        wireState.activeWire.startNode.targetIdx = targetIdx;
    }

    wireState.activeWire = null;
    drawWires();

    // Verification check for complete task execution
    if (wireState.leftWires.every(w => w.connected)) {
        triggerMinigameSuccess();
    }
}

function removeWireListeners() {
    if (!wiresCanvas) return;
    wiresCanvas.removeEventListener('mousedown', onWireMouseDown);
    wiresCanvas.removeEventListener('mousemove', onWireMouseMove);
    window.removeEventListener('mouseup', onWireMouseUp);
}

// --- GAME MODULE 2: CARD SWIPE CALIBRATION MATRIX ---
const cardEl = document.getElementById('swipe-card');
const feedbackEl = document.getElementById('swipe-feedback');

function initSwipeGame() {
    swipeState = { dragging: false, startX: 0, startTime: 0, currentX: 20 };
    cardEl.style.left = '20px';
    feedbackEl.innerText = 'READY TO SWIPE';
    feedbackEl.style.color = '#ffcc00';
    
    cardEl.addEventListener('mousedown', onSwipeStart);
    window.addEventListener('mousemove', onSwipeMove);
    window.addEventListener('mouseup', onSwipeEnd);
}

function onSwipeStart(e) {
    swipeState.dragging = true;
    swipeState.startX = e.clientX - swipeState.currentX;
    swipeState.startTime = Date.now();
}

function onSwipeMove(e) {
    if (!swipeState.dragging) return;
    let targetX = e.clientX - swipeState.startX;
    targetX = Math.max(20, Math.min(320, targetX)); // Container constraint limits
    swipeState.currentX = targetX;
    cardEl.style.left = `${targetX}px`;
}

function onSwipeEnd() {
    if (!swipeState.dragging) return;
    swipeState.dragging = false;

    if (swipeState.currentX >= 310) {
        const timeTaken = Date.now() - swipeState.startTime;
        if (timeTaken < 350) {
            feedbackEl.innerText = '❌ TOO FAST. TRY AGAIN.';
            feedbackEl.style.color = '#ff0055';
            resetCard();
        } else if (timeTaken > 900) {
            feedbackEl.innerText = '❌ TOO SLOW. TRY AGAIN.';
            feedbackEl.style.color = '#ff0055';
            resetCard();
        } else {
            feedbackEl.innerText = '✅ SYSTEM LOCKED AND AUTHORIZED';
            feedbackEl.style.color = '#34C759';
            setTimeout(triggerMinigameSuccess, 600);
        }
    } else {
        feedbackEl.innerText = '❌ INCOMPLETE VELOCITY TRACK';
        feedbackEl.style.color = '#ff0055';
        resetCard();
    }
}

function resetCard() {
    swipeState.currentX = 20;
    cardEl.style.left = '20px';
}

function removeSwipeListeners() {
    if (!cardEl) return;
    cardEl.removeEventListener('mousedown', onSwipeStart);
    window.removeEventListener('mousemove', onSwipeMove);
    window.removeEventListener('mouseup', onSwipeEnd);
}

// --- GAME MODULE 4: LASER REFRACTOR DIVERTER (ENTERTAINING VERSION) ---
let divertAnimId = null;
let divertState = {
    emitter: { x: 20, y: 130 },
    receiver: { x: 420, y: 70, radius: 18, charged: false, chargeTime: 0 },
    mirror: { x: 225, y: 160, radius: 15, dragging: false },
    beamPath: []
};

const divertCanvas = document.getElementById('divert-canvas');
const divertCtx = divertCanvas ? divertCanvas.getContext('2d') : null;
const divertStatus = document.getElementById('divert-status');

function initDivertGame() {
    // Randomize the receiver's target height each time to keep it fresh and fun
    divertState.receiver.y = 50 + Math.random() * 160;
    divertState.receiver.charged = false;
    divertState.receiver.chargeTime = 0;
    
    // Position the mirror slightly offset so the player has to actively align it
    divertState.mirror.x = 200 + Math.random() * 50;
    divertState.mirror.y = 100 + Math.random() * 80;
    divertState.mirror.dragging = false;

    divertStatus.innerText = "ALIGN REFRACTOR NODE";
    divertStatus.style.color = "#ff9500";

    // Mouse and touch bindings for drifting the mirror node
    divertCanvas.addEventListener('mousedown', onDivertMouseDown);
    window.addEventListener('mousemove', onDivertMouseMove);
    window.addEventListener('mouseup', onDivertMouseUp);

    if (divertAnimId) cancelAnimationFrame(divertAnimId);
    divertLoop();
}

function divertLoop() {
    if (divertState.receiver.charged) return;

    calculateLaserPath();
    drawDivertScene();

    // Check if the laser beam has successfully maintained lock inside the receiver zone
    if (checkBeamHit()) {
        divertState.receiver.chargeTime += 16.7; // Increment based on ~60fps step
        const pct = Math.min(100, Math.floor((divertState.receiver.chargeTime / 800) * 100)); // Needs ~0.8s lock
        divertStatus.innerText = `CHARGING GRID... ${pct}%`;
        divertStatus.style.color = "#00f0ff";

        if (divertState.receiver.chargeTime >= 800) {
            divertState.receiver.charged = true;
            divertStatus.innerText = "POWER ROUTED SUCCESSFULLY!";
            divertStatus.style.color = "#34C759";
            setTimeout(triggerMinigameSuccess, 600); // Calls your socket emit to server automatically
            return;
        }
    } else {
        // Slowly decay charge if they slip out of alignment
        divertState.receiver.chargeTime = Math.max(0, divertState.receiver.chargeTime - 10);
        divertStatus.innerText = "ALIGN REFRACTOR NODE";
        divertStatus.style.color = "#ff9500";
    }

    divertAnimId = requestAnimationFrame(divertLoop);
}

function calculateLaserPath() {
    const emit = divertState.emitter;
    const mir = divertState.mirror;
    const rec = divertState.receiver;
    
    divertState.beamPath = [ { x: emit.x, y: emit.y } ];

    // Step 1: Track vector from emitter to mirror node
    let dx = mir.x - emit.x;
    let dy = mir.y - emit.y;
    let distToMirror = Math.hypot(dx, dy);

    // Let's bounce the laser off the mirror using a fun right-angle reflection calculation
    // This creates an entertaining mechanical angle adjustment as you slide up/down/left/right
    divertState.beamPath.push({ x: mir.x, y: mir.y });

    // Calculate bounce trajectory vector pointing over to the receiver wall side
    let bounceDx = rec.x - mir.x;
    // We modify the target y vector path using the displacement orientation of the mirror node
    let bounceDy = (mir.y - emit.y) * 1.5; 
    
    let bounceLength = Math.hypot(bounceDx, bounceDy);
    if (bounceLength > 0) {
        // Project path to edge of screen or hit zone
        divertState.beamPath.push({
            x: mir.x + (bounceDx / bounceLength) * 300,
            y: mir.y + (bounceDy / bounceLength) * 300
        });
    }
}

function checkBeamHit() {
    if (divertState.beamPath.length < 3) return false;
    const endPoint = divertState.beamPath[2];
    const rec = divertState.receiver;
    
    // Check if the projected endpoint passes inside the target core bounding circle
    return Math.hypot(endPoint.x - rec.x, endPoint.y - rec.y) < rec.radius;
}

function drawDivertScene() {
    if (!divertCtx) return;
    divertCtx.clearRect(0, 0, divertCanvas.width, divertCanvas.height);

    // Draw grid background lines
    divertCtx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    divertCtx.lineWidth = 1;
    for (let i = 0; i < divertCanvas.width; i += 25) {
        divertCtx.beginPath(); divertCtx.moveTo(i, 0); divertCtx.lineTo(i, divertCanvas.height); divertCtx.stroke();
    }

    // 1. Draw Target Power Core (Receiver)
    divertCtx.lineWidth = 3;
    divertCtx.strokeStyle = divertState.receiver.chargeTime > 0 ? "#00f0ff" : "#ff3b30";
    divertCtx.fillStyle = divertState.receiver.chargeTime > 0 ? "rgba(0,240,255,0.1)" : "rgba(255,59,48,0.05)";
    divertCtx.shadowBlur = divertState.receiver.chargeTime > 0 ? 10 : 0;
    divertCtx.shadowColor = "#00f0ff";
    divertCtx.beginPath();
    divertCtx.arc(divertState.receiver.x, divertState.receiver.y, divertState.receiver.radius, 0, Math.PI * 2);
    divertCtx.fill();
    divertCtx.stroke();

    // 2. Draw Laser Beam Paths (Bright Neon Glow Effects)
    if (divertState.beamPath.length > 1) {
        divertCtx.lineWidth = 4;
        divertCtx.strokeStyle = "#ff0055";
        divertCtx.shadowBlur = 12;
        divertCtx.shadowColor = "#ff0055";
        divertCtx.beginPath();
        divertCtx.moveTo(divertState.beamPath[0].x, divertState.beamPath[0].y);
        for(let i=1; i<divertState.beamPath.length; i++) {
            divertCtx.lineTo(divertState.beamPath[i].x, divertState.beamPath[i].y);
        }
        divertCtx.stroke();

        // Inner hot-white laser core line
        divertCtx.lineWidth = 1.5;
        divertCtx.strokeStyle = "#ffffff";
        divertCtx.shadowBlur = 0;
        divertCtx.stroke();
    }

    // 3. Draw Interactive Mirror Refractor Node
    const mir = divertState.mirror;
    divertCtx.fillStyle = mir.dragging ? "#00f0ff" : "#5a5e6a";
    divertCtx.strokeStyle = "#ffffff";
    divertCtx.lineWidth = 2;
    divertCtx.beginPath();
    divertCtx.arc(mir.x, mir.y, mir.radius, 0, Math.PI * 2);
    divertCtx.fill();
    divertCtx.stroke();
    
    // Core lens detail inside mirror
    divertCtx.fillStyle = "rgba(255,255,255,0.3)";
    divertCtx.beginPath();
    divertCtx.arc(mir.x, mir.y, 6, 0, Math.PI * 2);
    divertCtx.fill();

    // Reset shadow state configuration changes
    divertCtx.shadowBlur = 0;
}

// Interactivity Handlers
function onDivertMouseDown(e) {
    const rect = divertCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    if (Math.hypot(divertState.mirror.x - mx, divertState.mirror.y - my) < divertState.mirror.radius + 10) {
        divertState.mirror.dragging = true;
    }
}

function onDivertMouseMove(e) {
    if (!divertState.mirror.dragging) return;
    const rect = divertCanvas.getBoundingClientRect();
    
    // Constrain slider nodes within central boundary window fields
    divertState.mirror.x = Math.max(100, Math.min(350, e.clientX - rect.left));
    divertState.mirror.y = Math.max(30, Math.min(230, e.clientY - rect.top));
}

function onDivertMouseUp() {
    divertState.mirror.dragging = false;
}

function removeDivertListeners() {
    if (divertCanvas) divertCanvas.removeEventListener('mousedown', onDivertMouseDown);
    window.removeEventListener('mousemove', onDivertMouseMove);
    window.removeEventListener('mouseup', onDivertMouseUp);
    if (divertAnimId) { cancelAnimationFrame(divertAnimId); divertAnimId = null; }
}

// --- GAME MODULE 3: HOLD DELAY SEQUENCER ---
const holdBtn = document.getElementById('action-hold-btn');
const holdBar = document.getElementById('action-progress-bar');
const holdLabel = document.getElementById('action-progress-label');

function initHoldProgressGame(task) {
    let progress = 0;
    holdBar.style.width = '0%';
    holdLabel.innerText = task.id === 'task_scan' ? 'BIOMETRIC SIGNATURE SCANNING...' : 'UPLINKING TELEMETRY BURST...';
    holdBtn.innerText = 'HOLD TO EXECUTE';

    const onHoldStart = () => {
        if (holdIntervalId) return;
        holdIntervalId = setInterval(() => {
            progress += 4; // Incremental calculation rate
            holdBar.style.width = `${Math.min(100, progress)}%`;
            
            if (progress >= 100) {
                clearInterval(holdIntervalId);
                holdIntervalId = null;
                triggerMinigameSuccess();
            }
        }, 100);
    };

    const onHoldEnd = () => {
        if (holdIntervalId) {
            clearInterval(holdIntervalId);
            holdIntervalId = null;
        }
        progress = 0;
        holdBar.style.width = '0%';
    };

    holdBtn.onmousedown = onHoldStart;
    holdBtn.onmouseup = onHoldEnd;
    holdBtn.onmouseleave = onHoldEnd;
}

// --- GAME MODULE 5: SIDE-SCROLLING PACKET RUNNER ENGINE (EASY MODE) ---
let runnerAnimationId = null;
let runnerState = {
    packet: { 
        y: 130, 
        vy: 0, 
        size: 14, 
        gravity: 0.25, // EASIER: Reduced from 0.4 (falls much slower)
        lift: -5.5     // EASIER: Tuned from -7 (gentler, more controllable jump)
    },
    obstacles: [],
    frame: 0,
    distanceTraveled: 0,
    targetDistance: 1050, // EASIER: Halved from 1200 (takes half the time to complete!)
    gameOver: false,
    inputActive: false
};

const runnerCanvas = document.getElementById('runner-canvas');
const runnerCtx = runnerCanvas ? runnerCanvas.getContext('2d') : null;
const runnerProgressLabel = document.getElementById('runner-progress');
const runnerCrashOverlay = document.getElementById('runner-crash-overlay');
const runnerRetryBtn = document.getElementById('runner-retry-btn');

function initRunnerGame() {
    runnerState.packet.y = 130;
    runnerState.packet.vy = 0;
    runnerState.obstacles = [];
    runnerState.frame = 0;
    runnerState.distanceTraveled = 0;
    runnerState.gameOver = false;
    runnerState.inputActive = false;
    
    runnerCrashOverlay.classList.add('hidden');
    if (runnerProgressLabel) runnerProgressLabel.innerText = '0%';

    window.addEventListener('keydown', onRunnerKeyDown);
    window.addEventListener('keyup', onRunnerKeyUp);
    runnerCanvas.addEventListener('mousedown', onRunnerMouseDown);
    window.addEventListener('mouseup', onRunnerMouseUp);
    runnerRetryBtn.onclick = initRunnerGame;

    if (runnerAnimationId) cancelAnimationFrame(runnerAnimationId);
    runnerGameLoop();
}

function runnerGameLoop() {
    if (runnerState.gameOver) return;

    updateRunnerPhysics();
    drawRunnerScene();

    if (runnerState.distanceTraveled >= runnerState.targetDistance) {
        if (runnerProgressLabel) runnerProgressLabel.innerText = '100%';
        setTimeout(triggerMinigameSuccess, 500); // Triggers standard server task completion tracking
        return;
    }

    runnerAnimationId = requestAnimationFrame(runnerGameLoop);
}

function updateRunnerPhysics() {
    runnerState.frame++;
    runnerState.distanceTraveled += 3;

    const progressPct = Math.min(99, Math.floor((runnerState.distanceTraveled / runnerState.targetDistance) * 100));
    if (runnerProgressLabel) runnerProgressLabel.innerText = `${progressPct}%`;

    const p = runnerState.packet;
    if (runnerState.inputActive) {
        p.vy = p.lift;
    } else {
        p.vy += p.gravity;
    }
    p.y += p.vy;

    if (p.y < 0) { p.y = 0; p.vy = 0; }
    if (p.y > runnerCanvas.height - p.size) { p.y = runnerCanvas.height - p.size; p.vy = 0; }

    // Spawn Obstacles (EASIER: Spawns every 100 frames instead of 75, giving you more breathing room)
    if (runnerState.frame % 100 === 0 && runnerState.distanceTraveled < runnerState.targetDistance - 150) {
        const gapHeight = 110; // EASIER: Widened from 85px to 110px (huge safety clearance gap)
        const minTop = 20;
        const maxTop = runnerCanvas.height - gapHeight - 20;
        const topHeight = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;

        runnerState.obstacles.push({
            x: runnerCanvas.width,
            width: 20, // EASIER: Made walls narrower (20px instead of 25px)
            topHeight: topHeight,
            bottomY: topHeight + gapHeight
        });
    }

    for (let i = runnerState.obstacles.length - 1; i >= 0; i--) {
        const obs = runnerState.obstacles[i];
        obs.x -= 2.8; // EASIER: Slowed down obstacle scroll speed from 3.5 to 2.8

        if (
            30 + p.size > obs.x && 
            30 < obs.x + obs.width && 
            (p.y < obs.topHeight || p.y + p.size > obs.bottomY)
        ) {
            triggerRunnerCrash();
            return;
        }

        if (obs.x + obs.width < 0) {
            runnerState.obstacles.splice(i, 1);
        }
    }
}

function drawRunnerScene() {
    if (!runnerCtx) return;
    runnerCtx.clearRect(0, 0, runnerCanvas.width, runnerCanvas.height);

    runnerCtx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    runnerCtx.lineWidth = 1;
    for (let i = 0; i < runnerCanvas.width; i += 30) {
        runnerCtx.beginPath(); runnerCtx.moveTo(i, 0); runnerCtx.lineTo(i, runnerCanvas.height); runnerCtx.stroke();
    }
    for (let i = 0; i < runnerCanvas.height; i += 30) {
        runnerCtx.beginPath(); runnerCtx.moveTo(0, i); runnerCtx.lineTo(runnerCanvas.width, i); runnerCtx.stroke();
    }

    runnerCtx.fillStyle = '#ff0055';
    runnerCtx.shadowBlur = 4;
    runnerCtx.shadowColor = '#ff0055';
    runnerState.obstacles.forEach(obs => {
        runnerCtx.fillRect(obs.x, 0, obs.width, obs.topHeight);
        runnerCtx.fillRect(obs.x, obs.bottomY, obs.width, runnerCanvas.height - obs.bottomY);
    });

    runnerCtx.fillStyle = '#00f0ff';
    runnerCtx.shadowBlur = 8;
    runnerCtx.shadowColor = '#00f0ff';
    runnerCtx.fillRect(30, runnerState.packet.y, runnerState.packet.size, runnerState.packet.size);
    
    runnerCtx.shadowBlur = 0;
}

function triggerRunnerCrash() {
    runnerState.gameOver = true;
    if (runnerAnimationId) cancelAnimationFrame(runnerAnimationId);
    runnerCrashOverlay.classList.remove('hidden');
}

function onRunnerKeyDown(e) { if (e.code === 'Space') { e.preventDefault(); runnerState.inputActive = true; } }
function onRunnerKeyUp(e) { if (e.code === 'Space') runnerState.inputActive = false; }
function onRunnerMouseDown(e) { runnerState.inputActive = true; }
function onRunnerMouseUp(e) { runnerState.inputActive = false; }

function removeRunnerListeners() {
    window.removeEventListener('keydown', onRunnerKeyDown);
    window.removeEventListener('keyup', onRunnerKeyUp);
    if (runnerCanvas) runnerCanvas.removeEventListener('mousedown', onRunnerMouseDown);
    window.removeEventListener('mouseup', onRunnerMouseUp);
    if (runnerAnimationId) { cancelAnimationFrame(runnerAnimationId); runnerAnimationId = null; }
}

// Chat during meetings
sendChatBtn.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (text) {
        socket.emit('send_meeting_msg', text);
        chatInput.value = '';
    }
});
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatBtn.click();
});

socket.on('receive_meeting_msg', (payload) => {
    const entry = document.createElement('div');
    entry.style.cssText = 'margin-bottom:4px; font-size:12px;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `font-weight:600; color:${payload.color || '#5ac8fa'};`;
    nameSpan.innerText = payload.sender + ': ';
    const textSpan = document.createElement('span');
    textSpan.style.color = payload.isAlive ? '#e8eaed' : '#ff3b30';
    textSpan.innerText = payload.text;
    entry.appendChild(nameSpan);
    entry.appendChild(textSpan);
    chatWindow.appendChild(entry);
    chatWindow.scrollTop = chatWindow.scrollHeight;
});

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ===================== NETWORKING HANDLERS =====================
hostBtn.addEventListener('click', () => {
    if(usernameIn.value.trim()) socket.emit('host_room', usernameIn.value);
});
joinBtn.addEventListener('click', () => {
    if(usernameIn.value.trim() && codeIn.value.trim()) {
        socket.emit('join_room', { username: usernameIn.value, roomCode: codeIn.value });
    }
});
startBtn.addEventListener('click', () => socket.emit('start_match'));

socket.on('connection_acknowledged', (data) => {
    myId = data.myId;
    roomCodeDisplay.innerText = `◆ Room: ${data.roomCode}`;
    setupPanel.classList.add('hidden');
    canvasWrapper.classList.remove('hidden');
    if (data.isHost) {
        startBtn.classList.remove('hidden');
    }
    init3DEngine();
    animate();
});

socket.on('identity_assignment', (data) => {
    myRole = data.role;
    myTasks = data.tasks || [];
    amInVent = false;
    roleBadge.innerText = `◈ ${myRole}`;
    roleBadge.style.color = (myRole === 'IMPOSTOR') ? '#FF3B30' : '#34C759';
    updateTaskUI();
});

socket.on('state_snapshot', (snapshot) => {
    if (currentGameState === 'MEETING') return;
    currentGameState = snapshot.gameState;
    worldActivePlayers = snapshot.players;
    deadBodies = snapshot.deadBodies || [];
    sabotageActive = snapshot.sabotageActive;
    // If we reappeared in snapshot, we're no longer in a vent
    if (worldActivePlayers[myId]) {
        amInVent = false;
    }
    updateCrewStatus();
});

socket.on('match_begun', () => {
    currentGameState = 'INGAME';
    amInVent = false;
    showToast('⚡ Match Started!', 2500);
});

socket.on('meeting_started', (data) => {
    currentGameState = 'MEETING';
    amInVent = false;
    meetingOverlay.classList.remove('hidden');
    meetingBanner.innerText = '⚖ Emergency Meeting';
    if (meetingReason) meetingReason.innerText = data.reason || 'A body was reported!';
    if (meetingResult) meetingResult.classList.add('hidden');
    showToast('🔔 Emergency Meeting!', 3000);
    // Start meeting timer countdown
    let timeLeft = 30;
    if (meetingTimer) {
        meetingTimer.innerText = timeLeft;
        meetingTimer.classList.remove('urgent');
    }
    if (window._meetingTimerInterval) clearInterval(window._meetingTimerInterval);
    window._meetingTimerInterval = setInterval(() => {
        timeLeft--;
        if (meetingTimer) {
            meetingTimer.innerText = timeLeft;
            if (timeLeft <= 5) meetingTimer.classList.add('urgent');
        }
        if (timeLeft <= 0) { clearInterval(window._meetingTimerInterval); window._meetingTimerInterval = null; }
    }, 1000);
    // Clear timer on resume
    const clearTimer = () => {
        if (window._meetingTimerInterval) {
            clearInterval(window._meetingTimerInterval);
            window._meetingTimerInterval = null;
        }
        socket.off('resume_game', clearTimer);
    };
    socket.on('resume_game', clearTimer);
    // Populate voting grid (only if the local player is alive)
    const grid = votingGrid;
    grid.innerHTML = '';
    const localPlayer = worldActivePlayers[myId];
    const isLocalDead = !localPlayer || !localPlayer.isAlive;

    if (isLocalDead) {
        grid.innerHTML = '<div style="color:#ff3b30; font-size:14px; padding:20px;">☠ DECEASED — VOTING PRIVILEGES REVOKED</div>';
        if (skipVoteBtn) skipVoteBtn.disabled = true;
    } else {
        if (skipVoteBtn) skipVoteBtn.disabled = false;
        const players = data.players ? Object.values(data.players) : Object.values(worldActivePlayers);
        players.filter(p => p.isAlive).forEach(p => {
            const btn = document.createElement('button');
            btn.innerText = p.username;
            btn.style.cssText = `border-left: 3px solid ${p.color};`;
            btn.addEventListener('click', () => {
                socket.emit('cast_vote', p.id);
                showToast(`Voted for ${p.username}`, 2000);
                grid.querySelectorAll('button').forEach(b => { b.classList.remove('voted'); b.style.opacity = '0.4'; });
                btn.classList.add('voted');
                btn.style.opacity = '1';
            });
            grid.appendChild(btn);
        });
    }
});

if (skipVoteBtn) skipVoteBtn.addEventListener('click', () => {
    const localPlayer = worldActivePlayers[myId];
    if (!localPlayer || !localPlayer.isAlive) {
        showToast('☠ Deceased crewmates cannot vote.', 2000);
        return;
    }
    socket.emit('cast_vote', 'skip');
    showToast('Skipped vote', 2000);
    if (votingGrid) votingGrid.querySelectorAll('button').forEach(b => { b.classList.remove('voted'); b.style.opacity = '0.4'; });
});
socket.on('resume_game', () => {
    meetingOverlay.classList.add('hidden');
    currentGameState = 'INGAME';
    amInVent = false;
    showToast('▶ Game Resumed', 2000);
});

socket.on('meeting_concluded', (data) => {
    if (data.log) {
        showToast(data.log, 4000);
        if (meetingResult) {
            meetingResult.classList.remove('hidden');
            meetingResult.innerText = data.log;
        }
    }
});

socket.on('match_ended', (data) => {
    showToast(data.message || 'Game Over!', 5000);
});

socket.on('kill_confirmed', () => {
    showToast('☠ A crewmate was killed!', 3000);
});

socket.on('sabotage_triggered', (data) => {
    if (data.type === 'LIGHTS') {
        sabotageActive = true;
        if (sabotageIndicator) sabotageIndicator.classList.add('active');
        showToast('⚠ Lights sabotaged! Fix the console in Electrical!', 4000);
        // Trigger minimap alert
        triggerShipwideAlert('reactor', 'critical');
    }
});

socket.on('sabotage_resolved', () => {
    sabotageActive = false;
    if (sabotageIndicator) sabotageIndicator.classList.remove('active');
    showToast('✅ Sabotage resolved!', 2500);
    triggerShipwideAlert('reactor', 'nominal');
});

socket.on('task_updated', (tasks) => {
    myTasks = tasks;
    updateTaskUI();
});

socket.on('global_progress_updated', (data) => {
    if (data.required > 0) {
        const pct = Math.round((data.completed / data.required) * 100);
        progressBar.style.width = `${pct}%`;
        if (progressText) progressText.innerText = `${pct}%`;
    }
});

socket.on('network_error', (msg) => {
    showToast(`❌ ${msg}`, 3000);
});

socket.on('vent_status', (data) => {
    amInVent = data.inVent;
    showToast(data.inVent ? '🌀 In vent — press E to exit' : '🌀 Exited vent', 1500);
});

socket.on('player_voted', (data) => {
    const voter = worldActivePlayers[data.voterId];
    if (voter) showToast(`🗳 ${voter.username} voted`, 1500);
});

function updateCrewStatus() {
    const list = document.getElementById('player-status-list');
    if (!list) return;
    list.innerHTML = '';
    const players = Object.values(worldActivePlayers);
    if (players.length === 0) {
        list.innerHTML = '<div style="color:#5a5e6a; font-size:11px;">Waiting for crew...</div>';
        return;
    }
    players.forEach(p => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 0;';
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px; height:8px; border-radius:50%; background:${p.color}; display:inline-block; flex-shrink:0;`;
        const name = document.createElement('span');
        name.innerText = p.username;
        name.style.cssText = `font-size:12px; color:${p.isAlive ? '#e8eaed' : '#ff3b30'}; ${!p.isAlive ? 'text-decoration:line-through;' : ''}`;
        row.appendChild(dot);
        row.appendChild(name);
        if (p.id === myId) {
            const badge = document.createElement('span');
            badge.innerText = 'YOU';
            badge.style.cssText = 'font-size:9px; background:#007AFF; color:#fff; border-radius:4px; padding:1px 5px; margin-left:auto;';
            row.appendChild(badge);
        }
        list.appendChild(row);
    });
}

function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = 'background:rgba(21,24,33,0.92); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.1); padding:10px 22px; border-radius:10px; color:#fff; font-size:13px; margin-bottom:6px; transition:opacity 0.3s, transform 0.3s; box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function updateTaskUI() {
    taskListElement.innerHTML = '';
    myTasks.forEach(t => {
        const item = document.createElement('li');
        item.innerText = `• ${t.name} (${t.room})`;
        item.style.color = t.completed ? '#34C759' : '#ffcc00';
        taskListElement.appendChild(item);
    });
}