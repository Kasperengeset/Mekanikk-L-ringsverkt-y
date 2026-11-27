/**
 * Glidebryterne i store.controls (lagt til av agenten med add_control).
 *
 * Dra med pekeren er én operasjon: beginGesture ved pointerdown, updateGesture for hver verdi og
 * endGesture når pekeren slippes, så hele draget blir ett steg i angre-historikken. Piltaster gir
 * ett steg per trykk (edit). En verdi storen avviser, endrer ikke modellen; glidebryteren følger
 * modellen og hopper tilbake til siste gyldige verdi.
 */
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { getParam } from "../../core/edit.js";
import type { Model } from "../../core/schema.js";
import { formatNumber } from "../format.js";
import { useStore, type Control } from "../state/store.js";
import { paramUnit } from "./logic.js";

function withUnit(value: number, unit: string): string {
  const v = formatNumber(value);
  return unit === "°" ? `${v}°` : unit ? `${v} ${unit}` : v;
}

export function Controls({ model }: { model: Model }) {
  const controls = useStore((s) => s.controls);
  if (controls.length === 0) return null;
  return (
    <section className="card pd-controls" aria-labelledby="explore-title">
      <h2 id="explore-title" className="card-title">
        Utforsk
      </h2>
      {controls.map((c) => (
        <ControlSlider key={c.path} control={c} model={model} />
      ))}
    </section>
  );
}

function ControlSlider({ control, model }: { control: Control; model: Model }) {
  const id = useId();
  const removeControl = useStore((s) => s.removeControl);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const raw = getParam(model, control.path);
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  const unit = paramUnit(control.path, model);

  const end = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    useStore.getState().endGesture();
  }, []);

  // Fjernes glidebryteren midt i et drag, avsluttes draget.
  useEffect(
    () => () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      end();
    },
    [end],
  );

  const begin = () => {
    if (dragging.current || value === undefined) return;
    dragging.current = true;
    useStore.getState().beginGesture();
    // Pekeren kan slippes utenfor glidebryteren.
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    if (!Number.isFinite(next)) return;
    const { updateGesture, edit } = useStore.getState();
    const change = { path: control.path, value: next };
    const r = dragging.current ? updateGesture(change) : edit(change);
    setError(r.ok ? null : r.error);
  };

  return (
    <div className="pd-control">
      <div className="pd-control-head">
        <label htmlFor={id}>{control.label}</label>
        <output htmlFor={id} className="pd-control-value">
          {value === undefined ? "–" : withUnit(value, unit)}
        </output>
        <button type="button" className="pd-link" onClick={() => removeControl(control.path)} aria-label={`Fjern glidebryteren «${control.label}»`} title="Fjern glidebryteren">
          Fjern
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value ?? control.min}
        disabled={value === undefined}
        onPointerDown={begin}
        onPointerUp={end}
        onChange={onChange}
        onBlur={end}
      />
      <div className="pd-control-range muted">
        <span>{withUnit(control.min, unit)}</span>
        <span>{withUnit(control.max, unit)}</span>
      </div>
      {value === undefined && <p className="pd-error">Fant ingen tallverdi for {control.path}.</p>}
      {error && (
        <p className="pd-error" title={error}>
          Den verdien gir en ugyldig modell, så den ble ikke brukt.
        </p>
      )}
    </div>
  );
}
