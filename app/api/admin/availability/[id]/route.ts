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
// original time/session-type row for reuse.
export async function PATCH(
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
