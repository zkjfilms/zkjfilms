import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Galleries" };
}

type GalleryRow = {
  slug: string;
  title: string;
  client_name: string;
  created_at: string;
  expires_at: string | null;
  archived_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Date.now() has to stay inside this plain helper, not the component body
// — same purity rule as lib/gallery.ts.
function statusFor(gallery: GalleryRow): {
  label: string;
  tone: "neutral" | "warning" | "danger";
} {
  if (gallery.archived_at) {
    return { label: `Archived ${formatDate(gallery.archived_at)}`, tone: "warning" };
  }
  if (gallery.expires_at) {
    const isExpired = new Date(gallery.expires_at).getTime() < Date.now();
    return isExpired
      ? { label: `Expired ${formatDate(gallery.expires_at)}`, tone: "danger" }
      : { label: `Expires ${formatDate(gallery.expires_at)}`, tone: "neutral" };
  }
  return { label: "Never expires", tone: "neutral" };
}

const TONE_CLASSES = {
  neutral: "text-muted",
  warning: "text-accent",
  danger: "text-red-700",
} as const;

export default async function AdminGalleriesPage() {
  const supabase = getSupabaseClient();
  const { data: galleries, error } = await supabase
    .from("galleries")
    .select("slug, title, client_name, created_at, expires_at, archived_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase gallery list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Admin
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Galleries
        </h1>
      </div>

      {!galleries || galleries.length === 0 ? (
        <p className="text-muted">
          {error ? "Couldn't load galleries." : "No galleries found."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
                <th className="py-3 pr-4 font-normal">Slug</th>
                <th className="py-3 pr-4 font-normal">Title</th>
                <th className="py-3 pr-4 font-normal">Client</th>
                <th className="py-3 pr-4 font-normal">Created</th>
                <th className="py-3 pr-4 font-normal">Status</th>
                <th className="py-3 font-normal">Link</th>
              </tr>
            </thead>
            <tbody>
              {galleries.map((gallery) => {
                const status = statusFor(gallery);
                return (
                  <tr key={gallery.slug} className="border-b border-border/60">
                    <td className="py-3 pr-4 text-foreground">
                      <Link
                        href={`/admin/galleries/${gallery.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {gallery.slug}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-foreground">{gallery.title}</td>
                    <td className="py-3 pr-4 text-muted">
                      {gallery.client_name}
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {formatDate(gallery.created_at)}
                    </td>
                    <td className={`py-3 pr-4 ${TONE_CLASSES[status.tone]}`}>
                      {status.label}
                    </td>
                    <td className="py-3">
                      <Link
                        href={`/admin/galleries/${gallery.slug}`}
                        target="_blank"
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-10 text-xs text-muted">
        To set an expiration, archive, or delete a gallery, use the CLI:{" "}
        <code className="text-foreground">npm run gallery:*</code> (see
        scripts/gallery.mjs).
      </p>
    </div>
  );
}
