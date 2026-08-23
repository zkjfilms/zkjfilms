"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodcastEpisode } from "@/lib/podcast";

const RESUME_KEY_PREFIX = "podcast-resume:";
const RESUME_SKIP_LAST_SECONDS = 5;

function readResumePosition(guid: string): number | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY_PREFIX + guid);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeResumePosition(guid: string, time: number): void {
  try {
    localStorage.setItem(RESUME_KEY_PREFIX + guid, String(time));
  } catch {
    // Private browsing / storage disabled — resume is a nice-to-have,
    // fail silently.
  }
}

function clearResumePosition(guid: string): void {
  try {
    localStorage.removeItem(RESUME_KEY_PREFIX + guid);
  } catch {
    // Same as above.
  }
}

type PlayerState = {
  currentEpisode: PodcastEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
};

type PlayerActions = {
  playEpisode: (episode: PodcastEpisode) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
};

type PodcastPlayerValue = PlayerState & PlayerActions;

const PodcastPlayerContext = createContext<PodcastPlayerValue | null>(null);

export function PodcastPlayerProvider({
  episodes,
  children,
}: {
  episodes: PodcastEpisode[];
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<PodcastEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const playbackRateRef = useRef(1);

  const currentIndex = currentEpisode
    ? episodes.findIndex((e) => e.guid === currentEpisode.guid)
    : -1;

  const playEpisode = useCallback(
    (episode: PodcastEpisode) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (currentEpisode?.guid === episode.guid) {
        if (audio.paused) {
          audio.play().catch(() => {
            // Autoplay can be blocked by the browser without a prior user
            // gesture — isPlaying stays correct via the audio element's own
            // "play"/"pause" events, so no extra handling is needed here.
          });
        } else {
          audio.pause();
        }
        return;
      }
      setCurrentEpisode(episode);
      setCurrentTime(0);
      setDuration(0);
    },
    [currentEpisode],
  );

  // Loads and plays the new episode once React has committed
  // currentEpisode — audio.src must be set before play() means anything,
  // and doing both directly inside playEpisode would race the <audio>
  // ref on the very first play (before the element has ever mounted).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    audio.src = currentEpisode.audioUrl;
    audio.playbackRate = playbackRateRef.current;
    audio.play().catch(() => {
      // Autoplay can be blocked by the browser without a prior user
      // gesture — isPlaying stays correct via the audio element's own
      // "play"/"pause" events, so no extra handling is needed here.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEpisode?.guid]);

  useEffect(() => {
    if (!isPlaying || !currentEpisode) return;
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.duration && audio.currentTime > audio.duration - RESUME_SKIP_LAST_SECONDS) {
        clearResumePosition(currentEpisode.guid);
      } else {
        writeResumePosition(currentEpisode.guid, audio.currentTime);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [isPlaying, currentEpisode]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    if (audio.paused) {
      audio.play().catch(() => {
        // Autoplay can be blocked by the browser without a prior user
        // gesture — isPlaying stays correct via the audio element's own
        // "play"/"pause" events, so no extra handling is needed here.
      });
    } else {
      audio.pause();
    }
  }, [currentEpisode]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = audio.duration || Infinity;
    audio.currentTime = Math.max(0, Math.min(max, audio.currentTime + seconds));
  }, []);

  const next = useCallback(() => {
    if (currentIndex === -1 || currentIndex >= episodes.length - 1) return;
    playEpisode(episodes[currentIndex + 1]);
  }, [currentIndex, episodes, playEpisode]);

  const prev = useCallback(() => {
    if (currentIndex <= 0) return;
    playEpisode(episodes[currentIndex - 1]);
  }, [currentIndex, episodes, playEpisode]);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = v;
      if (v > 0) audio.muted = false;
    }
    setVolumeState(v);
    if (v > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
  }, []);

  const value = useMemo<PodcastPlayerValue>(
    () => ({
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playbackRate,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      setPlaybackRate,
    }),
    [
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playbackRate,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      setPlaybackRate,
    ],
  );

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
      {/* No `controls` attribute — this is deliberate, not an oversight.
          The site's product requirement is to discourage casual/native
          audio downloads: a native <audio controls> element exposes a
          browser download button, and this one must not. onContextMenu
          blocks the obvious right-click "Save Audio As" path too. This
          is a UX deterrent, not a security boundary — a visitor reading
          the Network tab in devtools can still find the direct MP3 URL,
          which is unavoidable for audio that must play in the browser.
          Do not add `controls` back without revisiting that requirement. */}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          const audio = audioRef.current;
          if (audio && currentEpisode) {
            if (audio.duration && audio.currentTime > audio.duration - RESUME_SKIP_LAST_SECONDS) {
              clearResumePosition(currentEpisode.guid);
            } else {
              writeResumePosition(currentEpisode.guid, audio.currentTime);
            }
          }
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          setDuration(audio.duration);
          if (currentEpisode) {
            const saved = readResumePosition(currentEpisode.guid);
            if (saved !== null && saved < audio.duration - RESUME_SKIP_LAST_SECONDS) {
              audio.currentTime = saved;
            }
          }
        }}
        onEnded={next}
        onContextMenu={(e) => e.preventDefault()}
        preload="metadata"
        className="hidden"
      />
    </PodcastPlayerContext.Provider>
  );
}

export function usePodcastPlayer(): PodcastPlayerValue {
  const ctx = useContext(PodcastPlayerContext);
  if (!ctx) {
    throw new Error("usePodcastPlayer must be used within a PodcastPlayerProvider");
  }
  return ctx;
}
