import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import AdminGate from "./AdminGate";

// Applies to every /admin/* route — noindex here, plus the disallow rule
// in robots.ts, as defense in depth. Pages can still override the title.
export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
  },
};

// Single access check for the whole /admin tree — every admin page (the
// galleries list today, CRM pages later) inherits this instead of
// checking the cookie itself. Keeps the auth mechanism swappable later
// (e.g. for real per-user accounts) without touching individual pages.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const hasAccess = isValidAccessToken(
    cookieStore.get(ADMIN_ACCESS_COOKIE)?.value,
  );

  if (!hasAccess) {
    return <AdminGate />;
  }

  return <>{children}</>;
}
