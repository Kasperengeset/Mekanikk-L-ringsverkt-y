/**
 * Direktekoblingen i webappen: når studenten er innlogget og har /app åpen, vises det Claude regner på med
 * Mekanikk-intuisjon her automatisk (konstruksjon eller kraftsystem). Serveren skriver raden
 * (server/platform/live.ts); her følges den i sanntid (followLiveViews).
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Model } from "../../core/schema.js";
import { followLiveViews, useAuth } from "../auth/auth.js";
import { useStore, type ForcesView } from "../state/store.js";

const KEY = "mekanikk.folgClaude";

function readPref(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "av";
  } catch {
    return true;
  }
}

interface LiveState {
  /** Studenten vil at resultater fra Claude vises her (standard på). */
  following: boolean;
  /** Tidspunktet for siste resultat som ble vist. */
  lastAt: string | null;
  setFollowing(on: boolean): void;
}

export const useLive = create<LiveState>()((set) => ({
  following: readPref(),
  lastAt: null,
  setFollowing: (following) => {
    try {
      globalThis.localStorage?.setItem(KEY, following ? "på" : "av");
    } catch {
      // Uten lagring gjelder valget bare denne økten.
    }
    set({ following });
  },
}));

/** Viser et resultat fra Claude i appen. Gir false når innholdet ikke kan vises. */
export function applyLivePayload(payload: unknown): boolean {
  const p = payload as { view?: string; model?: unknown; units?: ForcesView["units"]; forces?: unknown; resultant?: unknown };
  const store = useStore.getState();
  if (p?.view === "structure") {
    const parsed = Model.safeParse(p.model);
    if (!parsed.success) return false;
    store.loadModel({ ...parsed.data, asked: [] }, "explore");
    return true;
  }
  if (p?.view === "forces" && p.units && Array.isArray(p.forces) && p.resultant) {
    store.showForces({ units: p.units, result: p as unknown as ForcesView["result"] });
    return true;
  }
  return false;
}

/**
 * Følger Claude mens /app er åpen. Ved oppstart vises siste resultat bare når appen ellers er tom
 * (ingen modell fra lenke, eksempel eller opplasting); nye resultater vises alltid når følgingen er på.
 */
export function useLiveFollow(): void {
  const userId = useAuth((s) => (s.status === "signedIn" ? s.user?.id : undefined));
  const following = useLive((s) => s.following);
  useEffect(() => {
    if (!userId || !following) return;
    return followLiveViews(userId, (payload, createdAt, initial) => {
      const { model, forces } = useStore.getState();
      if (initial && (model || forces)) return;
      if (useLive.getState().lastAt === createdAt) return;
      if (applyLivePayload(payload)) useLive.setState({ lastAt: createdAt });
    });
  }, [userId, following]);
}
