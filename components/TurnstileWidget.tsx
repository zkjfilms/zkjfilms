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
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(
  function TurnstileWidget({ onVerify }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptLoaded, setScriptLoaded] = useState(false);
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

    const unavailable = !SITE_KEY || scriptFailed;

    return (
      <div>
        {!unavailable && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
            onLoad={() => setScriptLoaded(true)}
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
