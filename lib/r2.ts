// S3-compatible client for Cloudflare R2, used by the client gallery
// feature to store and serve images.

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "";

export function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export type GalleryImage = {
  key: string;
  url: string;
  downloadUrl: string;
  filename: string;
};

export const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

// Images for a gallery live under galleries/<slug>/ in the bucket. Signed
// URLs expire after an hour — a client browsing longer than that in one
// sitting would need to re-unlock to get fresh URLs.
//
// Two signed URLs per image: `url` for inline display, and `downloadUrl`
// with a Content-Disposition override so browsers reliably save it as a
// file with the right name instead of navigating to it — the plain HTML
// `download` attribute isn't consistently honored for cross-origin URLs.
export async function listGalleryImages(slug: string): Promise<GalleryImage[]> {
  const client = getR2Client();

  const listing = await client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `galleries/${slug}/`,
    }),
  );

  const objects = (listing.Contents ?? []).filter(
    (obj): obj is typeof obj & { Key: string } =>
      typeof obj.Key === "string" && !obj.Key.endsWith("/"),
  );

  return Promise.all(
    objects.map(async (obj) => {
      const filename = obj.Key.split("/").pop() || obj.Key;

      const [url, downloadUrl] = await Promise.all([
        getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: obj.Key }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: obj.Key,
            ResponseContentDisposition: `attachment; filename="${filename}"`,
          }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
      ]);

      return { key: obj.Key, url, downloadUrl, filename };
    }),
  );
}
