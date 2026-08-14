import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import AdminGate from "./AdminGate";

const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/discount-codes", label: "Discount Codes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
];

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

  return (
    <>
      <div className="border-b border-border">
        <nav className="mx-auto flex max-w-6xl gap-6 px-6 py-4 sm:px-10">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}
