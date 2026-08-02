// Acuity Scheduling integration for app/api/webhooks/acuity/route.ts.
//
// Acuity's webhooks are minimal (application/x-www-form-urlencoded,
// just action/id/calendarID/appointmentTypeID) — full appointment
// details are fetched separately via their REST API. Per Acuity's docs,
// webhook payloads are signed with HMAC-SHA256 over the raw body, keyed
// with the account's API key, in the x-acuity-signature header
// (base64-encoded).

import { createHmac, timingSafeEqual } from "node:crypto";

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function verifyAcuitySignature(
  rawBody: string,
  signature: string | null,
): boolean {
  if (!signature) return false;

  let apiKey: string;
  try {
    apiKey = requireEnv("ACUITY_API_KEY");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", apiKey).update(rawBody).digest("base64");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export type AcuityAppointment = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  type: string;
  datetime: string;
};

export async function fetchAcuityAppointment(
  id: string,
): Promise<AcuityAppointment> {
  const userId = requireEnv("ACUITY_USER_ID");
  const apiKey = requireEnv("ACUITY_API_KEY");
  const auth = Buffer.from(`${userId}:${apiKey}`).toString("base64");

  const response = await fetch(`${ACUITY_API_BASE}/appointments/${id}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    throw new Error(
      `Acuity API request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}
