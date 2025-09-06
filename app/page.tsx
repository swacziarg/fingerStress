// app/page.tsx
"use client";

import { useMemo, useState } from "react";

/* ---------------------------
   Minimal formulas (inline)
----------------------------*/
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

// Relative intensity from delta to Vmax (smooth logistic)
function riFromDeltaV(delta: number) {
  const ri = 0.35 + 0.75 / (1 + Math.exp(delta - 1.5));
  return clamp(ri, 0, 1.15);
}

// Bouldering TLI
function boulderingTLI(params: {
  vMax: number;
  totalMinutes: number;
  workRestRatio: number; // R = work/rest (0.5 means 1:2)
  gradeFractions: { grade: number; fraction: number }[];
  useDensity: boolean;
}) {
  const { vMax, totalMinutes, workRestRatio, gradeFractions, useDensity } = params;
  const fw = workRestRatio / (1 + workRestRatio);
  const Tw = totalMinutes * 60 * fw; // seconds of work
  const DF = useDensity ? Math.pow(fw, 0.5) : 1;

  return DF * gradeFractions.reduce((acc, g) => {
    const delta = vMax - g.grade;
    const ri = riFromDeltaV(delta);
    return acc + ri * (Tw * g.fraction);
  }, 0);
}

// Hangboard helpers
function relEdge(edgeMM: number, k = 0.45) {
  return Math.pow(20 / edgeMM, k);
}
function gripMult(grip: "open" | "half" | "full") {
  return grip === "full" ? 1.1 : grip === "open" ? 0.85 : 1.0;
}

// Hangboard TLI (single row)
function hangboardSetTLI(row: {
  bodyKg: number;
  addedKg: number; // negative allowed for assistance
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
  return ri * TUT * DF;
}

/* ---------------------------
   Page (minimal shell)
----------------------------*/
export default function Page() {
  // --- Bouldering state (tiny defaults)
  const [vMax, setVMax] = useState(8); // V8
  const [totalMinutes, setTotalMinutes] = useState(90);
  const [workRestRatio, setWorkRestRatio] = useState(0.5); // 1:2 projecting
  const [useDensity, setUseDensity] = useState(false);
  const [gradeFractions, setGradeFractions] = useState([
    { grade: 6, fraction: 0.4 },
    { grade: 7, fraction: 0.4 },
    { grade: 8, fraction: 0.2 },
  ]);

  // --- Hangboard (single row to keep v1 tiny)
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

  // --- 4-week average (manual input for now)
  const [avg28d, setAvg28d] = useState(1200);

  // --- Calculations
  const TLI_boulder = useMemo(
    () =>
      boulderingTLI({
        vMax,
        totalMinutes,
        workRestRatio,
        gradeFractions: normalizeFractions(gradeFractions),
        useDensity,
      }),
    [vMax, totalMinutes, workRestRatio, gradeFractions, useDensity]
  );

  const TLI_hb_set = useMemo(() => hangboardSetTLI(hb), [hb]);
  const TLI_hangboard = TLI_hb_set * hb.sets;
  const TLI_total = TLI_boulder + TLI_hangboard;
  const spikeWarn = avg28d > 0 && TLI_total > 1.4 * avg28d;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Climbing Tendon Load — Minimal Calculator
      </h1>
      <p style={{ color: "#444", marginBottom: 24 }}>
        Enter a few details for today’s bouldering and a single hangboard set. Values update live.
      </p>

      {/* Bouldering card */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Bouldering</h2>
        <div style={grid2}>
          <LabeledNumber
            label="Your recent max grade (V-scale)"
            value={vMax}
            step={0.5}
            onChange={(n) => setVMax(n)}
          />
          <LabeledNumber
            label="Total session time (min)"
            value={totalMinutes}
            min={0}
            onChange={(n) => setTotalMinutes(n)}
          />
          <LabeledNumber
            label="Work:Rest ratio R (work/rest)"
            helper="Example: 0.5 = 1:2, 1 = 1:1, 2 = 2:1"
            value={workRestRatio}
            min={0}
            step={0.1}
            onChange={(n) => setWorkRestRatio(n)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={useDensity}
              onChange={(e) => setUseDensity(e.target.checked)}
            />
            Use density factor (fw^0.5)
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 style={h3Style}>Grade distribution (fractions sum to 1.0)</h3>
          {gradeFractions.map((row, i) => (
            <div key={i} style={rowStyle}>
              <LabeledNumber
                label={`Grade V${row.grade}`}
                value={row.grade}
                step={0.5}
                onChange={(n) =>
                  setGradeFractions((prev) =>
                    prev.map((r, idx) => (idx === i ? { ...r, grade: n } : r))
                  )
                }
              />
              <LabeledNumber
                label="Fraction"
                value={row.fraction}
                min={0}
                max={1}
                step={0.05}
                onChange={(n) =>
                  setGradeFractions((prev) =>
                    prev.map((r, idx) => (idx === i ? { ...r, fraction: n } : r))
                  )
                }
              />
              <button
                onClick={() =>
                  setGradeFractions((prev) => prev.filter((_, idx) => idx !== i))
                }
                style={buttonGhost}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setGradeFractions((prev) => [...prev, { grade: 6, fraction: 0 }])
            }
            style={button}
          >
            + Add grade row
          </button>
          <p style={{ marginTop: 8, color: "#666" }}>
            Sum: {sumFractions(gradeFractions).toFixed(2)} (auto-normalized in calc)
          </p>
        </div>

        <ResultLine label="Bouldering TLI" value={TLI_boulder} />
      </section>

      {/* Hangboard card */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Hangboard (single row × sets)</h2>
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
            onChange={(n) => setHb({ ...hb, kEdgeExp: n })}
          />
          <LabeledNumber
            label="Density exponent"
            value={hb.densityExpHB}
            step={0.05}
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

        <ResultLine label="TLI per set" value={TLI_hb_set} />
        <ResultLine label={`Hangboard TLI × ${hb.sets} sets`} value={TLI_hangboard} />
      </section>

      {/* Session totals */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Session</h2>
        <div style={grid2}>
          <ResultLine label="Bouldering TLI" value={TLI_boulder} />
          <ResultLine label="Hangboard TLI" value={TLI_hangboard} />
        </div>
        <ResultLine label="Total TLI" value={TLI_total} big />
        <div style={grid2}>
          <LabeledNumber
            label="Your 4-week avg TLI (manual)"
            value={avg28d}
            onChange={(n) => setAvg28d(n)}
          />
          <div style={{ alignSelf: "end" }}>
            {avg28d > 0 && (
              <Badge
                variant={spikeWarn ? "warn" : "ok"}
                text={spikeWarn ? "Spike > 40% above 4-wk avg" : "Within typical range"}
              />
            )}
          </div>
        </div>
        <p style={{ color: "#666", marginTop: 8, fontSize: 14 }}>
          Educational estimates only. If pain ≥ 3/10 or morning stiffness &gt; 24 h, reduce intensity 10–20% and prefer open/half crimp.
        </p>
      </section>

      <footer style={{ color: "#888", fontSize: 12, marginTop: 24 }}>
        v0 — single-file shell. Later: split formulas, add multiple HB rows, tests, and persistence.
      </footer>
    </main>
  );
}

/* ---------------------------
   Tiny UI primitives
----------------------------*/
function normalizeFractions(rows: { fraction: number }[]) {
  const s = rows.reduce((a, r) => a + (isFinite(r.fraction) ? r.fraction : 0), 0);
  const safe = s > 0 ? s : 1;
  return rows.map((r) => ({ ...r, fraction: r.fraction / safe }));
}
function sumFractions(rows: { fraction: number }[]) {
  return rows.reduce((a, r) => a + (isFinite(r.fraction) ? r.fraction : 0), 0);
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  background: "#fff",
};
const h2Style: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginBottom: 12 };
const h3Style: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: "12px 0 8px" };
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
const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto",
  gap: 8,
  alignItems: "end",
  marginBottom: 8,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", marginBottom: 6 };
const helperStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280" };
const button: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 600,
};
const buttonGhost: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 600,
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
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
      <div style={{ color: "#374151" }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: big ? 24 : 16 }}>{Number(value.toFixed(1))}</div>
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
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {text}
    </span>
  );
}
