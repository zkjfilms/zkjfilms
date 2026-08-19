import { sendDueSessionReminders } from "@/lib/sessionReminders";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  try {
    const result = await sendDueSessionReminders();
    return Response.json(result);
  } catch (err) {
    console.error("Session reminder cron failed:", err);
    return Response.json({ error: "Failed." }, { status: 500 });
  }
}
