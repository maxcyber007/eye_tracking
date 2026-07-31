/**
 * Participant identifier generation.
 *
 * Both the public assessment and the researcher collection page pre-fill this
 * field so an operator never has to invent a code mid-session — the commonest
 * source of duplicated and mistyped ids. The value stays editable: a study that
 * already has its own numbering should use it.
 */

/** Alphabet without the characters that get confused when read off a screen. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Length of the random tail. 4 chars of a 32-symbol alphabet is ~1M codes/day. */
const SUFFIX_LENGTH = 4;

/** Prefix marking an identifier as generated rather than supplied by a study. */
export const SUBJECT_ID_PREFIX = "P";

/**
 * Draw `count` symbols using `crypto` when it is available.
 *
 * `Math.random` is a fine fallback for a non-secret label, but the crypto path
 * avoids the biased low-entropy sequences some engines produce when many ids
 * are generated in the same millisecond.
 */
function randomSymbols(count: number): string {
  const out: string[] = [];
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(count);
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) out.push(ALPHABET[byte % ALPHABET.length]);
    return out.join("");
  }

  for (let index = 0; index < count; index += 1) {
    out.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
  }
  return out.join("");
}

/**
 * Build a fresh participant identifier, e.g. `P-260730-4KQ2`.
 *
 * The date makes a code sortable and tells you when it was issued; the random
 * tail keeps two devices collecting on the same day from colliding. Generated
 * on the client on purpose — the assessment page is public, so asking the
 * server for the next number would expose how many assessments exist.
 *
 * @param now Clock to read, injectable so tests are not time-dependent.
 * @returns A new identifier.
 */
export function generateSubjectId(now: Date = new Date()): string {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${SUBJECT_ID_PREFIX}-${year}${month}${day}-${randomSymbols(SUFFIX_LENGTH)}`;
}
