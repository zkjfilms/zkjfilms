import { pullBusyBlocks } from "@/lib/googleCalendar";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  try {
    const result = await pullBusyBlocks();
    return Response.json(result);
  } catch (err) {
    console.error("Google Calendar sync failed:", err);
    return Response.json({ error: "Sync failed." }, { status: 500 });
  }
}
