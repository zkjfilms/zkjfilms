// Server-side env access that fails loudly (rather than passing undefined
// along) when a required variable is missing.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}
