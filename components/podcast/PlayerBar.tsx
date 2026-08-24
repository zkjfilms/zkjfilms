"use client";

import Image from "next/image";
import { useLayoutEffect, useRef } from "react";
import { usePodcastPlayer } from "./PodcastPlayerContext";
import { formatDuration } from "@/lib/format";
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SkipArc,
  VolumeIcon,
  VolumeMuteIcon,
} from "./icons";

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];

function cyclePlaybackRate(current: number): number {
  const idx = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}

export default function PlayerBar() {
  const {
    currentEpisode,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    togglePlay,
    seek,
    skip,
    next,
    prev,
    setVolume,
    toggleMute,
    setPlaybackRate,
  } = usePodcastPlayer();

  const barRef = useRef<HTMLDivElement>(null);

  // Reserve space at the bottom of the document (past the global <Footer>,
  // which is a sibling of <main> in app/layout.tsx) equal to this bar's
  // actual rendered height, so the fixed-position bar never covers the
  // footer's content when scrolled to the true bottom of the page. Padding
  // on <body> is used (rather than a spacer inside <main>) because <body>
  // wraps <Navbar>, <main>, AND <Footer> — a spacer inside <main> can only
  // push the footer further down, never reserve space after it.
  useLayoutEffect(() => {
    if (currentEpisode && barRef.current) {
      document.body.style.paddingBottom = `${barRef.current.offsetHeight}px`;
    } else {
      document.body.style.paddingBottom = "";
    }

    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [currentEpisode]);

  if (!currentEpisode) return null;

  return (
    <>
      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden bg-background">
              {currentEpisode.imageUrl && (
                <Image
                  src={currentEpisode.imageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="48px"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {currentEpisode.season !== null && currentEpisode.episode !== null
                  ? `S${currentEpisode.season} E${String(currentEpisode.episode).padStart(2, "0")} — `
                  : ""}
                {currentEpisode.title}
              </p>
              <p className="truncate text-xs text-muted">What Comes Next by Zach K. Johnson</p>
            </div>

            <div className="flex items-center gap-3 text-foreground">
              <button type="button" onClick={prev} aria-label="Previous episode" className="p-1 hover:text-accent">
                <SkipBackIcon />
              </button>
              <button type="button" onClick={() => skip(-15)} aria-label="Rewind 15 seconds" className="p-1 hover:text-accent">
                <SkipArc direction="back" seconds={15} />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-background hover:opacity-90"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button type="button" onClick={() => skip(30)} aria-label="Forward 30 seconds" className="p-1 hover:text-accent">
                <SkipArc direction="forward" seconds={30} />
              </button>
              <button type="button" onClick={next} aria-label="Next episode" className="p-1 hover:text-accent">
                <SkipForwardIcon />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setPlaybackRate(cyclePlaybackRate(playbackRate))}
              aria-label={`Playback speed: ${playbackRate}x. Click to change.`}
              className="w-10 flex-shrink-0 text-xs font-medium text-foreground hover:text-accent"
            >
              {playbackRate}x
            </button>

            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="p-1 text-foreground hover:text-accent"
              >
                {muted || volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="w-16 accent-accent"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="w-9 text-right tabular-nums">{formatDuration(Math.floor(currentTime))}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              className="flex-1 accent-accent"
            />
            <span className="w-9 tabular-nums">
              {duration ? formatDuration(Math.floor(duration)) : "--:--"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
