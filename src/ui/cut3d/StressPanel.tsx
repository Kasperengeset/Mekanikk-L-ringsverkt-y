/**
 * Spenningene i snittet i 2D, slik læreboka tegner dem: tverrsnittet, σ-diagrammet (lineært) og
 * τ-diagrammet (skjærspenningsfordelingen), med samme høydeakse. Ren komponent (ingen store).
 *
 * Tallene vises bare når tverrsnittet står i oppgaven og oppgaven har tall (ikke symboler), og når
 * studenten har prøvd seg på snittkreftene (samme regel som diagrammene).
 */
import type { CutForces } from "../../core/cut.js";
import type { Section } from "../../core/schema.js";
import { stressProfile, type SectionGeometry, type StressProfile } from "../../core/stress.js";
import { formatNumber } from "../format.js";

const H = 150;
const PAD = { top: 26, bottom: 30 };
const W = 176;

export interface StressPanelProps {
  section: Section | undefined;
  forces: CutForces;
  truss: boolean;
  /** Tallene for σ (N eller M) og τ (V) er skjult. */
  sigmaHidden: boolean;
  tauHidden: boolean;
  /** Oppgaven er symbolsk: tall i MPa gir ikke mening. */
  symbolic: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function formatStress(pa: number): string {
  return `${formatNumber(Math.abs(pa) / 1e6, 3)} MPa`;
}

/** Areal og arealmoment i cm (eller m for svært store tverrsnitt). */
function formatSectionProperties(A: number, I: number): string {
  if (A >= 0.1) return `A = ${formatNumber(A)} m², I = ${formatNumber(I)} m⁴`;
  return `A = ${formatNumber(A * 1e4)} cm², I = ${formatNumber(I * 1e8)} cm⁴`;
}

export function StressPanel({ section, forces, truss, sigmaHidden, tauHidden, symbolic }: StressPanelProps) {
  const profile = stressProfile(section, forces);
  const g = profile.geometry;
  const quantitative = !g.assumed && !symbolic;
  // Samme høydeakse i alle tre figurene; et bredt tverrsnitt gjør figurene lavere.
  const height = Math.min(H, ((W - 40) * (g.top - g.bottom)) / g.width);
  const y0 = PAD.top + (H - height) / 2;
  const yOf = (y: number) => y0 + ((g.top - y) / (g.top - g.bottom)) * height;
  const sigmaText = (v: number) => (!quantitative ? "" : sigmaHidden ? "?" : `${formatStress(v)}${Math.abs(v) < 1e-9 ? "" : v > 0 ? " strekk" : " trykk"}`);
  const tauText = (v: number) => (!quantitative ? "" : tauHidden ? "?" : formatStress(v));
  return (
    <div className="c3-stress">
      <div className="c3-stress-figures">
        <figure>
          <figcaption>Tverrsnitt</figcaption>
          <SectionSvg geometry={g} profile={profile} yOf={yOf} />
        </figure>
        <figure>
          <figcaption>σ – normalspenning</figcaption>
          <SigmaSvg profile={profile} yOf={yOf} top={sigmaText(profile.sigmaTop)} bottom={sigmaText(profile.sigmaBottom)} />
        </figure>
        <figure>
          <figcaption>τ – skjærspenning</figcaption>
          {truss ? <p className="c3-stress-empty muted">En stav har ingen skjærkraft, så τ = 0.</p> : <TauSvg profile={profile} yOf={yOf} text={tauText(profile.tauMax.value)} />}
        </figure>
      </div>
      <p className="c3-stress-note muted">
        σ = N/A ± M·y/I og τ = V·S/(I·b), med y fra arealsenteret.
        {quantitative && ` ${formatSectionProperties(profile.A, profile.I)}.`}
        {!quantitative &&
          (symbolic
            ? " Oppgaven er symbolsk, så figuren viser bare formen på spenningene."
            : " Tverrsnittet står ikke i oppgaven, så figuren viser bare formen på spenningene, med et rektangel som eksempel.")}
      </p>
    </div>
  );
}

function SectionSvg({ geometry: g, profile, yOf }: { geometry: SectionGeometry; profile: StressProfile; yOf: (y: number) => number }) {
  const scale = (yOf(g.bottom) - yOf(g.top)) / (g.top - g.bottom);
  const cx = W / 2;
  const cy = yOf(0);
  const Y = (y: number) => cy - y * scale;
  const neutral = profile.neutralAxis;
  return (
    <svg viewBox={`0 0 ${W} ${H + PAD.top + PAD.bottom}`} className="c3-stress-svg" aria-hidden="true">
      {g.kind === "circle" ? (
        <>
          <circle cx={cx} cy={cy} r={r1(g.R * scale)} className="c3-section" />
          {g.r > 0 && <circle cx={cx} cy={cy} r={r1(g.r * scale)} className="c3-section-hole" />}
        </>
      ) : (
        g.rects.map((r, i) => <rect key={i} x={r1(cx + r.z0 * scale)} y={r1(Y(r.y1))} width={r1((r.z1 - r.z0) * scale)} height={r1((r.y1 - r.y0) * scale)} className="c3-section" />)
      )}
      <line x1={6} x2={W - 6} y1={r1(cy)} y2={r1(cy)} className="c3-axis-centroid" />
      <text x={W - 6} y={r1(cy - 4)} textAnchor="end" className="c3-axis-text">
        arealsenter
      </text>
      {neutral !== undefined && Math.abs(neutral) > 1e-6 * (g.top - g.bottom) && <line x1={6} x2={W - 6} y1={r1(Y(neutral))} y2={r1(Y(neutral))} className="c3-axis-neutral" />}
    </svg>
  );
}

function SigmaSvg({ profile, yOf, top, bottom }: { profile: StressProfile; yOf: (y: number) => number; top: string; bottom: string }) {
  const max = Math.max(...profile.samples.map((s) => Math.abs(s.sigma)), 1e-300);
  const x0 = W / 2;
  const sx = (W / 2 - 14) / max;
  const pts = profile.samples.map((s) => `${r1(x0 + s.sigma * sx)},${r1(yOf(s.y))}`);
  const g = profile.geometry;
  // Punktene går fra underkant til overkant.
  const area = `M${x0},${r1(yOf(g.bottom))}L${pts.join("L")}L${x0},${r1(yOf(g.top))}Z`;
  const neutral = profile.neutralAxis;
  // Strekk og trykk fargelegges hver for seg: klipp ved nøytralaksen.
  const split = neutral !== undefined ? yOf(neutral) : undefined;
  const topTension = profile.sigmaTop >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H + PAD.top + PAD.bottom}`} className="c3-stress-svg" aria-hidden="true">
      <defs>
        <clipPath id="c3-clip-upper">
          <rect x={0} y={0} width={W} height={split ?? H + PAD.top + PAD.bottom} />
        </clipPath>
        <clipPath id="c3-clip-lower">
          <rect x={0} y={split ?? 0} width={W} height={H + PAD.top + PAD.bottom} />
        </clipPath>
      </defs>
      <path d={area} className={topTension ? "c3-fill-tension" : "c3-fill-compression"} clipPath="url(#c3-clip-upper)" />
      {split !== undefined && <path d={area} className={topTension ? "c3-fill-compression" : "c3-fill-tension"} clipPath="url(#c3-clip-lower)" />}
      <path d={`M${pts.join("L")}`} className="c3-curve" />
      <line x1={x0} x2={x0} y1={r1(yOf(g.top) - 8)} y2={r1(yOf(g.bottom) + 8)} className="c3-axis" />
      <text x={W / 2} y={r1(yOf(g.top) - 10)} textAnchor="middle" className="c3-value-text">
        {top}
      </text>
      <text x={W / 2} y={r1(yOf(g.bottom) + 20)} textAnchor="middle" className="c3-value-text">
        {bottom}
      </text>
    </svg>
  );
}

function TauSvg({ profile, yOf, text }: { profile: StressProfile; yOf: (y: number) => number; text: string }) {
  const max = Math.max(...profile.samples.map((s) => Math.abs(s.tau)), 1e-300);
  const x0 = 22;
  const sx = (W - x0 - 26) / max;
  const g = profile.geometry;
  const pts = profile.samples.map((s) => `${r1(x0 + Math.abs(s.tau) * sx)},${r1(yOf(s.y))}`);
  const at = profile.tauMax;
  return (
    <svg viewBox={`0 0 ${W} ${H + PAD.top + PAD.bottom}`} className="c3-stress-svg" aria-hidden="true">
      <path d={`M${x0},${r1(yOf(g.bottom))}L${pts.join("L")}L${x0},${r1(yOf(g.top))}Z`} className="c3-fill-tau" />
      <path d={`M${pts.join("L")}`} className="c3-curve c3-curve-tau" />
      <line x1={x0} x2={x0} y1={r1(yOf(g.top) - 8)} y2={r1(yOf(g.bottom) + 8)} className="c3-axis" />
      {text && (
        <text x={r1(Math.min(x0 + Math.abs(at.value) * sx + 4, W - 4))} y={r1(yOf(at.y) - 6)} textAnchor="end" className="c3-value-text">
          {text}
        </text>
      )}
    </svg>
  );
}
