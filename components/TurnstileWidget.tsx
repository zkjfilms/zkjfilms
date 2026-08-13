"use client";

import Script from "next/script";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type TurnstileWidgetHandle = {
  reset: () => void;
};

type Props = {
  onVerify: (token: string) => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(
  function TurnstileWidget({ onVerify }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // Seeded defensively: if the script is already fully loaded (e.g. this
    // is a remount and next/script's LoadCache means onReady's underlying
    // load event already fired before this effect subscribed), we don't
    // want to wait on a callback that may never come.
    const [scriptLoaded, setScriptLoaded] = useState(
      () => typeof window !== "undefined" && !!window.turnstile,
    );
    const [scriptFailed, setScriptFailed] = useState(false);

    useImperativeHandle(ref, () => ({
      reset() {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
        }
        onVerify("");
      },
    }));

    // Synchronizes with an external system (renders the Cloudflare
    // widget into the DOM once its script has loaded) — this is the
    // sanctioned use of an effect, not a state-derivation effect.
    useEffect(() => {
      if (!scriptLoaded || !SITE_KEY || !containerRef.current) return;
      if (!window.turnstile || widgetIdRef.current) return;

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => onVerify(token),
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify(""),
      });
    }, [scriptLoaded, onVerify]);

    // Cleans up the Cloudflare-side widget registration on unmount so
    // remounts (now that they actually render, per the fix above) don't
    // pile up stale registrations. Resetting the ref after removal (not
    // just calling remove()) matters: React's Strict Mode double-invokes
    // effects on mount in dev (setup -> cleanup -> setup again), and if
    // this cleanup fires between those two setups without clearing the
    // ref, the render effect's `|| widgetIdRef.current` guard sees a
    // stale (already-removed) id on the second setup and skips
    // re-rendering — leaving no widget at all.
    useEffect(() => {
      return () => {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
        }
        widgetIdRef.current = null;
      };
    }, []);

    const unavailable = !SITE_KEY || scriptFailed;

    return (
      <div>
        {!unavailable && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
            // onReady (unlike onLoad) fires both on the script's first load
            // AND on every subsequent component mount once next/script has
            // cached the src — exactly what's needed for widgets that
            // remount after the first (BookingForm remounting via
            // BookingFlow, or client-side nav between /book and /contact).
            onReady={() => setScriptLoaded(true)}
            onError={() => setScriptFailed(true)}
          />
        )}
        <div ref={containerRef} />
        {unavailable && (
          <p className="text-xs text-red-700">
            Verification failed to load. Please disable ad blockers or
            refresh and try again.
          </p>
        )}
      </div>
    );
  },
);

export default TurnstileWidget;
