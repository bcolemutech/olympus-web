import { useState } from “react”;

const POWER_UP_CARDS = [
{ id: “do-over”, name: “Do-Over”, emoji: “🔄”, category: “mulligan”, desc: “Replay your shot, ball returns to original position.” },
{ id: “ball-in-hand”, name: “Ball in Hand”, emoji: “🎱”, category: “mulligan”, desc: “Place the cue ball anywhere on the table.” },
{ id: “freeze”, name: “Freeze”, emoji: “❄️”, category: “defensive”, desc: “Opponent must skip their next turn.” },
{ id: “force-scratch”, name: “Force the Scratch”, emoji: “😬”, category: “defensive”, desc: “Opponent must attempt a designated tough shot or forfeit turn.” },
{ id: “safe-only”, name: “Safe Shot Only”, emoji: “🛡️”, category: “defensive”, desc: “Opponent can only play a safety this turn, no potting.” },
{ id: “free-miss”, name: “Free Miss”, emoji: “🌬️”, category: “offensive”, desc: “Miss a shot with no foul penalty — cue ball stays put.” },
{ id: “pocket-choice”, name: “Pocket Choice”, emoji: “🎯”, category: “offensive”, desc: “Designate any ball as legally yours for one shot.” },
{ id: “mulligan-rail”, name: “Mulligan Rail”, emoji: “↩️”, category: “offensive”, desc: “Retrieve one of your balls from a pocket back near that pocket.” },
{ id: “rescue”, name: “Rescue”, emoji: “🚑”, category: “escape”, desc: “Return one of your potted balls back onto the table.” },
{ id: “snooker-escape”, name: “Snooker Escape”, emoji: “🏃”, category: “escape”, desc: “If completely snookered, move cue ball to any safe spot.” },
{ id: “foul-forgive”, name: “Foul Forgiveness”, emoji: “🙏”, category: “escape”, desc: “Cancel opponent’s ball-in-hand after your foul.” },
{ id: “reverse”, name: “Reverse”, emoji: “🔀”, category: “wild”, desc: “Swap stripes/solids — you each shoot the other’s balls!” },
{ id: “blind-shot”, name: “Blind Shot”, emoji: “🙈”, category: “wild”, desc: “Opponent must take their next shot looking away.” },
{ id: “two-shot”, name: “Two-Shot Turn”, emoji: “✌️”, category: “wild”, desc: “Take two consecutive shots this turn.” },
];

const CAT = {
mulligan:  { bg: “#0d2a40”, border: “#3a8fc4”, label: “Mulligan” },
defensive: { bg: “#3a0d0d”, border: “#c43a3a”, label: “Defensive” },
offensive: { bg: “#0d2e0d”, border: “#3ac45a”, label: “Offensive” },
escape:    { bg: “#2e2a0d”, border: “#c4b03a”, label: “Escape” },
wild:      { bg: “#20103a”, border: “#9a3ac4”, label: “Wild” },
};

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(count, exclude = []) {
const pool = POWER_UP_CARDS.filter(c => !exclude.includes(c.id));
return shuffleArray(pool).slice(0, Math.min(count, pool.length));
}

function Card({ card, used, onUse }) {
const s = CAT[card.category];
return (
<div onClick={() => !used && onUse(card.id)} style={{
background: used ? “#111” : s.bg,
border: `1.5px solid ${used ? "#222" : s.border}`,
borderRadius: 10, padding: “10px 12px”,
cursor: used ? “not-allowed” : “pointer”,
opacity: used ? 0.35 : 1,
transition: “opacity 0.2s”,
position: “relative”,
}}>
<div style={{ fontSize: 20 }}>{card.emoji}</div>
<div style={{ color: “#fff”, fontWeight: 700, fontSize: 13, margin: “4px 0 2px” }}>{card.name}</div>
<div style={{ color: s.border, fontSize: 10, textTransform: “uppercase”, letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
<div style={{ color: “#888”, fontSize: 10, lineHeight: 1.4 }}>{card.desc}</div>
{used && <div style={{ position: “absolute”, top: 6, right: 8, color: “#444”, fontSize: 11, fontWeight: 700 }}>USED</div>}
</div>
);
}

function PlayerSection({ name, color, cards, used, onUse, onAdd, onRemove, onResetUsed, manual }) {
const remaining = cards.filter(c => !used.has(c.id)).length;
return (
<div style={{ flex: 1, minWidth: 0 }}>
<div style={{ display: “flex”, justifyContent: “space-between”, alignItems: “flex-end”, marginBottom: 10 }}>
<div>
<div style={{ fontWeight: 800, fontSize: 18, color, letterSpacing: 1 }}>{name}</div>
<div style={{ color: “#555”, fontSize: 11 }}>{remaining}/{cards.length} cards remaining</div>
</div>
{manual && (
<div style={{ display: “flex”, gap: 5 }}>
{[[“−”, “#c43a3a”, onRemove], [”+”, “#3ac45a”, onAdd], [“↺”, “#3a8fc4”, onResetUsed]].map(([lbl, clr, fn]) => (
<button type="button" key={lbl} onClick={fn} style={{ background: “none”, border: `1px solid ${clr}`, color: clr, borderRadius: 6, width: 28, height: 28, cursor: “pointer”, fontSize: 14 }}>{lbl}</button>
))}
</div>
)}
</div>
{cards.length === 0
? <div style={{ color: “#2a2a2a”, border: “1px dashed #1a1a1a”, borderRadius: 10, padding: 30, textAlign: “center”, fontSize: 13 }}>No cards dealt yet</div>
: <div style={{ display: “grid”, gridTemplateColumns: “1fr 1fr”, gap: 8 }}>
{cards.map(c => <Card key={c.id} card={c} used={used.has(c.id)} onUse={onUse} />)}
</div>
}
</div>
);
}

function Counter({ label, value, color, onInc, onDec, onReset }) {
return (
<div style={{ background: “#111”, border: “1px solid #1e1e1e”, borderRadius: 10, padding: “12px 10px”, textAlign: “center” }}>
<div style={{ color: “#555”, fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>{label}</div>
<div style={{ display: “flex”, alignItems: “center”, justifyContent: “center”, gap: 10 }}>
<button onClick={onDec} style={{ background: “#1a1a1a”, border: “1px solid #2a2a2a”, color: “#aaa”, borderRadius: 6, width: 28, height: 28, cursor: “pointer” }}>−</button>
<span style={{ color, fontSize: 32, fontWeight: 900, minWidth: 40, display: “inline-block” }}>{value}</span>
<button onClick={onInc} style={{ background: “#1a1a1a”, border: “1px solid #2a2a2a”, color: “#aaa”, borderRadius: 6, width: 28, height: 28, cursor: “pointer” }}>+</button>
</div>
<button onClick={onReset} style={{ marginTop: 6, background: “none”, border: “none”, color: “#333”, cursor: “pointer”, fontSize: 10 }}>reset</button>
</div>
);
}

export default function App() {
const [p1Cards, setP1Cards] = useState([]);
const [p2Cards, setP2Cards] = useState([]);
const [p1Used, setP1Used] = useState(new Set());
const [p2Used, setP2Used] = useState(new Set());
const [p1Skill, setP1Skill] = useState(5);
const [p2Skill, setP2Skill] = useState(5);
const [showMatch, setShowMatch] = useState(false);
const [showBall, setShowBall] = useState(false);
const [manual, setManual] = useState(false);
const [p1Wins, setP1Wins] = useState(0);
const [p2Wins, setP2Wins] = useState(0);
const [p1Balls, setP1Balls] = useState(0);
const [p2Balls, setP2Balls] = useState(0);
const [lastPlayed, setLastPlayed] = useState(null);

const diff = Math.abs(p1Skill - p2Skill);
const weakCards = Math.round(Math.min(2 + diff * 1.5, 10));
const strongCards = Math.max(2, weakCards - diff);
const p1Count = p1Skill <= p2Skill ? weakCards : strongCards;
const p2Count = p2Skill <= p1Skill ? weakCards : strongCards;

const deal = () => {
const h1 = dealCards(p1Count);
const h2 = dealCards(p2Count, h1.map(c => c.id));
setP1Cards(h1); setP2Cards(h2);
setP1Used(new Set()); setP2Used(new Set());
setLastPlayed(null);
};

const useCard = (player, id) => {
const card = POWER_UP_CARDS.find(c => c.id === id);
setLastPlayed({ player, card });
if (player === 1) setP1Used(s => new Set([…s, id]));
else setP2Used(s => new Set([…s, id]));
};

const addCard = (player) => {
const all = […p1Cards, …p2Cards].map(c => c.id);
const [nc] = dealCards(1, all);
if (!nc) return;
if (player === 1) setP1Cards(p => […p, nc]);
else setP2Cards(p => […p, nc]);
};

return (
<div style={{ minHeight: “100vh”, background: “#0a0a0a”, color: “#fff”, fontFamily: “system-ui, sans-serif”, padding: “16px 14px”, maxWidth: 700, margin: “0 auto” }}>

```
  <div style={{ textAlign: "center", marginBottom: 20 }}>
    <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 3 }}>🎱 POOL POWER-UPS</div>
    <div style={{ color: "#444", fontSize: 11, letterSpacing: 3, marginTop: 2 }}>HANDICAP CARD SYSTEM</div>
  </div>

  {lastPlayed && (
    <div style={{ background: CAT[lastPlayed.card.category].bg, border: `1px solid ${CAT[lastPlayed.card.category].border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 22 }}>{lastPlayed.card.emoji}</span>
      <div>
        <div style={{ fontSize: 12, color: "#aaa" }}>Player {lastPlayed.player} played <strong style={{ color: "#fff" }}>{lastPlayed.card.name}</strong></div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{lastPlayed.card.desc}</div>
      </div>
    </div>
  )}

  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
    {[["Match Counter", showMatch, setShowMatch], ["Ball Counter (14.1)", showBall, setShowBall], ["Manual Mode", manual, setManual]].map(([lbl, on, set]) => (
      <button key={lbl} onClick={() => set(v => !v)} style={{
        background: on ? "#0d2e0d" : "#111", border: `1px solid ${on ? "#3ac45a" : "#222"}`,
        color: on ? "#3ac45a" : "#444", borderRadius: 20, padding: "5px 14px",
        cursor: "pointer", fontSize: 11, letterSpacing: 1,
      }}>{on ? "✓ " : ""}{lbl}</button>
    ))}
  </div>

  {(showMatch || showBall) && (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
      {showMatch && <>
        <Counter label="P1 WINS" value={p1Wins} color="#3a8fc4" onInc={() => setP1Wins(v => v+1)} onDec={() => setP1Wins(v => Math.max(0,v-1))} onReset={() => setP1Wins(0)} />
        <Counter label="P2 WINS" value={p2Wins} color="#c43a8f" onInc={() => setP2Wins(v => v+1)} onDec={() => setP2Wins(v => Math.max(0,v-1))} onReset={() => setP2Wins(0)} />
      </>}
      {showBall && <>
        <Counter label="P1 BALLS" value={p1Balls} color="#c4b03a" onInc={() => setP1Balls(v => v+1)} onDec={() => setP1Balls(v => Math.max(0,v-1))} onReset={() => setP1Balls(0)} />
        <Counter label="P2 BALLS" value={p2Balls} color="#9a3ac4" onInc={() => setP2Balls(v => v+1)} onDec={() => setP2Balls(v => Math.max(0,v-1))} onReset={() => setP2Balls(0)} />
      </>}
    </div>
  )}

  <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 12, padding: 18, marginBottom: 18 }}>
    <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 2, color: "#666", marginBottom: 14 }}>HANDICAP CALCULATOR</div>
    {[["Player 1", p1Skill, setP1Skill, "#3a8fc4", p1Count], ["Player 2", p2Skill, setP2Skill, "#c43a8f", p2Count]].map(([name, val, set, color, cards]) => (
      <div key={name} style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: "#aaa" }}>{name} Skill Level</span>
          <span style={{ color, fontWeight: 700, fontSize: 12 }}>{val}/10 → <span style={{ color: "#fff" }}>{cards} cards</span></span>
        </div>
        <input type="range" min={1} max={10} value={val} onChange={e => set(+e.target.value)} style={{ width: "100%", accentColor: color }} />
      </div>
    ))}
    <button onClick={deal} style={{ width: "100%", background: "#1a3a1a", border: "1px solid #3ac45a", color: "#3ac45a", borderRadius: 8, padding: "11px 0", fontWeight: 800, fontSize: 14, letterSpacing: 2, cursor: "pointer", marginTop: 4 }}>
      🃏 DEAL HANDS
    </button>
  </div>

  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
    <PlayerSection name="PLAYER 1" color="#3a8fc4" cards={p1Cards} used={p1Used}
      onUse={id => useCard(1, id)}
      onAdd={() => addCard(1)} onRemove={() => setP1Cards(p => p.slice(0,-1))} onResetUsed={() => setP1Used(new Set())}
      manual={manual} />
    <PlayerSection name="PLAYER 2" color="#c43a8f" cards={p2Cards} used={p2Used}
      onUse={id => useCard(2, id)}
      onAdd={() => addCard(2)} onRemove={() => setP2Cards(p => p.slice(0,-1))} onResetUsed={() => setP2Used(new Set())}
      manual={manual} />
  </div>

  <div style={{ textAlign: "center", marginTop: 24, color: "#2a2a2a", fontSize: 11, letterSpacing: 2 }}>TAP A CARD TO USE IT</div>
</div>
```

);
}