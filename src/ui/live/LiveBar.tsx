/** Linjen over verktøyet når studenten er innlogget: om resultater fra Claude vises her automatisk. */
import { useAuth } from "../auth/auth.js";
import { useLive } from "./live.js";
import "./live.css";

export function LiveBar() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  const following = useLive((s) => s.following);
  const setFollowing = useLive((s) => s.setFollowing);
  if (!signedIn) return null;
  return (
    <div className={`live-bar${following ? " on" : ""}`} role="status">
      <span className="live-dot" aria-hidden="true" />
      <span>
        {following
          ? "Følger Claude: det du regner på med Mekanikk-intuisjon i Claude, vises her automatisk."
          : "Resultater fra Claude vises ikke her nå."}
      </span>
      <button type="button" className="btn-link" onClick={() => setFollowing(!following)}>
        {following ? "Slå av" : "Følg Claude"}
      </button>
    </div>
  );
}
