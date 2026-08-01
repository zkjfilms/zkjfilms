import {
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET_NAME } from "@/lib/r2";

// Temporary connectivity check for the R2 integration — uploads a small
// test object, lists the bucket, and returns the listing as JSON. Not
// part of the client gallery feature itself; delete this route once R2
// access is confirmed working.
//
// Unauthenticated and returns bucket contents, so it's blocked outside
// local development — never let this reach production.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  if (!R2_BUCKET_NAME) {
    return Response.json(
      { error: "R2_BUCKET_NAME is not set." },
      { status: 500 },
    );
  }

  let client;
  try {
    client = getR2Client();
  } catch (err) {
    console.error("Failed to create R2 client:", err);
    return Response.json(
      { error: "R2 is not configured. Check the R2_* env vars." },
      { status: 500 },
    );
  }

  const testKey = `test-r2/${Date.now()}.txt`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: testKey,
        Body: "R2 connection test file.",
        ContentType: "text/plain",
      }),
    );

    const listing = await client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME }),
    );

    const objects = (listing.Contents ?? []).map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
    }));

    return Response.json({ ok: true, uploadedKey: testKey, objects });
  } catch (err) {
    console.error("R2 test request failed:", err);
    return Response.json({ error: "R2 request failed." }, { status: 500 });
  }
}
