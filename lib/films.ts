import { getSupabaseClient } from "@/lib/supabase";

export type FilmRow = {
  slug: string;
  title: string;
  description: string | null;
  video_key: string;
  poster_key: string;
  created_at: string;
};

// Video rows are managed out-of-band via the video:* CLI (scripts/video.mjs).
export async function getFilms(): Promise<{ films: FilmRow[]; error: boolean }> {
  const { data, error } = await getSupabaseClient()
    .from("videos")
    .select("slug, title, description, video_key, poster_key, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) console.error("Supabase videos fetch failed:", error);
  return { films: (data as FilmRow[] | null) ?? [], error: Boolean(error) };
}
