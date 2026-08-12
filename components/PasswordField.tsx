"use client";

import { useState } from "react";

type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
};

const VARIANT_CLASSES = {
  dark: {
    label: "text-background/50",
    input: "border-background/20 text-background",
    icon: "text-background/50 hover:text-background",
  },
  light: {
    label: "text-muted",
    input: "border-border text-foreground",
    icon: "text-muted hover:text-foreground",
  },
} as const;

export default function PasswordField({
  id,
  value,
  onChange,
  variant,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const classes = VARIANT_CLASSES[variant];

  return (
    <div>
      <label
        htmlFor={id}
        className={`block text-xs uppercase tracking-[0.15em] ${classes.label}`}
      >
        Password
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border-b bg-transparent py-2 pr-8 outline-none transition-colors focus:border-accent ${classes.input}`}
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          className={`absolute right-0 top-1/2 -translate-y-1/2 transition-colors ${classes.icon}`}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
