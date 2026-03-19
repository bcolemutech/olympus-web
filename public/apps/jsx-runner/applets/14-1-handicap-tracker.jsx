const { useState, useEffect, useCallback } = React;

const ELO_D = 200;
const ELO_K = 32;
const MIN_TARGET = 50;
const MAX_TARGET = 100;

const SKILL_SEEDS = [
{ label: "Beginner", desc: "Rarely runs 5+", rating: 600 },
{ label: "Below Avg", desc: "Occasional short runs", rating: 750 },
{ label: "Average", desc: "Runs of 10-15", rating: 900 },
{ label: "Above Avg", desc: "Runs of 15-25", rating: 1100 },
{ label: "Advanced", desc: "Regular 20+ runs", rating: 1250 },
{ label: "Expert", desc: "Consistent 30+ runs", rating: 1500 },
];

function ratingToLabel(r) {
const sorted = [...SKILL_SEEDS].sort((a, b) => a.rating - b.rating);
return sorted.reduce((best, s) => (r >= s.rating ? s : best), sorted[0]).label;
}

function ratingToTarget(r) {
const raw = Math.round((50 + (r - 500) / 20) / 5) * 5;
return Math.max(MIN_TARGET, Math.min(MAX_TARGET, raw));
}

function expectedWin(rA, rB) {
return 1 / (1 + Math.pow(10, (rB - rA) / ELO_D));
}

function calcAdjustment(winnerR, loserR, loserScore, loserTarget) {
const E = expectedWin(winnerR, loserR);
const completion = loserTarget > 0 ? loserScore / loserTarget : 0;
const margin = 1 + (1 - completion);
const delta = Math.round(ELO_K * margin * (1 - E));
return delta;
}

const STORAGE_KEY = "pool-handicap-data";

function App() {
const [players, setPlayers] = useState([]);
const [matches, setMatches] = useState([]);
const [loaded, setLoaded] = useState(false);

const [view, setView] = useState("standings");
const [newName, setNewName] = useState("");
const [newSeed, setNewSeed] = useState(2);
const [matchA, setMatchA] = useState("");
const [matchB, setMatchB] = useState("");
const [winner, setWinner] = useState("");
const [loserScore, setLoserScore] = useState("");
const [showInfo, setShowInfo] = useState(false);
const [hoveredNav, setHoveredNav] = useState(null);
const [hoveredSeed, setHoveredSeed] = useState(null);
const [hoveredWinner, setHoveredWinner] = useState(null);

useEffect(() => {
try {
const raw = localStorage.getItem(STORAGE_KEY);
if (raw) {
const data = JSON.parse(raw);
setPlayers(data.players || []);
setMatches(data.matches || []);
}
} catch (e) {}
setLoaded(true);
}, []);

const persist = useCallback((p, m) => {
try {
localStorage.setItem(STORAGE_KEY, JSON.stringify({ players: p, matches: m }));
} catch (e) {}
}, []);

function addPlayer() {
if (!newName.trim()) return;
if (players.find(p => p.name.toLowerCase() === newName.trim().toLowerCase())) return;
const seed = SKILL_SEEDS[newSeed];
const np = [...players, {
id: Date.now().toString(),
name: newName.trim(),
rating: seed.rating,
initialRating: seed.rating,
wins: 0,
losses: 0,
seedLabel: seed.label,
}];
setPlayers(np);
setNewName("");
persist(np, matches);
}

function removePlayer(id) {
const np = players.filter(p => p.id !== id);
setPlayers(np);
persist(np, matches);
}

function recordMatch() {
if (!matchA || !matchB || matchA === matchB || !winner) return;
const ls = parseInt(loserScore);
if (isNaN(ls) || ls < 0) return;

const pA = players.find(p => p.id === matchA);
const pB = players.find(p => p.id === matchB);
if (!pA || !pB) return;

const winnerId = winner;
const loserId = winnerId === pA.id ? pB.id : pA.id;
const winnerP = winnerId === pA.id ? pA : pB;
const loserP = loserId === pA.id ? pA : pB;
const loserTarget = ratingToTarget(loserP.rating);
const winnerTarget = ratingToTarget(winnerP.rating);

if (ls > loserTarget) return;

const delta = calcAdjustment(winnerP.rating, loserP.rating, ls, loserTarget);

const newMatch = {
  id: Date.now().toString(),
  date: new Date().toLocaleDateString(),
  winnerId, loserId,
  winnerName: winnerP.name,
  loserName: loserP.name,
  winnerTarget,
  loserTarget,
  loserScore: ls,
  winnerOldRating: winnerP.rating,
  loserOldRating: loserP.rating,
  delta,
};

const np = players.map(p => {
  if (p.id === winnerId) return { ...p, rating: Math.min(1500, p.rating + delta), wins: p.wins + 1 };
  if (p.id === loserId) return { ...p, rating: Math.max(500, p.rating - delta), losses: p.losses + 1 };
  return p;
});

const nm = [newMatch, ...matches];
setPlayers(np);
setMatches(nm);
setMatchA("");
setMatchB("");
setWinner("");
setLoserScore("");
persist(np, nm);

}

function resetAll() {
setPlayers([]);
setMatches([]);
persist([], []);
}

const sortedPlayers = [...players].sort((a, b) => b.rating - a.rating);

function navBtnStyle(v) {
if (view === v) return { ...styles.navBtn, ...styles.navBtnActive };
if (hoveredNav === v) return { ...styles.navBtn, ...styles.navBtnHover };
return styles.navBtn;
}

function seedBtnStyle(i) {
if (newSeed === i) return { ...styles.seedBtn, ...styles.seedBtnActive };
if (hoveredSeed === i) return { ...styles.seedBtn, ...styles.seedBtnHover };
return styles.seedBtn;
}

function winnerBtnStyle(id) {
if (winner === id) return { ...styles.winnerBtn, ...styles.winnerBtnActive };
if (hoveredWinner === id) return { ...styles.winnerBtn, ...styles.winnerBtnHover };
return styles.winnerBtn;
}

const selectedA = players.find(p => p.id === matchA);
const selectedB = players.find(p => p.id === matchB);
const targetA = selectedA ? ratingToTarget(selectedA.rating) : null;
const targetB = selectedB ? ratingToTarget(selectedB.rating) : null;

if (!loaded) return (
<div style={styles.loadWrap}>
<div style={styles.loadText}>Loading...</div>
</div>
);

return (
<div style={styles.root}>
<div style={styles.header}>
<div style={styles.headerInner}>
<h1 style={styles.title}>14.1 HANDICAP</h1>
<p style={styles.subtitle}>Variable Target System</p>
</div>
<button style={styles.infoBtn} onClick={() => setShowInfo(!showInfo)}>
{showInfo ? "✕" : "?"}
</button>
</div>

  {showInfo && (
    <div style={styles.infoPanel}>
      <h3 style={styles.infoTitle}>HOW IT WORKS</h3>
      <div style={styles.infoGrid}>
        <div style={styles.infoCard}>
          <div style={styles.infoCardNum}>1</div>
          <div>
            <strong style={styles.infoStrong}>Variable Targets</strong>
            <p style={styles.infoP}>Instead of everyone racing to 100, each player has their own target based on skill rating. Targets range from 50 to 100. A beginner might race to 55 while an expert races to 100 — in the same match.</p>
          </div>
        </div>
        <div style={styles.infoCard}>
          <div style={styles.infoCardNum}>2</div>
          <div>
            <strong style={styles.infoStrong}>Elo Rating Engine</strong>
            <p style={styles.infoP}>Each player carries a skill rating (500–1500). Your target = 50 + (rating − 500) ÷ 20, rounded to the nearest 5. After each match, ratings adjust using Elo math: upsets cause big swings, expected wins cause small ones.</p>
          </div>
        </div>
        <div style={styles.infoCard}>
          <div style={styles.infoCardNum}>3</div>
          <div>
            <strong style={styles.infoStrong}>Margin Multiplier</strong>
            <p style={styles.infoP}>The adjustment factors in <em>how decisive</em> the win was. If the loser reached 90% of their target, it was close and adjustments are mild. A blowout (loser at 40%) amplifies the rating swing up to 2×, so handicaps converge fast.</p>
          </div>
        </div>
        <div style={styles.infoCard}>
          <div style={styles.infoCardNum}>4</div>
          <div>
            <strong style={styles.infoStrong}>The Formula</strong>
            <p style={styles.infoP}>
              <code style={styles.code}>E = 1 / (1 + 10^((Rb−Ra)/200))</code><br/>
              <code style={styles.code}>M = 1 + (1 − loser_score/loser_target)</code><br/>
              <code style={styles.code}>Δ = round(32 × M × (1 − E))</code><br/>
              Winner gains Δ, loser drops Δ. Ratings clamp to 500–1500.
            </p>
          </div>
        </div>
      </div>
      <div style={styles.seedRef}>
        <strong style={styles.infoStrong}>Starting Seeds</strong>
        <div style={styles.seedGrid}>
          {SKILL_SEEDS.map(s => (
            <div key={s.label} style={styles.seedItem}>
              <span style={styles.seedLabel}>{s.label}</span>
              <span style={styles.seedRating}>{s.rating} → {ratingToTarget(s.rating)} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )}

  <div style={styles.nav}>
    {["standings", "record", "players", "history"].map(v => (
      <button
        key={v}
        style={navBtnStyle(v)}
        onClick={() => setView(v)}
        onMouseDown={e => e.preventDefault()}
        onMouseEnter={() => setHoveredNav(v)}
        onMouseLeave={() => setHoveredNav(null)}
      >
        {v.toUpperCase()}
      </button>
    ))}
  </div>

  <div style={styles.body}>
    {view === "standings" && (
      <div>
        {sortedPlayers.length === 0 ? (
          <div style={styles.empty}>
            <p style={styles.emptyText}>No players yet.</p>
            <p style={styles.emptyHint}>Go to PLAYERS to add your group.</p>
          </div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span style={{ ...styles.thCell, flex: 0.5 }}>#</span>
              <span style={{ ...styles.thCell, flex: 2 }}>PLAYER</span>
              <span style={styles.thCell}>RATING</span>
              <span style={{ ...styles.thCell, ...styles.targetCol }}>TARGET</span>
              <span style={styles.thCell}>W-L</span>
            </div>
            {sortedPlayers.map((p, i) => {
              const target = ratingToTarget(p.rating);
              const rChange = p.rating - p.initialRating;
              return (
                <div key={p.id} style={i % 2 === 0 ? styles.tableRow : { ...styles.tableRow, ...styles.tableRowAlt }}>
                  <span style={{ ...styles.tdCell, flex: 0.5, ...styles.rank }}>{i + 1}</span>
                  <span style={{ ...styles.tdCell, flex: 2 }}>
                    <span style={styles.playerName}>{p.name}</span>
                    <span style={styles.ratingDelta}>
                      {rChange > 0 ? `▲${rChange}` : rChange < 0 ? `▼${Math.abs(rChange)}` : "—"}
                    </span>
                  </span>
                  <span style={styles.tdCell}>{p.rating}</span>
                  <span style={{ ...styles.tdCell, ...styles.targetCol }}>
                    <span style={styles.targetBadge}>{target}</span>
                  </span>
                  <span style={styles.tdCell}>{p.wins}-{p.losses}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}

    {view === "players" && (
      <div>
        <div style={styles.formSection}>
          <h3 style={styles.formTitle}>ADD PLAYER</h3>
          <input
            style={styles.input}
            placeholder="Player name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPlayer()}
          />
          <div style={styles.seedSelect}>
            {SKILL_SEEDS.map((s, i) => (
              <button
                key={s.label}
                style={seedBtnStyle(i)}
                onClick={() => setNewSeed(i)}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHoveredSeed(i)}
                onMouseLeave={() => setHoveredSeed(null)}
              >
                <span style={styles.seedBtnLabel}>{s.label}</span>
                <span style={styles.seedBtnDesc}>{s.desc}</span>
                <span style={styles.seedBtnTarget}>Target: {ratingToTarget(s.rating)}</span>
              </button>
            ))}
          </div>
          <button style={styles.primaryBtn} onClick={addPlayer}>ADD PLAYER</button>
        </div>

        {players.length > 0 && (
          <div style={styles.formSection}>
            <h3 style={styles.formTitle}>CURRENT PLAYERS</h3>
            {players.map(p => (
              <div key={p.id} style={styles.playerRow}>
                <div>
                  <span style={styles.playerRowName}>{p.name}</span>
                  <span style={styles.playerRowSeed}>{ratingToLabel(p.rating)} seed</span>
                </div>
                <button style={styles.removeBtn} onClick={() => removePlayer(p.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {(players.length > 0 || matches.length > 0) && (
          <div style={{ ...styles.formSection, marginTop: 32 }}>
            <button style={styles.dangerBtn} onClick={resetAll}>RESET ALL DATA</button>
          </div>
        )}
      </div>
    )}

    {view === "record" && (
      <div>
        {players.length < 2 ? (
          <div style={styles.empty}>
            <p style={styles.emptyText}>Need at least 2 players.</p>
            <p style={styles.emptyHint}>Go to PLAYERS to add your group.</p>
          </div>
        ) : (
          <div style={styles.formSection}>
            <h3 style={styles.formTitle}>RECORD MATCH</h3>

            <label style={styles.label}>Player A</label>
            <select style={styles.select} value={matchA} onChange={e => { setMatchA(e.target.value); setWinner(""); }}>
              <option value="">Select player...</option>
              {players.filter(p => p.id !== matchB).map(p => (
                <option key={p.id} value={p.id}>{p.name} (target: {ratingToTarget(p.rating)})</option>
              ))}
            </select>

            <label style={styles.label}>Player B</label>
            <select style={styles.select} value={matchB} onChange={e => { setMatchB(e.target.value); setWinner(""); }}>
              <option value="">Select player...</option>
              {players.filter(p => p.id !== matchA).map(p => (
                <option key={p.id} value={p.id}>{p.name} (target: {ratingToTarget(p.rating)})</option>
              ))}
            </select>

            {matchA && matchB && (
              <div style={styles.matchPreview}>
                <div style={styles.matchPreviewPlayer}>
                  <span style={styles.matchPreviewName}>{selectedA?.name}</span>
                  <span style={styles.matchPreviewTarget}>races to {targetA}</span>
                </div>
                <span style={styles.matchVs}>VS</span>
                <div style={styles.matchPreviewPlayer}>
                  <span style={styles.matchPreviewName}>{selectedB?.name}</span>
                  <span style={styles.matchPreviewTarget}>races to {targetB}</span>
                </div>
              </div>
            )}

            {matchA && matchB && (
              <>
                <label style={styles.label}>Who won?</label>
                <div style={styles.winnerSelect}>
                  {[matchA, matchB].map(id => {
                    const p = players.find(pp => pp.id === id);
                    return (
                      <button
                        key={id}
                        style={winnerBtnStyle(id)}
                        onClick={() => setWinner(id)}
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setHoveredWinner(id)}
                        onMouseLeave={() => setHoveredWinner(null)}
                      >
                        {p?.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {winner && (
              <>
                <label style={styles.label}>
                  Loser's final score (out of {ratingToTarget(players.find(p => p.id !== winner && (p.id === matchA || p.id === matchB))?.rating || 0)})
                </label>
                <input
                  style={styles.input}
                  type="number"
                  min="0"
                  placeholder="Score when match ended"
                  value={loserScore}
                  onChange={e => setLoserScore(e.target.value)}
                />
              </>
            )}

            {winner && loserScore !== "" && (
              <div style={styles.previewCalc}>
                {(() => {
                  const wP = players.find(p => p.id === winner);
                  const lP = players.find(p => p.id !== winner && (p.id === matchA || p.id === matchB));
                  if (!wP || !lP) return null;
                  const lt = ratingToTarget(lP.rating);
                  const ls = parseInt(loserScore);
                  if (isNaN(ls) || ls < 0 || ls > lt) return <span style={styles.errorText}>Score must be 0–{lt}</span>;
                  const d = calcAdjustment(wP.rating, lP.rating, ls, lt);
                  const comp = ((ls / lt) * 100).toFixed(0);
                  return (
                    <>
                      <div style={styles.previewRow}>
                        <span style={styles.previewLabel}>Loser completion</span>
                        <span style={styles.previewVal}>{comp}%</span>
                      </div>
                      <div style={styles.previewRow}>
                        <span style={styles.previewLabel}>Rating swing</span>
                        <span style={styles.previewVal}>±{d}</span>
                      </div>
                      <div style={styles.previewRow}>
                        <span style={styles.previewLabel}>{wP.name} new rating</span>
                        <span style={{ ...styles.previewVal, color: "#4ade80" }}>{Math.min(1500, wP.rating + d)} → target {ratingToTarget(Math.min(1500, wP.rating + d))}</span>
                      </div>
                      <div style={styles.previewRow}>
                        <span style={styles.previewLabel}>{lP.name} new rating</span>
                        <span style={{ ...styles.previewVal, color: "#f87171" }}>{Math.max(500, lP.rating - d)} → target {ratingToTarget(Math.max(500, lP.rating - d))}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <button style={styles.primaryBtn} onClick={recordMatch}>SAVE MATCH</button>
          </div>
        )}
      </div>
    )}

    {view === "history" && (
      <div>
        {matches.length === 0 ? (
          <div style={styles.empty}>
            <p style={styles.emptyText}>No matches recorded yet.</p>
          </div>
        ) : (
          matches.map(m => (
            <div key={m.id} style={styles.historyCard}>
              <div style={styles.historyDate}>{m.date}</div>
              <div style={styles.historyResult}>
                <span style={styles.historyWinner}>{m.winnerName}</span>
                <span style={styles.historyScore}>{m.winnerTarget}</span>
                <span style={styles.historyVs}>beat</span>
                <span style={styles.historyLoser}>{m.loserName}</span>
                <span style={styles.historyScore}>{m.loserScore}/{m.loserTarget}</span>
              </div>
              <div style={styles.historyDelta}>
                Rating Δ: ±{m.delta}
              </div>
            </div>
          ))
        )}
      </div>
    )}
  </div>
</div>

);
}

const styles = {
root: {
fontFamily: "‘JetBrains Mono’, ‘SF Mono’, ‘Fira Code’, monospace",
background: "#0c0f14",
color: "#e4e4e7",
minHeight: "100vh",
maxWidth: 600,
margin: "0 auto",
padding: "0 16px 40px",
},
loadWrap: { display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" },
loadText: { color: "#71717a", fontSize: 14 },
header: {
display: "flex",
justifyContent: "space-between",
alignItems: "flex-start",
padding: "32px 0 12px",
borderBottom: "1px solid #27272a",
},
headerInner: {},
title: {
fontSize: 28,
fontWeight: 800,
letterSpacing: "0.08em",
margin: 0,
background: "linear-gradient(135deg, #f0abfc, #818cf8)",
WebkitBackgroundClip: "text",
WebkitTextFillColor: "transparent",
},
subtitle: { fontSize: 11, color: "#71717a", letterSpacing: "0.15em", marginTop: 4, textTransform: "uppercase" },
infoBtn: {
background: "transparent",
border: "1px solid #3f3f46",
color: "#a1a1aa",
borderRadius: "50%",
width: 32,
height: 32,
fontSize: 14,
cursor: "pointer",
marginTop: 4,
},
infoPanel: {
background: "#18181b",
border: "1px solid #27272a",
borderRadius: 8,
padding: 20,
marginTop: 16,
},
infoTitle: { fontSize: 12, letterSpacing: "0.12em", color: "#a1a1aa", marginTop: 0, marginBottom: 16 },
infoGrid: { display: "grid", gridTemplateColumns: "1fr", gap: 14 },
infoCard: { display: "flex", gap: 12, alignItems: "flex-start" },
infoCardNum: {
background: "#27272a",
color: "#a78bfa",
fontWeight: 700,
width: 24,
height: 24,
minWidth: 24,
borderRadius: 4,
display: "flex",
alignItems: "center",
justifyContent: "center",
fontSize: 12,
},
infoStrong: { fontSize: 13, color: "#e4e4e7" },
infoP: { fontSize: 12, color: "#a1a1aa", margin: "4px 0 0", lineHeight: 1.5 },
code: {
display: "block",
fontSize: 11,
color: "#a78bfa",
background: "#09090b",
padding: "2px 6px",
borderRadius: 3,
marginTop: 2,
},
seedRef: { marginTop: 16, paddingTop: 16, borderTop: "1px solid #27272a" },
seedGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 },
seedItem: { display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0" },
seedLabel: { color: "#a1a1aa" },
seedRating: { color: "#818cf8", fontWeight: 600 },
nav: {
display: "flex",
gap: 0,
marginTop: 16,
borderBottom: "1px solid #27272a",
},
navBtn: {
flex: 1,
background: "transparent",
border: "none",
borderBottom: "2px solid transparent",
color: "#71717a",
padding: "10px 0",
fontSize: 11,
letterSpacing: "0.08em",
cursor: "pointer",
fontFamily: "inherit",
transition: "color 0.15s, border-color 0.15s",
},
navBtnHover: {
color: "#a1a1aa",
},
navBtnActive: {
color: "#e4e4e7",
borderBottomColor: "#a78bfa",
},
body: { marginTop: 20 },
empty: { textAlign: "center", padding: "48px 0" },
emptyText: { fontSize: 14, color: "#71717a" },
emptyHint: { fontSize: 12, color: "#52525b", marginTop: 4 },
table: { borderRadius: 8, overflow: "hidden", border: "1px solid #27272a" },
tableHeader: {
display: "flex",
padding: "10px 14px",
background: "#18181b",
fontSize: 10,
letterSpacing: "0.1em",
color: "#71717a",
fontWeight: 600,
},
tableRow: {
display: "flex",
padding: "12px 14px",
alignItems: "center",
borderTop: "1px solid #1e1e22",
background: "#0f1117",
},
tableRowAlt: { background: "#12141b" },
thCell: { flex: 1 },
tdCell: { flex: 1, fontSize: 13 },
targetCol: { textAlign: "center" },
rank: { color: "#52525b", fontWeight: 700 },
playerName: { fontWeight: 600 },
ratingDelta: { fontSize: 10, marginLeft: 8, color: "#52525b" },
targetBadge: {
background: "linear-gradient(135deg, #a78bfa22, #818cf822)",
border: "1px solid #a78bfa44",
padding: "3px 10px",
borderRadius: 4,
fontSize: 14,
fontWeight: 700,
color: "#c4b5fd",
},
formSection: { marginBottom: 24 },
formTitle: { fontSize: 12, letterSpacing: "0.12em", color: "#71717a", marginBottom: 12 },
label: { display: "block", fontSize: 11, color: "#a1a1aa", marginBottom: 6, marginTop: 16, letterSpacing: "0.05em" },
input: {
width: "100%",
background: "#18181b",
border: "1px solid #3f3f46",
borderRadius: 6,
padding: "10px 12px",
color: "#e4e4e7",
fontSize: 14,
fontFamily: "inherit",
boxSizing: "border-box",
outline: "none",
},
select: {
width: "100%",
background: "#18181b",
border: "1px solid #3f3f46",
borderRadius: 6,
padding: "10px 12px",
color: "#e4e4e7",
fontSize: 14,
fontFamily: "inherit",
boxSizing: "border-box",
outline: "none",
appearance: "none",
},
seedSelect: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 12 },
seedBtn: {
background: "#18181b",
border: "1px solid #27272a",
borderRadius: 6,
padding: "10px 8px",
cursor: "pointer",
textAlign: "center",
transition: "background 0.15s, border-color 0.15s",
},
seedBtnHover: {
borderColor: "#3f3f46",
background: "#1c1c1f",
},
seedBtnActive: {
borderColor: "#a78bfa",
background: "#1e1b2e",
},
seedBtnLabel: { display: "block", fontSize: 11, fontWeight: 700, color: "#e4e4e7" },
seedBtnDesc: { display: "block", fontSize: 9, color: "#71717a", marginTop: 2 },
seedBtnTarget: { display: "block", fontSize: 10, color: "#a78bfa", marginTop: 4, fontWeight: 600 },
primaryBtn: {
width: "100%",
padding: "12px",
marginTop: 20,
background: "linear-gradient(135deg, #7c3aed, #6366f1)",
border: "none",
borderRadius: 6,
color: "#fff",
fontSize: 12,
fontWeight: 700,
letterSpacing: "0.1em",
cursor: "pointer",
fontFamily: "inherit",
},
dangerBtn: {
width: "100%",
padding: "10px",
background: "transparent",
border: "1px solid #7f1d1d",
borderRadius: 6,
color: "#f87171",
fontSize: 11,
letterSpacing: "0.08em",
cursor: "pointer",
fontFamily: "inherit",
},
playerRow: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
padding: "10px 12px",
background: "#18181b",
borderRadius: 6,
marginBottom: 6,
},
playerRowName: { fontSize: 13, fontWeight: 600 },
playerRowSeed: { fontSize: 10, color: "#71717a", marginLeft: 8 },
removeBtn: {
background: "transparent",
border: "none",
color: "#52525b",
cursor: "pointer",
fontSize: 14,
padding: "4px 8px",
},
matchPreview: {
display: "flex",
alignItems: "center",
justifyContent: "center",
gap: 16,
padding: "16px",
background: "#18181b",
borderRadius: 8,
marginTop: 16,
border: "1px solid #27272a",
},
matchPreviewPlayer: { textAlign: "center" },
matchPreviewName: { display: "block", fontSize: 15, fontWeight: 700 },
matchPreviewTarget: { display: "block", fontSize: 20, fontWeight: 800, color: "#c4b5fd", marginTop: 4 },
matchVs: { fontSize: 11, color: "#52525b", fontWeight: 600 },
winnerSelect: { display: "flex", gap: 8, marginTop: 4 },
winnerBtn: {
flex: 1,
padding: "10px",
background: "#18181b",
border: "1px solid #3f3f46",
borderRadius: 6,
color: "#a1a1aa",
fontSize: 13,
cursor: "pointer",
fontFamily: "inherit",
fontWeight: 600,
transition: "background 0.15s, border-color 0.15s, color 0.15s",
},
winnerBtnHover: {
borderColor: "#52525b",
background: "#1c1c1f",
color: "#d4d4d8",
},
winnerBtnActive: {
borderColor: "#4ade80",
background: "#052e16",
color: "#4ade80",
},
previewCalc: {
background: "#18181b",
border: "1px solid #27272a",
borderRadius: 8,
padding: 14,
marginTop: 16,
},
previewRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
previewLabel: { fontSize: 11, color: "#71717a" },
previewVal: { fontSize: 12, fontWeight: 600, color: "#e4e4e7" },
errorText: { fontSize: 12, color: "#f87171" },
historyCard: {
background: "#18181b",
border: "1px solid #27272a",
borderRadius: 8,
padding: 14,
marginBottom: 8,
},
historyDate: { fontSize: 10, color: "#52525b", marginBottom: 6 },
historyResult: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
historyWinner: { fontSize: 14, fontWeight: 700, color: "#4ade80" },
historyLoser: { fontSize: 14, fontWeight: 600, color: "#f87171" },
historyScore: { fontSize: 12, color: "#71717a", fontWeight: 600 },
historyVs: { fontSize: 11, color: "#52525b" },
historyDelta: { fontSize: 10, color: "#52525b", marginTop: 6 },
};

window.__JSX_APPLET__ = App;