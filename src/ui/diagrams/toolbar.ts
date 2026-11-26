/** Knappene i diagrammenes verktøylinje: hvilke diagram som vises, og forstørrelsen av deformasjonen. */
import type { DiagramSettings } from "../state/store";

export interface Chip {
  label: string;
  active: boolean;
  disabled?: boolean;
  title: string;
  onPress(): void;
}

/** Knapper (Chip) og ledetekster (string) i rekkefølge. `scale` er forstørrelsen som brukes nå. */
export function toolbarChips(settings: DiagramSettings, scale: number, onChange: (change: Partial<DiagramSettings>) => void): (Chip | string)[] {
  const chips: (Chip | string)[] = [
    { label: "N", active: settings.N, title: "Vis N-diagram", onPress: () => onChange({ N: !settings.N }) },
    { label: "V", active: settings.V, title: "Vis V-diagram", onPress: () => onChange({ V: !settings.V }) },
    { label: "M", active: settings.M, title: "Vis M-diagram", onPress: () => onChange({ M: !settings.M }) },
    { label: "Deformert form", active: settings.deformed, title: "Vis deformert form", onPress: () => onChange({ deformed: !settings.deformed }) },
  ];
  if (settings.deformed) {
    const none = !(scale > 0);
    chips.push(
      "Forstørrelse:",
      { label: "auto", active: settings.deformationScale === "auto", title: "Største forskyvning ≈ 10 % av konstruksjonen", onPress: () => onChange({ deformationScale: "auto" }) },
      { label: "÷2", active: false, disabled: none, title: "Halver forstørrelsen", onPress: () => onChange({ deformationScale: scale / 2 }) },
      { label: "×2", active: false, disabled: none, title: "Doble forstørrelsen", onPress: () => onChange({ deformationScale: scale * 2 }) },
    );
  }
  return chips;
}
