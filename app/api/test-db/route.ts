import { randomUUID } from "node:crypto";
import { getSupabaseClient } from "@/lib/supabase";

// Temporary connectivity check for the Supabase integration — inserts a
// test gallery row, reads it back, deletes it, and returns the result as
// JSON. Not part of the client gallery feature itself; delete this route
// once DB access is confirmed working.
//
// Unauthenticated and writes to the database, so it's blocked outside
// local development — never let this reach production.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.error("Failed to create Supabase client:", err);
    return Response.json(
      { error: "Supabase is not configured. Check the SUPABASE_* env vars." },
      { status: 500 },
    );
  }

  const testSlug = `test-db-${randomUUID()}`;

  try {
    const { data: inserted, error: insertError } = await supabase
      .from("galleries")
      .insert({
        slug: testSlug,
        title: "Test Gallery",
        password_hash: "test-hash",
        client_name: "Test Client",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Supabase insert failed:", insertError);
      return Response.json(
        { error: `Insert failed: ${insertError.message}` },
        { status: 500 },
      );
    }

    const { data: fetched, error: fetchError } = await supabase
      .from("galleries")
      .select()
      .eq("slug", testSlug)
      .single();

    if (fetchError) {
      console.error("Supabase read-back failed:", fetchError);
      return Response.json(
        { error: `Read-back failed: ${fetchError.message}` },
        { status: 500 },
      );
    }

    const { error: deleteError } = await supabase
      .from("galleries")
      .delete()
      .eq("slug", testSlug);

    if (deleteError) {
      console.error("Supabase test row cleanup failed:", deleteError);
    }

    return Response.json({ ok: true, inserted, fetched });
  } catch (err) {
    console.error("Supabase test request failed:", err);
    return Response.json(
      { error: "Supabase request failed." },
      { status: 500 },
    );
  }
}
