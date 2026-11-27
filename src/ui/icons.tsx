/** Små ikoner fra designet (docs/design). Tegnes med currentColor og er skjult for skjermlesere. */
import type { ReactNode } from "react";

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Icon>
);

export const CheckCircleIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </Icon>
);

export const InfoIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </Icon>
);

export const WarningIcon = () => (
  <Icon size={18}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17v.01" />
  </Icon>
);

export const SendIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h13M13 6l6 6-6 6" />
  </svg>
);

export const StopIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

/** Logoen: en bjelke med opplager, i mørkebrun firkant. */
export const BrandMark = () => (
  <span className="brand-mark">
    <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h18M8 9l-3 0M12 9v0M16 9l3 6H13l3-6z" stroke="#FBF9F4" />
      <path d="M5 9l-2 4M5 9v6" stroke="#E2682B" />
    </svg>
  </span>
);
