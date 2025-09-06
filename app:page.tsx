// app/page.tsx
"use client";

import { useMemo, useState } from "react";

/* ---------------------------
   Utilities + formulas
----------------------------*/
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

// Relative intensity from delta to Vmax (smooth logistic)
function riFromDeltaV(delta: number) {
  const ri = 0.35 + 0.75 / (1 + Math.exp(delta - 1.5));
  return clamp(ri, 0, 1.15);
}

// Freshness factor from rest since last climb (days).
// Heuristic: 0d → 0.85x, +0.02/day up to 10d → ~1.05x cap.
function restFreshness(days: number) {
  const f = 0.85 + 0.02 * Math.min(Math.max(days, 0), 10);
  return clamp(f, 0.75, 1.1);
}

// Density factor from total TUT vs. total rest within bouldering section
// DF = ( TUT_total / (TUT_total + total_rest) ) ^ densityExp
function densityFactor(totalTUTs: number, totalRest: number, densityExp = 0.5) {
  const ratio = totalTUTs / Math.max(1, totalTUTs + totalRest);
  return Math.pow(ratio, densityExp);
}

// Fatigue/novelty weight for climb i (1-indexed). 0 disables decay.
// w_i = exp(-fatigueRate * (i-1))
function climbWeight(i: number, fatigueRate: number) {
  if (fatigueRate <= 0) return 1;
  return Math.exp(-fatigueRate * (i - 1));
}

/* ---------------------------
   Bouldering with time-per-climb
----------------------------*/
type Climb = { grade: number; tutSec: number };

function boulderingTLI(params: {
  vMax: number;
  restDays: number;
  avgRestBetweenClimbsSec: number;
  densityExp: number;
  useDensity: boolean;
  fatigueRate: number; // e.g. 0.02; set 0 to disable
  climbs: Climb[];
}) {
  const {
    vMax,
    restDays,
    avgRestBetweenClimbsSec,
    densityExp,
    useDensity,
    fatigueRate,
    climbs,
  } = params;

  const totalClimbs = climbs.length;
  const totalTUT = climbs.reduce((a, c) => a + Math.max(0, c.tutSec), 0);
  const totalRestWithin = Math.max(0, (totalClimbs - 1) * Math.max(0, avgRestBetweenClimbsSec));

  const FR = restFreshness(restDays);
  const DF = useDensity ? densityFactor(totalTUT, totalRestWithin, densityExp) : 1;

  const sum = climbs.reduce((acc, c, idx) => {
    const delta = vMax - c.grade;
    const ri = riFromDeltaV(delta);
    const w = climbWeight(idx + 1, fatigueRate);
    return acc + ri * c.tutSec * w;
  }, 0);

  return {
    TLI_boulder: FR * DF * sum,
    meta: { totalTUT, totalRestWithin, FR, DF },
  };
}

/* ---------------------------
   Hangboard (single row model)
----------------------------*/
function relEdge(edgeMM: number, k = 0.45) {
  return Math.pow(20 / edgeMM, k);
}
function gripMult(grip: "open" | "half" | "full") {
  return grip === "full" ? 1.1 : grip === "open" ? 0.85 : 1.0;
}

function hangboardSetTLI(row: {
  bodyKg: number;
  addedKg: number; // negative for assistance
  edgeMM: number;
  grip: "open" | "half" | "full";
  durationSec: number;
  reps: number;
  restBetweenRepsSec: number;
  mvc20kg?: number; // optional calibration; if undefined, estimate as body+20
  densityExpHB: number; // default 0.5
  kEdgeExp: number; // default 0.45
}) {
  const mvc20 = row.mvc20kg ?? row.bodyKg + 20;
  const mvcEdge = mvc20 * relEdge(row.edgeMM, row.kEdgeExp) * gripMult(row.grip);
  const ri = clamp((row.bodyKg + row.addedKg) / mvcEdge, 0, 1.2);
  const TUT = row.durationSec * row.reps;
  const totalRest = row.restBetweenRepsSec * Math.max(0, row.reps - 1);
  const DF = Math.pow(TUT / Math.max(1, TUT + totalRest), row.densityExpHB);
  return { perSet: ri * TUT * DF, TUT, totalRest, DF };
}

/* ---------------------------
   Page
----------------------------*/
export default function Page() {
  // High-contrast, legible defaults
  const pageStyle: React.CSSProperties = {
    maxWidth: 980,
    margin: "0 auto",
    padding: "28px",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
    color: "#0b0f19",
    background: "#fafafa",
  };

  /* -------- Bouldering state -------- */
  const [vMax, setVMax] = useState(8); // V8
  const [restDays, setRestDays] = useState(2);
  const [avgRestBetweenClimbsSec, setAvgRestBetweenClimbsSec] = useState(90); // avg rest between climbs (s)
  const [densityExp, setDensityExp] = useState(0.5);
  const [useDensity, setUseDensity] = useState(true);
  const [fatigueRate, setFatigueRate] = useState(0.02); // ~2% decay per climb; 0 disables
  const [climbs, setClimbs] = useState<Climb[]>([
    { grade: 6, tutSec: 25 },
    { grade: 7, tutSec: 30 },
    { grade: 8, tutSec: 35 },
  ]);

  /* -------- Hangboard (single row) -------- */
  const [hb, setHb] = useState({
    bodyKg: 70,
    addedKg: 10,
    edgeMM: 15,
    grip: "half" as "open" | "half" | "full",
    durationSec: 10,
    reps: 5,
    restBetweenRepsSec: 0,
    mvc20kg: undefined as number | undefined,
    densityExpHB: 0.5,
    kEdgeExp: 0.45,
    sets: 3,
  });

  /* -------- 4-week average (for comparison) -------- */
  const [avg28d, setAvg28d] = useState(1200);

  /* -------- Calculations -------- */
  const { TLI_boulder, meta } = useMemo(
    () =>
      boulderingTLI({
        vMax,
        restDays,
        avgRestBetweenClimbsSec,
        densityExp,
        useDensity,
        fatigueRate,
        climbs,
      }),
    [vMax, restDays, avgRestBetweenClimbsSec, densityExp, useDensity, fatigueRate, climbs]
  );

  const hbCalc = useMemo(() => hangboardSetTLI(hb), [hb]);
  const TLI_hangboard = hbCalc.perSet * hb.sets;
  const TLI_total = TLI_boulder + TLI_hangboard;
  const ratioToAvg = avg28d > 0 ? TLI_total / avg28d : 1;
  const spikeWarn = avg28d > 0 && TLI_total > 1.4 * avg28d;

  // Recommendation: rest days suggestion based on ratio to average and absolute TLI
  const recRestDays = recommendRestDays(TLI_total, ratioToAvg);

  // Per-climb weights (for explanation preview)
  const w1 = climbWeight(1, fatigueRate);
  const w20 = climbWeight(20, fatigueRate);

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 6 }}>
        Climbing Tendon Load — Time-per-Climb
      </h1>
      <p style={{ color: "#1f2937", marginBottom: 20, lineHeight: 1.55 }}>
        This calculator estimates <strong>Tendon Load Index (TLI)</strong> for your session using{" "}
        <em>relative intensity × time under tension</em> and accounts for <em>density</em> and a small{" "}
        <em>per-climb fatigue/novelty</em> effect. Earlier climbs can count slightly more than later ones.
      </p>

      {/* How metrics work */}
      <section style={cardStyle}>
        <h2 style={h2Style}>What these numbers mean</h2>
        <ul style={ulStyle}>
          <li>
            <strong>TLI (RI·seconds)</strong> = sum over climbs/sets of{" "}
            <em>Relative Intensity (RI)</em> × <em>Time Under Tension (TUT)</em>.
          </li>
          <li>
            <strong>RI (boulders)</strong> comes from how each climb’s grade compares to your recent max (smooth curve).
          </li>
          <li>
            <strong>Per-climb impact</strong>: we apply a small decay per climb:{" "}
            <code>wᵢ = exp(−fatigueRate × (i−1))</code>. With fatigueRate={fatigueRate.toFixed(3)}, the 1st climb weighs{" "}
            {w1.toFixed(2)}× and the 20th weighs {w20.toFixed(2)}×. Set fatigueRate to 0 to disable.
          </li>
          <li>
            <strong>Density factor (bouldering)</strong>:{" "}
            <code>DF = (TUT_total / (TUT_total + total_rest))^exp</code>. More rest lowers density (and load). We derive{" "}
            <code>total_rest ≈ avgRestBetweenClimbs × (nClimbs−1)</code>.
          </li>
          <li>
            <strong>Rest since last climb</strong>: nudges capacity via a freshness factor (0.85× → ~1.05×).
          </li>
          <li>
            <strong>Spike warning</strong>: flags if today &gt; 40% above your 4-week average.
          </li>
        </ul>
      </section>

      {/* Bouldering */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Bouldering — time per climb</h2>

        <div style={grid3}>
          <LabeledNumber label="Your recent max grade (V-scale)" value={vMax} step={0.5} onChange={setVMax} />
          <LabeledNumber
            label="Rest since last climb (days)"
            helper="Affects a mild 'freshness' factor"
            value={restDays}
            min={0}
            step={1}
            onChange={setRestDays}
          />
          <LabeledNumber
            label="Avg rest between climbs (s)"
            helper="Used for density factor"
            value={avgRestBetweenClimbsSec}
            min={0}
            step={5}
            onChange={setAvgRestBetweenClimbsSec}
          />
        </div>

        <div style={grid3}>
          <LabeledNumber
            label="Density exponent"
            helper="0 = ignore density; 0.5 = moderate; 1 = strong"
            value={densityExp}
            min={0}
            max={1}
            step={0.05}
            onChange={setDensityExp}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={useDensity}
              onChange={(e) => setUseDensity(e.target.checked)}
              aria-label="Use density factor"
            />
            Use density factor
          </label>
          <LabeledNumber
            label="Fatigue/novelty decay"
            helper="Per-climb rate; 0 disables (e.g., 0.02)"
            value={fatigueRate}
            min={0}
            max={0.1}
            step={0.005}
            onChange={setFatigueRate}
          />
        </div>

        <h3 style={h3Style}>Climbs (grade + TUT seconds)</h3>
        {climbs.map((c, i) => (
          <div key={i} style={rowClimb}>
            <LabeledNumber
              label={`Grade V${c.grade}`}
              value={c.grade}
              step={0.5}
              onChange={(n) => setClimbs((prev) => prev.map((x, idx) => (idx === i ? { ...x, grade: n } : x)))}
            />
            <LabeledNumber
              label="TUT (s)"
              value={c.tutSec}
              min={0}
              step={1}
              onChange={(n) => setClimbs((prev) => prev.map((x, idx) => (idx === i ? { ...x, tutSec: n } : x)))}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setClimbs((prev) => prev.filter((_, idx) => idx !== i))}
                style={buttonGhost}
              >
                Remove
              </button>
              <button
                onClick={() => setClimbs((prev) => {
                  const row = prev[i];
                  return [...prev.slice(0, i + 1), { ...row }, ...prev.slice(i + 1)];
                })}
                style={button}
              >
                Duplicate
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => setClimbs((prev) => [...prev, { grade: 6, tutSec: 20 }])} style={button}>
          + Add climb
        </button>

        <div style={{ marginTop: 12, lineHeight: 1.5 }}>
          <ResultLine label="Total TUT (s)" value={meta.totalTUT} />
          <ResultLine label="Total rest (s)" value={meta.totalRestWithin} />
          <ResultLine label="Freshness factor" value={meta.FR} />
          <ResultLine label={`Density factor${useDensity ? "" : " (disabled)"}`} value={useDensity ? meta.DF : 1} />
          <ResultLine label="Bouldering TLI" value={TLI_boulder} />
        </div>
      </section>

      {/* Hangboard */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Hangboard (single row × sets)</h2>
        <p style={pHelp}>
          We estimate RI from your body+added weight versus an edge/grip-specific MVC. If unknown, MVC(20mm, half) is
          approximated as <em>body mass + 20 kg</em>.
        </p>
        <div style={grid3}>
          <LabeledNumber label="Body (kg)" value={hb.bodyKg} onChange={(n) => setHb({ ...hb, bodyKg: n })} />
          <LabeledNumber label="Added (kg)" value={hb.addedKg} onChange={(n) => setHb({ ...hb, addedKg: n })} />
          <LabeledNumber label="Edge (mm)" value={hb.edgeMM} onChange={(n) => setHb({ ...hb, edgeMM: n })} />
          <LabeledSelect
            label="Grip"
            value={hb.grip}
            options={["open", "half", "full"]}
            onChange={(v) => setHb({ ...hb, grip: v as any })}
          />
          <LabeledNumber label="Hang (s)" value={hb.durationSec} onChange={(n) => setHb({ ...hb, durationSec: n })} />
          <LabeledNumber label="Reps" value={hb.reps} min={1} step={1} onChange={(n) => setHb({ ...hb, reps: n })} />
          <LabeledNumber
            label="Rest between reps (s)"
            value={hb.restBetweenRepsSec}
            onChange={(n) => setHb({ ...hb, restBetweenRepsSec: n })}
          />
          <LabeledNumber
            label="MVC 20mm (kg, optional)"
            value={hb.mvc20kg ?? 0}
            helper="Leave 0 to auto-estimate (body+20)"
            onChange={(n) => setHb({ ...hb, mvc20kg: n > 0 ? n : undefined })}
          />
          <LabeledNumber
            label="Edge exponent k"
            value={hb.kEdgeExp}
            step={0.05}
            helper="Edge scaling sensitivity (0.35–0.55 typical)"
            onChange={(n) => setHb({ ...hb, kEdgeExp: n })}
          />
          <LabeledNumber
            label="Density exponent"
            value={hb.densityExpHB}
            step={0.05}
            helper="How much intra-set rest reduces load"
            onChange={(n) => setHb({ ...hb, densityExpHB: n })}
          />
          <LabeledNumber
            label="Sets"
            value={hb.sets}
            min={1}
            step={1}
            onChange={(n) => setHb({ ...hb, sets: Math.max(1, Math.round(n)) })}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <ResultLine label="TLI per set" value={hbCalc.perSet} />
          <ResultLine label={`Hangboard TLI × ${hb.sets} sets`} value={TLI_hangboard} />
        </div>
      </section>

      {/* Session totals + Recommendations */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Session</h2>
        <div style={grid2}>
          <ResultLine label="Bouldering TLI" value={TLI_boulder} />
          <ResultLine label="Hangboard TLI" value={TLI_hangboard} />
        </div>
        <ResultLine label="Total TLI (RI·s)" value={TLI_total} big />

        <div style={grid2}>
          <LabeledNumber
            label="Your 4-week avg TLI (manual)"
            value={avg28d}
            onChange={setAvg28d}
            helper="Used for spike/ratio comparisons"
          />
          <div style={{ alignSelf: "end" }}>
            {avg28d > 0 && (
              <Badge
                variant={spikeWarn ? "warn" : "ok"}
                text={spikeWarn ? "Spike: > 40% above 4-wk avg" : "Within typical range"}
              />
            )}
          </div>
        </div>

        <div style={recBox}>
          <h3 style={{ ...h3Style, marginTop: 0 }}>Recommendation</h3>
          <p style={pHelp}>
            Today is <strong>{(ratioToAvg * 100).toFixed(0)}%</strong> of your typical day (4-wk avg = {avg28d} RI·s).
            Suggested rest before next hard finger session:{" "}
            <strong>{recRestDays.min}–{recRestDays.max} days</strong>.
          </p>
          <ul style={ulStyle}>
            <li>
              If you feel lingering soreness or morning stiffness &gt; 24 h, push to the upper end of that range and
              bias to open/half-crimp next time.
            </li>
            <li>
              Keep intra-session rests honest: density factor right now is{" "}
              <strong>{(meta.DF ?? 1).toFixed(2)}</strong> — longer rests lower DF and total load.
            </li>
            <li>
              Earlier climbs weighed slightly more than later ones (fatigue rate {fatigueRate}). First climb weight{" "}
              <strong>{climbWeight(1, fatigueRate).toFixed(2)}×</strong>, 20th{" "}
              <strong>{climbWeight(20, fatigueRate).toFixed(2)}×</strong>.
            </li>
          </ul>
        </div>
      </section>

      <footer style={{ color: "#111827", fontSize: 12, marginTop: 24 }}>
        v0.2 — time-per-climb, density explained, fatigue weighting, and actionable recommendations.
      </footer>
    </main>
  );
}

/* ---------------------------
   Recommendation helper
----------------------------*/
function recommendRestDays(TLI_total: number, ratioToAvg: number) {
  // Simple heuristic blending absolute load and ratio to avg.
  // Anchor: avg day → ~1 rest day; heavy → 2–3; light → 0–1.
  let min = 1;
  let max = 1;

  if (ratioToAvg < 0.8) {
    min = 0;
    max = 1;
  } else if (ratioToAvg < 1.2) {
    min = 1;
    max = 1;
  } else if (ratioToAvg < 1.6) {
    min = 1;
    max = 2;
  } else {
    min = 2;
    max = 3;
  }

  // Nudge by absolute magnitude (very small sessions → allow 0 days)
  if (TLI_total < 500) {
    min = 0;
  }
  return { min, max };
}

/* ---------------------------
   Tiny UI primitives (high contrast)
----------------------------*/
const cardStyle: React.CSSProperties = {
  border: "1px solid #111827",
  borderRadius: 12,
  padding: 18,
  marginBottom: 18,
  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  background: "#ffffff",
};
const recBox: React.CSSProperties = {
  border: "2px solid #111827",
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  background: "#f8fafc",
};
const h2Style: React.CSSProperties = { fontSize: 22, fontWeight: 800, marginBottom: 10 };
const h3Style: React.CSSProperties = { fontSize: 16, fontWeight: 800, margin: "12px 0 8px" };
const pHelp: React.CSSProperties = { color: "#0b0f19", marginTop: 6, marginBottom: 10, lineHeight: 1.5, fontSize: 14 };
const ulStyle: React.CSSProperties = { margin: "6px 0 0 18px", lineHeight: 1.55, fontSize: 14 };

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  alignItems: "end",
};
const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  alignItems: "end",
};
const rowClimb: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto",
  gap: 8,
  alignItems: "end",
  marginBottom: 8,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "2px solid #111827",
  fontSize: 14,
  color: "#0b0f19",
  background: "#fff",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, color: "#0b0f19", marginBottom: 6, fontWeight: 800 };
const helperStyle: React.CSSProperties = { fontSize: 12, color: "#0b0f19" };
const button: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "2px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
};
const buttonGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "2px solid #111827",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
};

function LabeledNumber(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  helper?: string;
}) {
  const { label, value, onChange, min, max, step, helper } = props;
  return (
    <label>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 0.1}
        onChange={(e) => onChange(Number(e.target.value))}
        style={inputStyle}
      />
      {helper && <div style={helperStyle}>{helper}</div>}
    </label>
  );
}

function LabeledSelect(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <label>
      <span style={labelStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultLine({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, alignItems: "baseline" }}>
      <div style={{ color: "#0b0f19", fontWeight: 800 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: big ? 26 : 18 }}>{Number(value.toFixed(1))}</div>
    </div>
  );
}

function Badge({ text, variant }: { text: string; variant: "ok" | "warn" }) {
  const color = variant === "warn" ? "#7c2d12" : "#065f46";
  const bg = variant === "warn" ? "#fef3c7" : "#d1fae5";
  const border = variant === "warn" ? "#f59e0b" : "#34d399";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        border: `2px solid ${border}`,
        background: bg,
        color,
        fontWeight: 900,
        fontSize: 12,
      }}
    >
      {text}
    </span>
  );
}
