/**
 * Age is derived from the birth month (PR01: birth year + month; never an exact
 * DOB). Measured from the 1st of the birth month, so a child turns a year older
 * on the 1st of their birth month, and nothing stored drifts.
 */
export function deriveAgeYears(birthYm: string, now: Date): number {
  const [y, m] = birthYm.split("-").map(Number) as [number, number];
  const nowY = now.getUTCFullYear();
  const nowM = now.getUTCMonth() + 1;
  return nowY - y - (nowM >= m ? 0 : 1);
}

/** PV02/SG02: under-18 is the boundary for child rules. */
export function isChildAge(birthYm: string, now: Date): boolean {
  return deriveAgeYears(birthYm, now) < 18;
}
