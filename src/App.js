import { useState, useEffect, useRef, useCallback } from “react”;

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const GRID_COLS = 22;
const GRID_ROWS = 16;
const HEX_SIZE = 32;
const TURN_LIMIT = 80;
const MINERAL_QUOTA = 500;
const MORALE_COLLAPSE = 0.80;

const TERRAIN = {
SOLID:   { id:“SOLID”,   label:“Solid Ground”,  color:”#2a3a1a”, move:1, def:0,   mineral:0,  fog:false },
MUD:     { id:“MUD”,     label:“Deep Mud”,       color:”#3d2e1a”, move:2, def:-1,  mineral:0,  fog:true  },
TRENCH:  { id:“TRENCH”,  label:“Trench”,         color:”#1a2010”, move:1, def:2,   mineral:0,  fog:false },
HIGH:    { id:“HIGH”,    label:“High Ground”,    color:”#1e3a10”, move:2, def:2,   mineral:0,  fog:false, vis:2 },
MINERAL: { id:“MINERAL”, label:“Mineral Vein”,   color:”#1a2e3a”, move:1, def:0,   mineral:5,  fog:false },
SLUDGE:  { id:“SLUDGE”,  label:“Deep Sludge”,    color:”#251808”, move:4, def:-2,  mineral:0,  fog:true  },
BUNKER:  { id:“BUNKER”,  label:“Bunker”,         color:”#0d1a08”, move:1, def:4,   mineral:0,  fog:false },
WATER:   { id:“WATER”,   label:“Flooded”,        color:”#0a1520”, move:999,def:-3, mineral:0,  fog:false },
};

const UNIT_TYPES = {
STORMTROOPER: { id:“STORMTROOPER”, label:“Stormtrooper”, hp:3,  atk:2, rng:2, mov:3, cost:10, icon:“◈”, color:”#c8d8e8” },
MUDTROOPER:   { id:“MUDTROOPER”,   label:“Mudtrooper”,   hp:4,  atk:2, rng:2, mov:2, cost:8,  icon:“⬟”, color:”#7a6a4a” },
WALKER:       { id:“WALKER”,       label:“AT-ST Walker”, hp:8,  atk:4, rng:3, mov:2, cost:30, icon:“⬡”, color:”#8a9a7a” },
HARVESTER:    { id:“HARVESTER”,    label:“Harvester”,    hp:3,  atk:0, rng:0, mov:1, cost:20, icon:“◎”, color:”#4a7a8a” },
SAPPER:       { id:“SAPPER”,       label:“Sapper”,       hp:2,  atk:3, rng:1, mov:2, cost:15, icon:“⬢”, color:”#8a6a3a” },
SNIPER:       { id:“SNIPER”,       label:“Sniper”,       hp:2,  atk:4, rng:5, mov:2, cost:18, icon:“◇”, color:”#6a8a6a” },
MLA_INFANTRY: { id:“MLA_INFANTRY”, label:“MLA Infantry”, hp:3,  atk:2, rng:2, mov:2, cost:0,  icon:“✦”, color:”#8a3a3a” },
MLA_HUNTER:   { id:“MLA_HUNTER”,  label:“MLA Hunter”,   hp:4,  atk:3, rng:2, mov:3, cost:0,  icon:“✧”, color:”#6a2a2a” },
};

// ─── UTILITY ─────────────────────────────────────────────────────────────────
const hexToPixel = (q, r) => {
const x = HEX_SIZE * (3/2 * q);
const y = HEX_SIZE * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
return { x: x + HEX_SIZE * 2, y: y + HEX_SIZE * 1.5 };
};

const hexNeighbors = (q, r) => [
[q+1,r],[q-1,r],[q,r+1],[q,r-1],[q+1,r-1],[q-1,r+1]
];

const hexDistance = (q1,r1,q2,r2) => {
return (Math.abs(q1-q2) + Math.abs(q1+r1-q2-r2) + Math.abs(r1-r2)) / 2;
};

const hexInRange = (q, r, range) => {
const results = [];
for (let dq = -range; dq <= range; dq++) {
for (let dr = Math.max(-range,-dq-range); dr <= Math.min(range,-dq+range); dr++) {
results.push([q+dq, r+dr]);
}
}
return results;
};

const hexKey = (q, r) => `${q},${r}`;

// ─── MAP GENERATION ───────────────────────────────────────────────────────────
const generateMap = () => {
const hexes = {};
const terrainDist = [
…Array(35).fill(“SOLID”),
…Array(25).fill(“MUD”),
…Array(10).fill(“HIGH”),
…Array(10).fill(“MINERAL”),
…Array(8).fill(“TRENCH”),
…Array(7).fill(“SLUDGE”),
…Array(5).fill(“WATER”),
];
for (let q = 0; q < GRID_COLS; q++) {
for (let r = 0; r < GRID_ROWS; r++) {
const noise = Math.sin(q * 0.7 + r * 1.3) * Math.cos(q * 0.4 - r * 0.9);
const idx = Math.abs(Math.floor((noise + 1) / 2 * terrainDist.length)) % terrainDist.length;
const terrain = terrainDist[idx];
hexes[hexKey(q, r)] = {
q, r,
terrain: TERRAIN[terrain],
terrainId: terrain,
owner: null,
unit: null,
fog: true,
fogOpacity: 1.0,
};
}
}
// Force landing zone
[[-1,0],[0,0],[1,0],[0,1],[-1,1]].forEach(([dq,dr]) => {
const k = hexKey(dq+1, dr+4);
if (hexes[k]) { hexes[k].terrainId = “SOLID”; hexes[k].terrain = TERRAIN.SOLID; hexes[k].owner = “imperial”; }
});
// Force mineral veins
[[10,5],[12,7],[8,8],[14,4],[15,9]].forEach(([q,r]) => {
const k = hexKey(q,r);
if (hexes[k]) { hexes[k].terrainId = “MINERAL”; hexes[k].terrain = TERRAIN.MINERAL; }
});
// Enemy base area
[[20,5],[20,6],[20,7],[19,6],[21,6]].forEach(([q,r]) => {
const k = hexKey(q,r);
if (hexes[k]) { hexes[k].owner = “mla”; hexes[k].terrainId = “BUNKER”; hexes[k].terrain = TERRAIN.BUNKER; }
});
return hexes;
};

const generateInitialUnits = (hexes) => {
const units = {};
let uid = 1;
// Imperial units
const imperialStarts = [[1,4],[2,4],[1,5],[2,5],[3,4]];
imperialStarts.forEach(([q,r], i) => {
const type = i < 3 ? UNIT_TYPES.MUDTROOPER : (i===3 ? UNIT_TYPES.HARVESTER : UNIT_TYPES.STORMTROOPER);
const id = `u${uid++}`;
units[id] = { id, type, q, r, hp: type.hp, maxHp: type.hp, faction: “imperial”, moved: false, attacked: false };
const k = hexKey(q,r);
if (hexes[k]) hexes[k].unit = id;
});
// MLA units
[[19,5],[20,8],[18,7],[21,5],[19,9]].forEach(([q,r]) => {
const type = Math.random() > 0.5 ? UNIT_TYPES.MLA_INFANTRY : UNIT_TYPES.MLA_HUNTER;
const id = `u${uid++}`;
units[id] = { id, type, q, r, hp: type.hp, maxHp: type.hp, faction: “mla”, moved: false, attacked: false };
const k = hexKey(q,r);
if (hexes[k]) hexes[k].unit = id;
});
return units;
};

// ─── FOG OF WAR ───────────────────────────────────────────────────────────────
const computeVisibility = (hexes, units) => {
const visible = new Set();
Object.values(units).forEach(u => {
if (u.faction !== “imperial” || u.hp <= 0) return;
const terrain = hexes[hexKey(u.q, u.r)]?.terrain;
const visRange = (u.type.rng || 2) + (terrain?.vis || 0);
hexInRange(u.q, u.r, visRange).forEach(([q,r]) => {
if (q >= 0 && q < GRID_COLS && r >= 0 && r < GRID_ROWS) visible.add(hexKey(q,r));
});
});
return visible;
};

// ─── MAIN GAME COMPONENT ──────────────────────────────────────────────────────
export default function MimbanGame() {
const canvasRef = useRef(null);
const animRef = useRef(null);
const fogAnimRef = useRef({ time: 0 });
const [hexes, setHexes] = useState(() => generateMap());
const [units, setUnits] = useState(() => generateInitialUnits(generateMap()));
const [selectedUnit, setSelectedUnit] = useState(null);
const [validMoves, setValidMoves] = useState(new Set());
const [validAttacks, setValidAttacks] = useState(new Set());
const [turn, setTurn] = useState(1);
const [phase, setPhase] = useState(“imperial”); // imperial | mla
const [credits, setCredits] = useState(120);
const [creditsPerTurn, setCreditsPerTurn] = useState(15);
const [minerals, setMinerals] = useState(0);
const [casualties, setCasualties] = useState(0);
const [totalDeployed, setTotalDeployed] = useState(5);
const [mutinyMeter, setMutinyMeter] = useState(0);
const [deployQueue, setDeployQueue] = useState(null);
const [gameState, setGameState] = useState(“playing”); // playing | won | lost
const [winReason, setWinReason] = useState(””);
const [lossReason, setLossReason] = useState(””);
const [log, setLog] = useState([“⚡ SECTOR COMMAND INITIALIZED”,“⚡ Mission: Extract Hyperbaride”,“⚡ Enemy resistance detected”]);
const [hovered, setHovered] = useState(null);
const [visibility, setVisibility] = useState(new Set());
const [flashMsg, setFlashMsg] = useState(””);
const [scanLineOff, setScanLineOff] = useState(false);

const addLog = useCallback((msg) => {
setLog(prev => [`[T${turn}] ${msg}`, …prev.slice(0,19)]);
}, [turn]);

const flash = useCallback((msg) => {
setFlashMsg(msg);
setTimeout(() => setFlashMsg(””), 2500);
}, []);

// ── Recompute visibility ──
useEffect(() => {
setVisibility(computeVisibility(hexes, units));
}, [units, hexes]);

// ── Canvas render ──
useEffect(() => {
const canvas = canvasRef.current;
if (!canvas) return;
const ctx = canvas.getContext(“2d”);
fogAnimRef.current.time += 0.01;
const t = fogAnimRef.current.time;

```
ctx.clearRect(0, 0, canvas.width, canvas.height);

// Draw hexes
Object.values(hexes).forEach(hex => {
  const { q, r, terrain, owner, unit: unitId, terrainId } = hex;
  const { x, y } = hexToPixel(q, r);
  const isVis = visibility.has(hexKey(q,r));
  const isHov = hovered === hexKey(q,r);
  const isMoveTarget = validMoves.has(hexKey(q,r));
  const isAttackTarget = validAttacks.has(hexKey(q,r));

  // Hex path
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    const px = x + HEX_SIZE * 0.95 * Math.cos(angle);
    const py = y + HEX_SIZE * 0.95 * Math.sin(angle);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();

  // Fill
  if (!isVis) {
    // Fog of war with animated noise
    const fogVal = 0.3 + 0.15 * Math.sin(t * 0.8 + q * 0.4 + r * 0.6);
    ctx.fillStyle = `rgba(8,12,6,${0.85 + fogVal * 0.1})`;
    ctx.fill();
    ctx.strokeStyle = "#0a120a";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Rolling fog wisps
    const wispX = x + 8 * Math.sin(t + q);
    const wispY = y + 5 * Math.cos(t * 0.7 + r);
    ctx.fillStyle = `rgba(30,50,20,${0.15 + 0.1 * Math.sin(t*1.2 + q*0.5)})`;
    ctx.beginPath();
    ctx.arc(wispX, wispY, 8 + 4*Math.sin(t+r), 0, Math.PI*2);
    ctx.fill();
    return;
  }

  ctx.fillStyle = terrain.color;
  ctx.fill();

  // Owner tint
  if (owner === "imperial") {
    ctx.fillStyle = "rgba(50,120,180,0.18)";
    ctx.fill();
  } else if (owner === "mla") {
    ctx.fillStyle = "rgba(180,50,50,0.18)";
    ctx.fill();
  }

  // Mineral shimmer
  if (terrainId === "MINERAL") {
    const shim = 0.3 + 0.2 * Math.sin(t * 2 + q + r);
    ctx.fillStyle = `rgba(0,200,255,${shim * 0.3})`;
    ctx.fill();
  }

  // Stroke
  ctx.strokeStyle = isHov ? "#4aff4a" : isAttackTarget ? "#ff4444" : isMoveTarget ? "#44ff88" : "#1a2a10";
  ctx.lineWidth = isHov ? 2 : isMoveTarget || isAttackTarget ? 1.5 : 0.8;
  ctx.stroke();

  // Move/attack overlays
  if (isMoveTarget) {
    ctx.fillStyle = "rgba(68,255,136,0.15)";
    ctx.fill();
  }
  if (isAttackTarget) {
    ctx.fillStyle = "rgba(255,68,68,0.2)";
    ctx.fill();
  }

  // Terrain icon
  ctx.fillStyle = isVis ? "rgba(180,220,160,0.6)" : "transparent";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (terrainId === "MINERAL") ctx.fillText("⬡", x, y+14);
  else if (terrainId === "HIGH") ctx.fillText("▲", x, y+14);
  else if (terrainId === "TRENCH") ctx.fillText("≡", x, y+14);
  else if (terrainId === "BUNKER") ctx.fillText("⬛", x, y+14);
  else if (terrainId === "SLUDGE") ctx.fillText("~", x, y+14);
  else if (terrainId === "WATER") ctx.fillText("≋", x, y+14);
});

// Draw units
Object.values(units).forEach(u => {
  if (u.hp <= 0) return;
  const k = hexKey(u.q, u.r);
  if (!visibility.has(k) && u.faction === "mla") return;
  const { x, y } = hexToPixel(u.q, u.r);
  const isSelected = selectedUnit?.id === u.id;
  const isImperial = u.faction === "imperial";

  // Unit circle
  ctx.beginPath();
  ctx.arc(x, y-2, 11, 0, Math.PI*2);
  ctx.fillStyle = isImperial
    ? (isSelected ? "#4af" : (u.moved ? "#334" : "#18283a"))
    : "#2a0808";
  ctx.fill();
  ctx.strokeStyle = isImperial
    ? (isSelected ? "#44aaff" : (u.moved ? "#2244aa" : "#3388cc"))
    : "#cc4444";
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  // HP bar
  const hpPct = u.hp / u.maxHp;
  ctx.fillStyle = "#111";
  ctx.fillRect(x-10, y+8, 20, 3);
  ctx.fillStyle = hpPct > 0.6 ? "#4af84a" : hpPct > 0.3 ? "#f8a44a" : "#f84a4a";
  ctx.fillRect(x-10, y+8, 20*hpPct, 3);

  // Icon
  ctx.fillStyle = isImperial ? u.type.color : "#cc8888";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(u.type.icon, x, y-2);

  // Selected ring
  if (isSelected) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.beginPath();
    ctx.arc(x, y-2, 13 + pulse*2, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(68,170,255,${0.6+pulse*0.4})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
});

animRef.current = requestAnimationFrame(() => {
  setHovered(h => h); // trigger re-render for animation
});
```

}, [hexes, units, selectedUnit, validMoves, validAttacks, hovered, visibility]);

// Cleanup
useEffect(() => () => cancelAnimationFrame(animRef.current), []);

// ── Hex click handler ──
const handleCanvasClick = useCallback((e) => {
if (gameState !== “playing” || phase !== “imperial”) return;
const canvas = canvasRef.current;
const rect = canvas.getBoundingClientRect();
const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
const my = (e.clientY - rect.top) * (canvas.height / rect.height);

```
// Find closest hex
let closest = null, minDist = 999;
Object.values(hexes).forEach(hex => {
  const { x, y } = hexToPixel(hex.q, hex.r);
  const d = Math.hypot(mx-x, my-y);
  if (d < minDist) { minDist = d; closest = hex; }
});
if (!closest || minDist > HEX_SIZE) return;
const k = hexKey(closest.q, closest.r);

// Deploy mode
if (deployQueue) {
  if (closest.terrainId === "WATER" || closest.terrainId === "SLUDGE") { flash("⚠ Cannot deploy on impassable terrain"); return; }
  if (hexes[k].unit) { flash("⚠ Hex occupied"); return; }
  if (!["SOLID","TRENCH"].includes(closest.terrainId) && closest.q > 4) { flash("⚠ Deploy in friendly zone only"); return; }
  const type = UNIT_TYPES[deployQueue];
  if (credits < type.cost) { flash("⚠ Insufficient credits"); return; }
  const id = `u${Date.now()}`;
  const newUnit = { id, type, q: closest.q, r: closest.r, hp: type.hp, maxHp: type.hp, faction: "imperial", moved: true, attacked: true };
  setUnits(prev => ({ ...prev, [id]: newUnit }));
  setHexes(prev => { const n={...prev}; n[k]={...n[k],unit:id,owner:"imperial"}; return n; });
  setCredits(c => c - type.cost);
  setTotalDeployed(t => t + 1);
  setDeployQueue(null);
  addLog(`Deployed ${type.label} at (${closest.q},${closest.r})`);
  return;
}

// Select or move/attack
if (validMoves.has(k)) {
  // Move
  const unit = units[selectedUnit.id];
  const oldK = hexKey(unit.q, unit.r);
  setHexes(prev => {
    const n = {...prev};
    n[oldK] = {...n[oldK], unit: null};
    n[k] = {...n[k], unit: unit.id, owner: "imperial"};
    return n;
  });
  setUnits(prev => ({...prev, [unit.id]: {...unit, q: closest.q, r: closest.r, moved: true}}));
  setValidMoves(new Set());
  setValidAttacks(new Set());
  setSelectedUnit(prev => ({...prev, q: closest.q, r: closest.r, moved: true}));
  addLog(`${unit.type.label} moved to (${closest.q},${closest.r})`);
  // Harvest minerals
  if (closest.terrainId === "MINERAL") {
    setMinerals(m => Math.min(m + closest.terrain.mineral, MINERAL_QUOTA));
    addLog(`⬡ Hyperbaride extracted: +${closest.terrain.mineral}`);
  }
  return;
}

if (validAttacks.has(k)) {
  // Attack
  const attacker = units[selectedUnit.id];
  const targetId = hexes[k].unit;
  if (!targetId) return;
  const target = units[targetId];
  const dmg = Math.max(1, attacker.type.atk + (hexes[hexKey(attacker.q,attacker.r)]?.terrainId === "HIGH" ? 1 : 0));
  const newHp = Math.max(0, target.hp - dmg);
  setUnits(prev => ({
    ...prev,
    [attacker.id]: {...attacker, attacked: true, moved: true},
    [targetId]: {...target, hp: newHp}
  }));
  if (newHp === 0) {
    setHexes(prev => { const n={...prev}; n[k]={...n[k],unit:null}; return n; });
    addLog(`💀 ${target.type.label} eliminated at (${target.q},${target.r})`);
  } else {
    addLog(`⚔ ${attacker.type.label} attacks for ${dmg} dmg`);
  }
  setValidMoves(new Set());
  setValidAttacks(new Set());
  setSelectedUnit(null);
  return;
}

// Select unit
if (hexes[k]?.unit) {
  const uid = hexes[k].unit;
  const unit = units[uid];
  if (unit.faction !== "imperial") { flash("⚠ Enemy unit — select attack target"); return; }
  if (unit.hp <= 0) return;
  setSelectedUnit(unit);
  // Compute moves
  if (!unit.moved) {
    const moves = new Set();
    const movCost = unit.type.mov;
    hexInRange(unit.q, unit.r, movCost).forEach(([q,r]) => {
      const mk = hexKey(q,r);
      if (!hexes[mk]) return;
      const t = hexes[mk].terrain;
      if (t.move > movCost) return;
      if (!hexes[mk].unit) moves.add(mk);
    });
    setValidMoves(moves);
  }
  if (!unit.attacked) {
    const atks = new Set();
    hexInRange(unit.q, unit.r, unit.type.rng).forEach(([q,r]) => {
      const ak = hexKey(q,r);
      if (!hexes[ak]) return;
      if (hexes[ak].unit && units[hexes[ak].unit]?.faction === "mla") atks.add(ak);
    });
    setValidAttacks(atks);
  }
  addLog(`Selected ${unit.type.label} (HP:${unit.hp}/${unit.maxHp})`);
} else {
  setSelectedUnit(null);
  setValidMoves(new Set());
  setValidAttacks(new Set());
}
```

}, [hexes, units, selectedUnit, validMoves, validAttacks, phase, gameState, deployQueue, credits, addLog, flash, turn]);

const handleCanvasMouseMove = useCallback((e) => {
const canvas = canvasRef.current;
if (!canvas) return;
const rect = canvas.getBoundingClientRect();
const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
const my = (e.clientY - rect.top) * (canvas.height / rect.height);
let closest = null, minDist = 999;
Object.values(hexes).forEach(hex => {
const { x, y } = hexToPixel(hex.q, hex.r);
const d = Math.hypot(mx-x, my-y);
if (d < minDist) { minDist = d; closest = hex; }
});
setHovered(closest && minDist < HEX_SIZE ? hexKey(closest.q, closest.r) : null);
}, [hexes]);

// ── MLA AI Turn ──
const runMLATurn = useCallback(() => {
setUnits(prev => {
const next = { …prev };
const hexesCopy = { …hexes };
Object.values(next).forEach(u => {
if (u.faction !== “mla” || u.hp <= 0) return;
// Find nearest imperial unit
let nearest = null, nearDist = 999;
Object.values(next).forEach(t => {
if (t.faction === “imperial” && t.hp > 0) {
const d = hexDistance(u.q, u.r, t.q, t.r);
if (d < nearDist) { nearDist = d; nearest = t; }
}
});
if (!nearest) return;
// Attack if in range
if (nearDist <= u.type.rng) {
const dmg = Math.max(1, u.type.atk);
const newHp = Math.max(0, nearest.hp - dmg);
next[nearest.id] = { …nearest, hp: newHp };
if (newHp === 0) {
hexesCopy[hexKey(nearest.q, nearest.r)] = { …hexesCopy[hexKey(nearest.q, nearest.r)], unit: null };
setCasualties(c => c + 1);
}
return;
}
// Move toward nearest
const neighbors = hexNeighbors(u.q, u.r)
.filter(([q,r]) => q>=0&&q<GRID_COLS&&r>=0&&r<GRID_ROWS)
.filter(([q,r]) => !hexesCopy[hexKey(q,r)]?.unit)
.filter(([q,r]) => hexesCopy[hexKey(q,r)]?.terrain.move < 3);
if (!neighbors.length) return;
const [nq, nr] = neighbors.reduce((best, cur) => {
return hexDistance(cur[0],cur[1],nearest.q,nearest.r) < hexDistance(best[0],best[1],nearest.q,nearest.r) ? cur : best;
});
hexesCopy[hexKey(u.q, u.r)] = { …hexesCopy[hexKey(u.q, u.r)], unit: null };
hexesCopy[hexKey(nq, nr)] = { …hexesCopy[hexKey(nq, nr)], unit: u.id };
next[u.id] = { …u, q: nq, r: nr };
});
setHexes(hexesCopy);
return next;
});
}, [hexes]);

// ── End Turn ──
const endTurn = useCallback(() => {
if (gameState !== “playing”) return;
// Check win conditions
if (minerals >= MINERAL_QUOTA) { setGameState(“won”); setWinReason(“MINERAL QUOTA REACHED”); return; }
const imperialHexes = Object.values(hexes).filter(h => h.owner === “imperial”).length;
const totalHexes = GRID_COLS * GRID_ROWS;
if (imperialHexes / totalHexes >= 0.75) { setGameState(“won”); setWinReason(“SECTOR PACIFICATION”); return; }
// Check loss
const rate = totalDeployed > 0 ? casualties / totalDeployed : 0;
const newMutiny = Math.max(0, Math.min(1, rate));
setMutinyMeter(newMutiny);
if (rate >= MORALE_COLLAPSE) { setGameState(“lost”); setLossReason(“MORALE COLLAPSE — MUTINY”); return; }
if (turn >= TURN_LIMIT) { setGameState(“lost”); setLossReason(“TURN LIMIT EXCEEDED — COMMAND RELIEVED”); return; }
if (credits <= 0 && creditsPerTurn === 0) { setGameState(“lost”); setLossReason(“LOGISTICAL COLLAPSE”); return; }

```
// MLA spawns
if (turn % 5 === 0) {
  setUnits(prev => {
    const next = { ...prev };
    const spawnHexes = [[20,5],[20,7],[19,6],[21,7]];
    spawnHexes.forEach(([q,r]) => {
      const k = hexKey(q,r);
      if (!hexes[k]?.unit && Math.random() > 0.4) {
        const id = `mla${Date.now()}${q}${r}`;
        const type = Math.random() > 0.5 ? UNIT_TYPES.MLA_INFANTRY : UNIT_TYPES.MLA_HUNTER;
        next[id] = { id, type, q, r, hp: type.hp, maxHp: type.hp, faction: "mla", moved: false, attacked: false };
        setHexes(prev2 => { const n={...prev2}; if(n[k]) n[k]={...n[k],unit:id}; return n; });
      }
    });
    return next;
  });
}

runMLATurn();
// Reset unit actions
setUnits(prev => {
  const n = {...prev};
  Object.keys(n).forEach(k => { n[k] = {...n[k], moved: false, attacked: false}; });
  return n;
});
setCredits(c => c + creditsPerTurn);
// Mineral harvest from harvesters
Object.values(units).forEach(u => {
  if (u.faction === "imperial" && u.type.id === "HARVESTER" && u.hp > 0) {
    const k = hexKey(u.q, u.r);
    if (hexes[k]?.terrainId === "MINERAL") {
      setMinerals(m => Math.min(m + 3, MINERAL_QUOTA));
    }
  }
});
setTurn(t => t + 1);
setSelectedUnit(null);
setValidMoves(new Set());
setValidAttacks(new Set());
setDeployQueue(null);
addLog("━━ Imperial turn ended. MLA response initiated ━━");
```

}, [gameState, minerals, hexes, casualties, totalDeployed, turn, credits, creditsPerTurn, units, runMLATurn, addLog]);

const imperialCount = Object.values(units).filter(u=>u.faction===“imperial”&&u.hp>0).length;
const mlaCount = Object.values(units).filter(u=>u.faction===“mla”&&u.hp>0).length;
const imperialHexPct = Math.round((Object.values(hexes).filter(h=>h.owner===“imperial”).length / (GRID_COLS*GRID_ROWS))*100);
const hovHex = hovered ? hexes[hovered] : null;
const hovUnit = hovHex?.unit ? units[hovHex.unit] : null;
const casualtyRate = totalDeployed > 0 ? Math.round((casualties/totalDeployed)*100) : 0;

// ─── RENDER ──────────────────────────────────────────────────────────────────
return (
<div style={{
display:“flex”, flexDirection:“column”, height:“100vh”, background:”#030806”,
fontFamily:”‘Courier New’, monospace”, color:”#7aaf5a”, userSelect:“none”,
overflow:“hidden”, position:“relative”
}}>
{/* CRT Scanlines overlay */}
<div style={{
position:“fixed”, inset:0, pointerEvents:“none”, zIndex:100,
background: scanLineOff ? “none” : “repeating-linear-gradient(0deg,rgba(0,0,0,0.07) 0px,rgba(0,0,0,0.07) 1px,transparent 1px,transparent 3px)”,
mixBlendMode:“multiply”
}}/>
{/* Screen flicker */}
<div style={{
position:“fixed”, inset:0, pointerEvents:“none”, zIndex:99,
animation:“flicker 8s infinite”, opacity:0.03, background:”#4af84a”
}}/>
<style>{`@keyframes flicker { 0%,95%,100%{opacity:0.03} 96%{opacity:0.12} 97%{opacity:0.03} 98%{opacity:0.09} } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} } @keyframes slideIn { from{transform:translateX(60px);opacity:0} to{transform:translateX(0);opacity:1} } @keyframes fadeMsg { 0%,80%{opacity:1} 100%{opacity:0} } ::-webkit-scrollbar{width:4px;background:#020402} ::-webkit-scrollbar-thumb{background:#2a4a1a} canvas{cursor:crosshair}`}</style>

```
  {/* HEADER */}
  <div style={{
    padding:"6px 16px", background:"linear-gradient(90deg,#050e04,#0a1a06,#050e04)",
    borderBottom:"1px solid #1a3a10", display:"flex", alignItems:"center",
    justifyContent:"space-between", flexShrink:0
  }}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <div style={{fontSize:18,letterSpacing:4,color:"#4af84a",fontWeight:"bold",textShadow:"0 0 10px #4af84a"}}>
        ⬡ MIMBAN: SECTOR COMMAND
      </div>
      <div style={{fontSize:10,color:"#3a6a2a",letterSpacing:2}}>IMPERIAL HOLOTABLE v2.7</div>
    </div>
    <div style={{display:"flex",gap:20,fontSize:11,color:"#5a9a3a"}}>
      <span style={{color: turn > TURN_LIMIT*0.8 ? "#f84a4a" : "#7aff5a"}}>TURN <strong style={{color:"#4af84a",fontSize:14}}>{turn}</strong>/{TURN_LIMIT}</span>
      <span>PHASE: <strong style={{color: phase==="imperial" ? "#44aaff" : "#ff4444"}}>{phase.toUpperCase()}</strong></span>
      <span>MLA UNITS: <strong style={{color:"#f84a4a"}}>{mlaCount}</strong></span>
      <button onClick={()=>setScanLineOff(s=>!s)} style={{
        background:"none",border:"1px solid #2a4a1a",color:"#4a7a3a",
        fontSize:9,padding:"2px 6px",cursor:"pointer",letterSpacing:1
      }}>CRT:{scanLineOff?"OFF":"ON"}</button>
    </div>
  </div>

  {/* MAIN CONTENT */}
  <div style={{display:"flex",flex:1,overflow:"hidden"}}>
    {/* MAP */}
    <div style={{flex:1,overflow:"auto",position:"relative",background:"#020602",
      boxShadow:"inset 0 0 40px rgba(0,0,0,0.8)"}}>
      <canvas
        ref={canvasRef}
        width={GRID_COLS * HEX_SIZE * 1.52 + 80}
        height={GRID_ROWS * HEX_SIZE * 1.15 + 60}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={()=>setHovered(null)}
        style={{display:"block"}}
      />
      {/* Hex tooltip */}
      {hovHex && visibility.has(hovered) && (
        <div style={{
          position:"absolute", top:8, left:8, background:"rgba(5,12,3,0.95)",
          border:"1px solid #2a5a1a", padding:"8px 12px", fontSize:10, lineHeight:1.7,
          animation:"slideIn 0.1s ease", minWidth:160
        }}>
          <div style={{color:"#4af84a",fontWeight:"bold",marginBottom:4}}>
            {hovHex.terrain.label.toUpperCase()}
          </div>
          <div>COORD: ({hovHex.q},{hovHex.r})</div>
          <div>MOVE COST: <span style={{color:"#f8a44a"}}>{hovHex.terrain.move}AP</span></div>
          <div>DEFENSE: <span style={{color:"#44aaff"}}>{hovHex.terrain.def > 0 ? "+":""}{hovHex.terrain.def}</span></div>
          {hovHex.terrain.mineral > 0 && <div>MINERAL: <span style={{color:"#44ffff"}}>+{hovHex.terrain.mineral}/ext</span></div>}
          {hovHex.owner && <div>CONTROL: <span style={{color: hovHex.owner==="imperial" ? "#44aaff" : "#ff4444"}}>{hovHex.owner.toUpperCase()}</span></div>}
          {hovUnit && (
            <>
              <div style={{borderTop:"1px solid #1a3a10",marginTop:4,paddingTop:4,color: hovUnit.faction==="imperial" ? "#44aaff" : "#ff6644"}}>
                {hovUnit.type.label.toUpperCase()}
              </div>
              <div>HP: {hovUnit.hp}/{hovUnit.maxHp} | ATK:{hovUnit.type.atk} RNG:{hovUnit.type.rng}</div>
            </>
          )}
        </div>
      )}
      {/* Flash message */}
      {flashMsg && (
        <div style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          background:"rgba(5,10,3,0.95)", border:"2px solid #f84a4a",
          color:"#ff6644", padding:"10px 24px", fontSize:13, letterSpacing:2,
          animation:"fadeMsg 2.5s forwards", pointerEvents:"none", whiteSpace:"nowrap"
        }}>{flashMsg}</div>
      )}
    </div>

    {/* SIDEBAR */}
    <div style={{
      width:240, background:"linear-gradient(180deg,#050e04,#030806)",
      borderLeft:"1px solid #1a3a10", display:"flex", flexDirection:"column",
      overflow:"hidden", flexShrink:0
    }}>
      {/* COMMAND CONSOLE */}
      <div style={{padding:"8px 12px",borderBottom:"1px solid #1a3a10"}}>
        <div style={{fontSize:9,letterSpacing:3,color:"#3a6a2a",marginBottom:8}}>◈ COMMAND CONSOLE</div>
        {[
          {label:"CREDITS", val:`${credits}₹`, sub:`+${creditsPerTurn}/turn`, color:"#f8d44a"},
          {label:"HYPERBARIDE", val:`${minerals}/${MINERAL_QUOTA}`, sub:`${Math.round(minerals/MINERAL_QUOTA*100)}%`, color:"#44ffff",
            bar:minerals/MINERAL_QUOTA},
          {label:"MAP CONTROL", val:`${imperialHexPct}%`, color:"#44aaff", bar:imperialHexPct/100},
          {label:"CASUALTIES", val:`${casualties}`, sub:`${casualtyRate}% rate`, color: casualtyRate > 60 ? "#f84a4a" : "#7aff5a"},
          {label:"MUTINY METER", val:`${Math.round(mutinyMeter*100)}%`, color: mutinyMeter > 0.5 ? "#f84a4a" : "#7aff5a",
            bar:mutinyMeter, barColor: mutinyMeter > 0.5 ? "#f84a4a" : "#4af84a"},
        ].map(item => (
          <div key={item.label} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4a7a3a",letterSpacing:1}}>
              <span>{item.label}</span>
              {item.sub && <span style={{color:"#3a5a2a"}}>{item.sub}</span>}
            </div>
            <div style={{color:item.color,fontSize:13,fontWeight:"bold"}}>{item.val}</div>
            {item.bar !== undefined && (
              <div style={{height:3,background:"#0a1a08",marginTop:2}}>
                <div style={{height:"100%",width:`${item.bar*100}%`,background:item.barColor||item.color,transition:"width 0.3s"}}/>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* UNIT CARDS */}
      <div style={{padding:"8px 12px",borderBottom:"1px solid #1a3a10"}}>
        <div style={{fontSize:9,letterSpacing:3,color:"#3a6a2a",marginBottom:8}}>◈ DEPLOY UNITS</div>
        {["STORMTROOPER","MUDTROOPER","WALKER","HARVESTER","SAPPER","SNIPER"].map(tid => {
          const t = UNIT_TYPES[tid];
          const isQueued = deployQueue === tid;
          const canAfford = credits >= t.cost;
          return (
            <div key={tid} onClick={() => canAfford && setDeployQueue(isQueued ? null : tid)} style={{
              display:"flex", alignItems:"center", gap:8, padding:"5px 8px",
              marginBottom:4, background: isQueued ? "rgba(68,255,136,0.12)" : "rgba(10,20,8,0.8)",
              border:`1px solid ${isQueued ? "#44ff88" : canAfford ? "#1a3a10" : "#0a1a08"}`,
              cursor: canAfford ? "pointer" : "not-allowed", opacity: canAfford ? 1 : 0.5,
              transition:"all 0.15s"
            }}>
              <span style={{fontSize:14,color:t.color}}>{t.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color: isQueued ? "#44ff88" : "#5a9a3a",letterSpacing:1}}>{t.label}</div>
                <div style={{fontSize:8,color:"#3a5a2a"}}>HP:{t.hp} ATK:{t.atk} RNG:{t.rng} MOV:{t.mov}</div>
              </div>
              <div style={{fontSize:10,color:"#f8d44a",fontWeight:"bold"}}>{t.cost}₹</div>
            </div>
          );
        })}
        {deployQueue && (
          <div style={{fontSize:9,color:"#44ff88",textAlign:"center",padding:"4px",animation:"pulse 1s infinite",letterSpacing:1}}>
            ▼ CLICK MAP TO DEPLOY
          </div>
        )}
      </div>

      {/* SELECTED UNIT */}
      {selectedUnit && units[selectedUnit.id]?.hp > 0 && (
        <div style={{padding:"8px 12px",borderBottom:"1px solid #1a3a10"}}>
          <div style={{fontSize:9,letterSpacing:3,color:"#3a6a2a",marginBottom:6}}>◈ SELECTED UNIT</div>
          <div style={{
            background:"rgba(68,170,255,0.08)", border:"1px solid #224466",
            padding:"8px", borderRadius:2
          }}>
            <div style={{color:"#44aaff",fontWeight:"bold",fontSize:12}}>{selectedUnit.type?.label || units[selectedUnit.id]?.type.label}</div>
            {(() => {
              const u = units[selectedUnit.id];
              return <>
                <div style={{fontSize:9,color:"#4a8a5a",marginTop:4}}>
                  HP: {u.hp}/{u.maxHp} | POS: ({u.q},{u.r})
                </div>
                <div style={{fontSize:9,color:"#4a8a5a"}}>
                  ATK:{u.type.atk} RNG:{u.type.rng} MOV:{u.type.mov}
                </div>
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <span style={{
                    fontSize:8,padding:"2px 6px",
                    background: u.moved ? "#0a1a08" : "rgba(68,255,136,0.1)",
                    border:`1px solid ${u.moved ? "#1a2a10" : "#44ff88"}`,
                    color: u.moved ? "#2a4a2a" : "#44ff88"
                  }}>MOVE:{u.moved?"✗":"✓"}</span>
                  <span style={{
                    fontSize:8,padding:"2px 6px",
                    background: u.attacked ? "#0a1a08" : "rgba(255,100,68,0.1)",
                    border:`1px solid ${u.attacked ? "#1a2a10" : "#ff6444"}`,
                    color: u.attacked ? "#2a4a2a" : "#ff6444"
                  }}>FIRE:{u.attacked?"✗":"✓"}</span>
                </div>
              </>;
            })()}
          </div>
        </div>
      )}

      {/* LEGEND */}
      <div style={{padding:"8px 12px",borderBottom:"1px solid #1a3a10"}}>
        <div style={{fontSize:9,letterSpacing:3,color:"#3a6a2a",marginBottom:6}}>◈ TERRAIN KEY</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
          {Object.values(TERRAIN).slice(0,6).map(t => (
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:8,height:8,background:t.color,border:"1px solid #2a3a1a",flexShrink:0}}/>
              <span style={{fontSize:8,color:"#4a7a3a"}}>{t.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* END TURN */}
      <div style={{padding:"8px 12px"}}>
        <button onClick={endTurn} disabled={gameState!=="playing"} style={{
          width:"100%", padding:"10px", background:"linear-gradient(135deg,#0a2a08,#0d3a0a)",
          border:"1px solid #2a6a1a", color:"#4af84a", fontSize:11, letterSpacing:3,
          cursor:"pointer", fontFamily:"'Courier New',monospace", fontWeight:"bold",
          textShadow:"0 0 8px #4af84a", boxShadow:"0 0 12px rgba(74,248,74,0.15)",
          transition:"all 0.2s", textTransform:"uppercase"
        }} onMouseOver={e=>{e.target.style.background="linear-gradient(135deg,#0d3a0a,#104a0c)";e.target.style.boxShadow="0 0 20px rgba(74,248,74,0.3)"}}
           onMouseOut={e=>{e.target.style.background="linear-gradient(135deg,#0a2a08,#0d3a0a)";e.target.style.boxShadow="0 0 12px rgba(74,248,74,0.15)"}}>
          ⚡ END TURN
        </button>
      </div>
    </div>

    {/* LOG */}
    <div style={{
      width:200, background:"#020602", borderLeft:"1px solid #0d1a08",
      display:"flex", flexDirection:"column", overflow:"hidden", flexShrink:0
    }}>
      <div style={{padding:"6px 10px",borderBottom:"1px solid #0d1a08",fontSize:9,letterSpacing:3,color:"#2a5a1a"}}>
        ◈ COMBAT LOG
      </div>
      <div style={{flex:1,overflow:"auto",padding:"6px 10px"}}>
        {log.map((entry,i) => (
          <div key={i} style={{
            fontSize:9, lineHeight:1.6, color: i===0 ? "#6adf4a" : "#2a5a1a",
            borderBottom: i===0 ? "1px solid #0d2a08" : "none",
            paddingBottom: i===0 ? 4 : 0, marginBottom: i===0 ? 4 : 0,
            opacity: Math.max(0.3, 1 - i*0.04)
          }}>{entry}</div>
        ))}
      </div>
      {/* Force strengths */}
      <div style={{padding:"8px 10px",borderTop:"1px solid #0d1a08"}}>
        <div style={{fontSize:8,color:"#2a4a2a",marginBottom:4}}>FORCE STRENGTH</div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{fontSize:9,color:"#44aaff"}}>◈ IMP: {imperialCount}</span>
          <span style={{fontSize:9,color:"#f84a4a"}}>✦ MLA: {mlaCount}</span>
        </div>
        <div style={{height:6,background:"#0a1a08",position:"relative"}}>
          <div style={{
            position:"absolute",left:0,top:0,height:"100%",
            width:`${imperialCount/(imperialCount+mlaCount||1)*100}%`,
            background:"linear-gradient(90deg,#1a4488,#4488cc)",transition:"width 0.5s"
          }}/>
        </div>
      </div>
    </div>
  </div>

  {/* GAME OVER OVERLAYS */}
  {gameState !== "playing" && (
    <div style={{
      position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(0,0,0,0.88)",zIndex:200,flexDirection:"column",gap:24
    }}>
      {gameState === "won" ? (
        <>
          <div style={{fontSize:11,letterSpacing:6,color:"#44aaff"}}>IMPERIAL MANDATE</div>
          <div style={{fontSize:36,letterSpacing:8,color:"#4af84a",textShadow:"0 0 30px #4af84a",fontWeight:"bold"}}>
            VICTORY
          </div>
          <div style={{fontSize:13,letterSpacing:3,color:"#7aff5a"}}>{winReason}</div>
          <div style={{fontSize:10,color:"#3a6a2a",maxWidth:400,textAlign:"center",lineHeight:1.8}}>
            TURN {turn} | CASUALTIES: {casualties} | MINERALS EXTRACTED: {minerals}T
          </div>
        </>
      ) : (
        <>
          <div style={{fontSize:11,letterSpacing:6,color:"#f84a4a"}}>COMMAND TERMINATED</div>
          <div style={{fontSize:36,letterSpacing:8,color:"#f84a4a",textShadow:"0 0 30px #f84a4a",fontWeight:"bold"}}>
            DEFEAT
          </div>
          <div style={{fontSize:13,letterSpacing:3,color:"#ff6644"}}>{lossReason}</div>
          <div style={{fontSize:10,color:"#6a3a2a",maxWidth:400,textAlign:"center",lineHeight:1.8}}>
            THE BOG CLAIMS ALL. TURN {turn} | CASUALTIES: {casualties}
          </div>
        </>
      )}
      <button onClick={() => window.location.reload()} style={{
        marginTop:16,padding:"12px 32px",background:"transparent",
        border:`1px solid ${gameState==="won" ? "#4af84a" : "#f84a4a"}`,
        color: gameState==="won" ? "#4af84a" : "#f84a4a",
        fontSize:11,letterSpacing:3,cursor:"pointer",fontFamily:"'Courier New',monospace",
        transition:"all 0.2s"
      }}>◈ NEW CAMPAIGN</button>
    </div>
  )}
</div>
```

);
}
// This is a comment
import React from 'react';

function App() {
  // Another comment
  return (
    <div>
      <h1>Mimban Game</h1>
    </div>
  );
}

export default App;
