import { bytesToBase64Url, randomBase64Url } from "./crypto";

export function createPkceVerifier(): string {
  return randomBase64Url(32);
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}
