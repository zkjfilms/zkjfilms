import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendSessionReminderEmail } from "@/lib/email";

type AppointmentTypeInfo = { name: string; uses_boudoir_reminder: boolean };

type DueBooking = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  // postgrest-js can't infer embed cardinality without a generated schema
  // (this project has none — see lib/supabase.ts), so it always types an
  // embedded relation as an array; same shape/unwrap pattern as
  // app/admin/clients/page.tsx's `appointment_types` field.
  appointment_types: AppointmentTypeInfo | AppointmentTypeInfo[] | null;
};

function appointmentType(booking: DueBooking): AppointmentTypeInfo | null {
  const rel = booking.appointment_types;
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Called by the send-session-reminders cron
// (app/api/cron/send-session-reminders/route.ts) — see that route for
// auth. Threshold query, not a narrow window: any run that crosses the
// 2-day-before mark catches a booking, so hourly cron granularity is
// safely sufficient and a booking can never fall between two runs
// unreminded. reminder_sent_at is the only dedup mechanism; canceled
// bookings are excluded by status = 'confirmed', and rescheduled
// bookings are handled for free because reschedule_booking (see
// supabase/schema.sql) cancels the old row and inserts a brand-new one
// with reminder_sent_at unset.
export async function sendDueSessionReminders(): Promise<{ sent: number; failed: number }> {
  const supabase = getSupabaseClient();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, client_name, client_email, start_time, appointment_types(name, uses_boudoir_reminder)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("start_time", new Date().toISOString())
    .lte("start_time", new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("Failed to query due session reminders:", error);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const booking of (bookings ?? []) as DueBooking[]) {
    try {
      const apptType = appointmentType(booking);
      const sessionType = apptType?.name ?? "photography";
      const templateType = apptType?.uses_boudoir_reminder
        ? "session_reminder_boudoir"
        : "session_reminder";

      const { data: template, error: templateError } = await supabase
        .from("templates")
        .select("content")
        .eq("template_type", templateType)
        .maybeSingle();

      if (templateError || !template) {
        console.error(`Failed to load ${templateType} template:`, templateError);
        failed += 1;
        continue;
      }

      const bodyText = fillTemplate(template.content, {
        clientName: booking.client_name,
        clientEmail: booking.client_email,
        sessionType,
        sessionDate: formatSessionDate(booking.start_time),
      });

      const result = await sendSessionReminderEmail({
        clientEmail: booking.client_email,
        sessionType,
        bodyText,
      });

      if (!result.ok) {
        console.error(`Failed to send session reminder for booking ${booking.id}:`, result.error);
        failed += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);

      if (updateError) {
        // Send already succeeded — this is pure bookkeeping. Log and
        // move on rather than treating the whole booking as failed.
        console.error(`Sent reminder but failed to mark booking ${booking.id} as reminded:`, updateError);
      }

      sent += 1;
    } catch (err) {
      console.error(`Unexpected error processing booking ${booking.id}:`, err);
      failed += 1;
    }
  }

  return { sent, failed };
}
