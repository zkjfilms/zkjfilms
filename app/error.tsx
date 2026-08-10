"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center sm:px-10">
      <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
        Something went wrong.
      </h1>
      <p className="mt-5 text-muted">
        That wasn&apos;t supposed to happen. Try again, or reach out
        directly if it keeps happening.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Try Again
        </button>
        <Link
          href="/contact"
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        >
          Contact
        </Link>
      </div>
    </div>
  );
}
