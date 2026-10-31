// Shared branded layout for every client-facing email (lib/email.ts).
// Admin-only notifications stay plain — this is for what clients see.
//
// Email clients ignore <style> blocks and web fonts inconsistently, so
// everything here is table-based with inline styles, and the site's
// Playfair Display / Jost pairing degrades to Georgia / Helvetica. Colors
// mirror the :root tokens in app/globals.css. renderEmail returns a
// plain-text twin alongside the HTML so the two can't drift apart.

import { BUSINESS, SITE_URL, STUDIO_ADDRESS } from "@/lib/seo";

const COLORS = {
  page: "#f2ebe0",
  card: "#fffdf9",
  text: "#2b2621",
  muted: "#8c7f6f",
  border: "#e6ddd0",
  accent: "#a8613f",
  panel: "#faf6f0",
};

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "Jost, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export type EmailSession = {
  title: string;
  when: string;
  location?: string | null;
  manageUrl?: string | null;
};

export type EmailContent = {
  // Inbox preview text (hidden in the body).
  preheader: string;
  eyebrow: string;
  heading: string;
  greeting?: string;
  intro?: string[];
  sessions?: EmailSession[];
  items?: { description: string; amount: string }[];
  total?: { label: string; amount: string };
  details?: { label: string; value: string }[];
  button?: { label: string; url: string };
  outro?: string[];
  // Admin-edited plain-text templates (/admin/templates) go here verbatim —
  // they carry their own greeting and sign-off.
  bodyText?: string;
  // false = no "Best," sign-off block (bodyText templates sign off themselves).
  signOff?: boolean;
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function autolink(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:${COLORS.accent};word-break:break-all;">${url}</a>`,
  );
}

const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
const SIGN_OFF = "Best,";

const SIGNATURE_LINES = [BUSINESS.name, "Photographer", BUSINESS.email, SITE_HOST];

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${COLORS.text};">${html}</p>`;
}

function sectionLabel(label: string): string {
  return `<p style="margin:28px 0 10px;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${COLORS.muted};">${escapeHtml(label)}</p>`;
}

function renderSessions(sessions: EmailSession[]): string {
  const blocks = sessions
    .map((s) => {
      const location = s.location
        ? `<div style="margin-top:4px;font-size:14px;color:${COLORS.muted};">${escapeHtml(s.location)}</div>`
        : "";
      const manage = s.manageUrl
        ? `<div style="margin-top:8px;font-size:13px;"><a href="${s.manageUrl}" style="color:${COLORS.accent};">Reschedule or cancel</a></div>`
        : "";
      return `
        <tr><td style="padding:0 0 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.panel};border-left:3px solid ${COLORS.accent};">
            <tr><td style="padding:14px 18px;font-family:${SANS};color:${COLORS.text};">
              <div style="font-family:${SERIF};font-size:17px;">${escapeHtml(s.title)}</div>
              <div style="margin-top:4px;font-size:14px;">${escapeHtml(s.when)}</div>
              ${location}${manage}
            </td></tr>
          </table>
        </td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${blocks}</table>`;
}

function renderItems(items: { description: string; amount: string }[], total?: { label: string; amount: string }): string {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 12px 12px 0;border-bottom:1px solid ${COLORS.border};font-family:${SANS};font-size:14px;line-height:1.5;color:${COLORS.text};">${escapeHtml(item.description)}</td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid ${COLORS.border};font-family:${SANS};font-size:14px;color:${COLORS.text};white-space:nowrap;vertical-align:top;">${escapeHtml(item.amount)}</td>
        </tr>`,
    )
    .join("");
  const totalRow = total
    ? `
        <tr>
          <td style="padding:14px 12px 0 0;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${COLORS.muted};">${escapeHtml(total.label)}</td>
          <td align="right" style="padding:14px 0 0;font-family:${SERIF};font-size:20px;color:${COLORS.text};white-space:nowrap;">${escapeHtml(total.amount)}</td>
        </tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${totalRow}</table>`;
}

function renderDetails(details: { label: string; value: string }[]): string {
  const rows = details
    .map(
      (d) => `
        <tr>
          <td style="padding:6px 16px 6px 0;font-family:${SANS};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${COLORS.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${COLORS.text};">${escapeHtml(d.value)}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">${rows}</table>`;
}

function renderButton(button: { label: string; url: string }): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr><td style="background:${COLORS.text};">
        <a href="${button.url}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${COLORS.panel};text-decoration:none;">${escapeHtml(button.label)}</a>
      </td></tr>
    </table>`;
}

function renderSignature(): string {
  return `
    <p style="margin:32px 0 6px;font-family:${SANS};font-size:15px;color:${COLORS.text};">${SIGN_OFF}</p>
    <p style="margin:0;font-family:${SERIF};font-size:20px;color:${COLORS.text};">${escapeHtml(BUSINESS.name)}</p>
    <p style="margin:2px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${COLORS.muted};">
      Photographer<br />
      <a href="mailto:${BUSINESS.email}" style="color:${COLORS.accent};text-decoration:none;">${escapeHtml(BUSINESS.email)}</a><br />
      <a href="${SITE_URL}" style="color:${COLORS.accent};text-decoration:none;">${escapeHtml(SITE_HOST)}</a>
    </p>`;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const signOff = content.signOff ?? true;

  const body: string[] = [];
  if (content.greeting) body.push(paragraph(escapeHtml(content.greeting)));
  for (const p of content.intro ?? []) body.push(paragraph(escapeHtml(p)));
  if (content.bodyText) {
    for (const block of content.bodyText.trim().split(/\n\s*\n/)) {
      body.push(paragraph(autolink(escapeHtml(block)).replace(/\n/g, "<br />")));
    }
  }
  if (content.sessions?.length) {
    body.push(sectionLabel(content.sessions.length > 1 ? "Your sessions" : "Your session"));
    body.push(renderSessions(content.sessions));
  }
  if (content.items?.length) {
    body.push(sectionLabel("Summary"));
    body.push(renderItems(content.items, content.total));
  }
  if (content.details?.length) body.push(renderDetails(content.details));
  if (content.button) body.push(renderButton(content.button));
  if (content.outro?.length) {
    body.push('<div style="height:12px;"></div>');
    for (const p of content.outro) body.push(paragraph(escapeHtml(p)));
  }
  if (signOff) body.push(renderSignature());

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr><td align="center" style="padding:0 0 22px;">
        <a href="${SITE_URL}" style="font-family:${SERIF};font-size:22px;letter-spacing:5px;text-transform:uppercase;color:${COLORS.text};text-decoration:none;">${escapeHtml(BUSINESS.name)}</a>
        <div style="margin-top:6px;font-family:${SANS};font-size:10px;letter-spacing:4px;text-transform:uppercase;color:${COLORS.muted};">Photography · Columbia, Missouri</div>
      </td></tr>
      <tr><td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-top:3px solid ${COLORS.accent};padding:40px 36px;">
        <p style="margin:0 0 8px;font-family:${SANS};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.accent};">${escapeHtml(content.eyebrow)}</p>
        <h1 style="margin:0 0 24px;font-family:${SERIF};font-size:28px;font-weight:normal;line-height:1.25;color:${COLORS.text};">${escapeHtml(content.heading)}</h1>
        ${body.join("\n")}
      </td></tr>
      <tr><td align="center" style="padding:22px 12px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${COLORS.muted};">
        ${escapeHtml(BUSINESS.name)} Photography<br />
        ${escapeHtml(STUDIO_ADDRESS)}<br />
        <a href="${SITE_URL}" style="color:${COLORS.muted};">${escapeHtml(SITE_HOST)}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text: string[] = [];
  if (content.greeting) text.push(content.greeting, "");
  for (const p of content.intro ?? []) text.push(p, "");
  if (content.bodyText) text.push(content.bodyText.trim(), "");
  if (content.sessions?.length) {
    text.push(content.sessions.length > 1 ? "YOUR SESSIONS" : "YOUR SESSION");
    for (const s of content.sessions) {
      text.push(`- ${s.title}: ${s.when}`);
      if (s.location) text.push(`  ${s.location}`);
      if (s.manageUrl) text.push(`  Reschedule or cancel: ${s.manageUrl}`);
    }
    text.push("");
  }
  if (content.items?.length) {
    text.push("SUMMARY");
    for (const item of content.items) text.push(`- ${item.description}: ${item.amount}`);
    if (content.total) text.push(`${content.total.label}: ${content.total.amount}`);
    text.push("");
  }
  if (content.details?.length) {
    for (const d of content.details) text.push(`${d.label}: ${d.value}`);
    text.push("");
  }
  if (content.button) text.push(`${content.button.label}: ${content.button.url}`, "");
  for (const p of content.outro ?? []) text.push(p, "");
  if (signOff) text.push(SIGN_OFF, ...SIGNATURE_LINES);

  return { html, text: text.join("\n").trim() };
}
