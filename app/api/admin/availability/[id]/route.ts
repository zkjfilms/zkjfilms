import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

// Only open slots can be deleted outright — a booked slot represents a
// real client commitment. Use PATCH (cancel) instead, which reopens it
// rather than destroying the record.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("booking_slots")
    .delete()
    .eq("id", id)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to delete booking slot:", error);
    return Response.json({ error: "Failed to delete slot." }, { status: 500 });
  }

  if (!data) {
    return Response.json(
      { error: "Slot not found or already booked." },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}

// "Cancel" reopens the slot rather than deleting it, preserving the
// original time/session-type row for reuse. Also unsticks a 'pending'
// row (see the comment inside).
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseClient();

  // A 'pending' row is either a locked real booking (mid-reschedule or
  // mid-cancel — has a booking_token) or an abandoned hold (doesn't).
  // Restore the former to 'booked', release the latter to 'open' — same
  // distinction scripts/bookings.mjs's sweep makes automatically.
  const { data: pendingRow } = await supabase
    .from("booking_slots")
    .select("id, booking_token")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRow) {
    if (pendingRow.booking_token) {
      const { data, error } = await supabase
        .from("booking_slots")
        .update({ status: "booked", pending_expires_at: null })
        .eq("id", id)
        .eq("status", "pending")
        .select()
        .maybeSingle();

      if (error) {
        console.error("Failed to restore locked booking:", error);
        return Response.json(
          { error: "Failed to restore booking." },
          { status: 500 },
        );
      }
      return Response.json({ ok: true, slot: data });
    }

    const { data, error } = await supabase
      .from("booking_slots")
      .update({
        status: "open",
        client_name: null,
        client_email: null,
        client_notes: null,
        pending_expires_at: null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (error) {
      console.error("Failed to release stuck hold:", error);
      return Response.json({ error: "Failed to release hold." }, { status: 500 });
    }
    return Response.json({ ok: true, slot: data });
  }

  const { data, error } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      booked_at: null,
    })
    .eq("id", id)
    .eq("status", "booked")
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to cancel booking:", error);
    return Response.json(
      { error: "Failed to cancel booking." },
      { status: 500 },
    );
  }

  if (!data) {
    return Response.json(
      { error: "Slot not found or not currently booked." },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, slot: data });
}
