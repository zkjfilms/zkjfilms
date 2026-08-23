// Hand-drawn inline SVG icons for the podcast player UI — this repo has
// no icon library installed (confirmed: not in package.json), matching
// the existing pattern of local icon components in components/Navbar.tsx.

export function RssIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="5" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <path d="M3 9.5a7.5 7.5 0 0 1 7.5 7.5" strokeLinecap="round" />
      <path d="M3 4.5a12.5 12.5 0 0 1 12.5 12.5" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path
        d="M10 17s-6-3.7-6-8.2C4 6 5.8 4.5 8 4.5c1 0 2 .5 2 1.8 0-1.3 1-1.8 2-1.8 2.2 0 4 1.5 4 4.3 0 4.5-6 8.2-6 8.2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12v3.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" strokeLinecap="round" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.5v11l9-5.5z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
      <rect x="11" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
    </svg>
  );
}

export function SkipBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 5v10" strokeLinecap="round" />
      <path d="M15 5 6 10l9 5z" fill="currentColor" stroke="none" strokeLinejoin="round" />
    </svg>
  );
}

export function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M15 5v10" strokeLinecap="round" />
      <path d="M5 5l9 5-9 5z" fill="currentColor" stroke="none" strokeLinejoin="round" />
    </svg>
  );
}

// Rewind-15 / forward-30: a partial circular arrow with the seconds count
// in the middle. `direction="back"` mirrors the arrow horizontally.
export function SkipArc({ direction, seconds }: { direction: "back" | "forward"; seconds: number }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <g transform={direction === "back" ? "scale(-1,1) translate(-20,0)" : undefined}>
        <path d="M4 8a6.5 6.5 0 1 1 .8 5" strokeLinecap="round" />
        <path d="M2.5 5.5 4 8.5l3-1" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="10" y="12.5" textAnchor="middle" fontSize="6.5" fill="currentColor" stroke="none">
        {seconds}
      </text>
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8v4h3l4 3V5L7 8z" fill="currentColor" stroke="none" strokeLinejoin="round" />
      <path d="M13.5 7a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}

export function VolumeMuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8v4h3l4 3V5L7 8z" fill="currentColor" stroke="none" strokeLinejoin="round" />
      <path d="M13 8l3.5 4M16.5 8 13 12" strokeLinecap="round" />
    </svg>
  );
}

export function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="1.5,3 5,6.5 8.5,3" />
    </svg>
  );
}
