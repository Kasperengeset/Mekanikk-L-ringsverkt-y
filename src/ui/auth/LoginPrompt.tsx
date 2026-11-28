/** I verktøyet: det som krever bruker (egen oppgave, veileder), viser dette når studenten ikke er logget inn. */
import { LockIcon } from "../icons.js";
import { useAuth } from "./auth.js";
import { LoginForm } from "./LoginForm.js";

export function LoginPrompt({ title, text }: { title: string; text: string }) {
  const notice = useAuth((s) => s.notice);
  return (
    <div className="login-prompt">
      <p className="login-prompt-title">
        <LockIcon />
        <strong>{title}</strong>
      </p>
      <p className="muted">{notice ?? text}</p>
      <LoginForm compact next={typeof window === "undefined" ? "/app" : window.location.pathname} />
    </div>
  );
}

/** true når innlogging er slått på og studenten ikke er logget inn. */
export function useNeedsLogin(): boolean {
  return useAuth((s) => s.status === "signedOut");
}
