/**
 * Kraftsystemet tegnet slik kurset gjør: kreftene som piler fra angrepspunktet, x mot høyre og z opp,
 * komponentene stiplet langs aksene og resultanten R som en tykk pil. Under: tabell med komponentene og
 * summene ΣFx = Rx og ΣFz = Rz. Ren komponent (ingen store), tallene kommer fra force_system.
 */
import { useState } from "react";
import type { ForceComponents, ForceSystemResult } from "../../core/forces.js";
import { formatNumber } from "../format.js";
import "./forces.css";

export interface ForceSystemViewProps {
  result: Pick<ForceSystemResult, "forces" | "resultant" | "moment" | "equilibrium">;
  forceUnit: string;
  lengthUnit?: string;
  width?: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => formatNumber(Math.abs(v) < 1e-9 ? 0 : v, 4);

function Arrow({ x1, y1, x2, y2, className, width = 2.4, dashed = false }: { x1: number; y1: number; x2: number; y2: number; className: string; width?: number; dashed?: boolean }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(12, len * 0.4);
  const half = head * 0.42;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  return (
    <g className={className}>
      <line x1={r1(x1)} y1={r1(y1)} x2={r1(bx)} y2={r1(by)} strokeWidth={width} strokeDasharray={dashed ? "5 4" : undefined} stroke="currentColor" />
      <polygon points={`${r1(x2)},${r1(y2)} ${r1(bx - uy * half)},${r1(by + ux * half)} ${r1(bx + uy * half)},${r1(by - ux * half)}`} fill="currentColor" />
    </g>
  );
}

/** Etikett like utenfor pilspissen, forankret bort fra pilen. */
function TipLabel({ x, y, ux, uy, text, className }: { x: number; y: number; ux: number; uy: number; text: string; className: string }) {
  const lx = x + ux * 10;
  const ly = y + uy * 10 + (uy > 0.3 ? 12 : uy < -0.3 ? -4 : 4);
  const anchor = ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle";
  return (
    <text x={r1(lx)} y={r1(ly)} textAnchor={anchor} className={`fs-label ${className}`}>
      {text}
    </text>
  );
}

export function ForceSystemView({ result, forceUnit, lengthUnit, width = 560 }: ForceSystemViewProps) {
  const [showComponents, setShowComponents] = useState(true);
  const [showResultant, setShowResultant] = useState(true);
  const W = Math.max(300, Math.min(width, 720));
  const H = Math.round(Math.min(380, W * 0.68));
  const cx = W / 2;
  const cy = H / 2;
  const { forces, resultant } = result;
  const max = Math.max(...forces.map((f) => f.magnitude), resultant.R, 1e-300);
  const reach = Math.min(W, H) * 0.36;
  const k = reach / max;
  const end = (Fx: number, Fz: number) => ({ x: cx + Fx * k, y: cy - Fz * k });
  const unitDir = (Fx: number, Fz: number) => {
    const L = Math.hypot(Fx, Fz) || 1;
    return { ux: Fx / L, uy: -Fz / L };
  };
  const label = (f: ForceComponents) => `${f.id} = ${fmt(f.magnitude)} ${forceUnit}`;

  return (
    <div className="fs">
      <div className="fs-toolbar" role="toolbar" aria-label="Visning">
        <button type="button" className="pill sm" aria-pressed={showComponents} onClick={() => setShowComponents((v) => !v)}>
          Komponenter
        </button>
        <button type="button" className="pill sm" aria-pressed={showResultant} onClick={() => setShowResultant((v) => !v)}>
          Resultant
        </button>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="fs-figure" role="img" aria-label={`Kraftsystem med ${forces.length} krefter og resultant ${fmt(resultant.R)} ${forceUnit}`}>
        <g className="fs-axes">
          <line x1={16} y1={cy} x2={W - 16} y2={cy} />
          <line x1={cx} y1={H - 12} x2={cx} y2={12} />
          <text x={W - 14} y={cy - 6} textAnchor="end">
            x
          </text>
          <text x={cx + 8} y={20}>
            z
          </text>
        </g>
        {showComponents &&
          forces.map((f) => {
            const p = end(f.Fx, f.Fz);
            return (
              <g key={`c-${f.id}`} className="fs-components">
                <line x1={r1(p.x)} y1={r1(p.y)} x2={r1(p.x)} y2={r1(cy)} className="fs-proj" />
                <line x1={r1(p.x)} y1={r1(p.y)} x2={r1(cx)} y2={r1(p.y)} className="fs-proj" />
                {Math.abs(f.Fx) * k > 6 && <Arrow x1={cx} y1={cy} x2={p.x} y2={cy} className="fs-comp" width={1.6} dashed />}
                {Math.abs(f.Fz) * k > 6 && <Arrow x1={cx} y1={cy} x2={cx} y2={p.y} className="fs-comp" width={1.6} dashed />}
              </g>
            );
          })}
        {forces.map((f) => {
          const p = end(f.Fx, f.Fz);
          const { ux, uy } = unitDir(f.Fx, f.Fz);
          return (
            <g key={f.id}>
              <Arrow x1={cx} y1={cy} x2={p.x} y2={p.y} className="fs-force" />
              <TipLabel x={p.x} y={p.y} ux={ux} uy={uy} text={label(f)} className="fs-force-label" />
            </g>
          );
        })}
        {showResultant && resultant.R > 0 && (
          <g>
            <Arrow x1={cx} y1={cy} x2={end(resultant.Rx, resultant.Rz).x} y2={end(resultant.Rx, resultant.Rz).y} className="fs-resultant" width={4} />
            <TipLabel
              x={end(resultant.Rx, resultant.Rz).x}
              y={end(resultant.Rx, resultant.Rz).y}
              {...unitDir(resultant.Rx, resultant.Rz)}
              text={`R = ${fmt(resultant.R)} ${forceUnit}`}
              className="fs-resultant-label"
            />
          </g>
        )}
        <circle cx={cx} cy={cy} r={4} className="fs-point" />
      </svg>
      <table className="fs-table">
        <thead>
          <tr>
            <th scope="col">Kraft</th>
            <th scope="col">x-komponent</th>
            <th scope="col">z-komponent</th>
            <th scope="col">Størrelse</th>
            <th scope="col">Vinkel fra +x</th>
          </tr>
        </thead>
        <tbody>
          {forces.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.id}</th>
              <td>
                {fmt(f.Fx)} {forceUnit}
              </td>
              <td>
                {fmt(f.Fz)} {forceUnit}
              </td>
              <td>
                {fmt(f.magnitude)} {forceUnit}
              </td>
              <td>{fmt(f.angle_deg)}°</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">R</th>
            <td>
              ΣFx = {fmt(resultant.Rx)} {forceUnit}
            </td>
            <td>
              ΣFz = {fmt(resultant.Rz)} {forceUnit}
            </td>
            <td>
              {fmt(resultant.R)} {forceUnit}
            </td>
            <td>{fmt(resultant.angle_deg)}°</td>
          </tr>
        </tfoot>
      </table>
      {result.moment && (
        <p className="fs-note">
          Moment om ({fmt(result.moment.about.x)}, {fmt(result.moment.about.z)}) {lengthUnit}: M = {fmt(result.moment.M)} {forceUnit}
          {lengthUnit} (mot klokka positivt).
        </p>
      )}
      <p className="fs-note muted">{result.equilibrium ? "Kreftene er i likevekt (R = 0)." : "R = √(Rx² + Rz²). Kreftene er ikke i likevekt."}</p>
    </div>
  );
}
