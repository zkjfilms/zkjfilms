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

type PlayerState = {
  currentEpisode: PodcastEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
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
    audio.play().catch(() => {
      // Autoplay can be blocked by the browser without a prior user
      // gesture — isPlaying stays correct via the audio element's own
      // "play"/"pause" events, so no extra handling is needed here.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEpisode?.guid]);

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
    if (audio) audio.volume = v;
    setVolumeState(v);
    if (v > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const value = useMemo<PodcastPlayerValue>(
    () => ({
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
    }),
    [
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
    ],
  );

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
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
