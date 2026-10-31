// iCalendar (.ics) attachments for client confirmation emails — the
// "add to calendar" invite. METHOD:PUBLISH (not REQUEST) so mail clients
// offer a plain "Add to Calendar" rather than RSVP buttons that would
// reply to nobody.
//
// Each event's UID is derived from the booking token, which survives a
// reschedule (the reschedule_booking RPC copies it onto the new row), and
// SEQUENCE is the send time in seconds — so a reschedule email's invite
// updates the event the client already added instead of duplicating it.

import { BUSINESS } from "@/lib/seo";

export type CalendarEvent = {
  uid: string;
  startIso: string;
  endIso: string;
  title: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
};

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545: content lines longer than 75 octets must be folded onto
// continuation lines that start with a single space.
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (encoder.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function bookingEventUid(bookingToken: string): string {
  return `booking-${bookingToken}@zkjfilms.com`;
}

export function buildIcs(events: CalendarEvent[]): string {
  const now = new Date();
  const stamp = icsDate(now.toISOString());
  const sequence = Math.floor(now.getTime() / 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${BUSINESS.name}//Bookings//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART:${icsDate(event.startIso)}`,
      `DTEND:${icsDate(event.endIso)}`,
      `SUMMARY:${icsText(event.title)}`,
    );
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(event.title)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
