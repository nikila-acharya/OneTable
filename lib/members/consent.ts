// ConsentGate — seam to WP-1.1 (PV01 consent flow and storage).
// WP-1.2 never stores consent itself; it consults the gate before health-bearing
// writes and fails the whole write with `consent_required` when absent (PV01 AC:
// "an API request or agent tool call that writes a condition without health consent
// returns 403 and stores nothing").

export type ConsentDataType = 'measurements' | 'allergies' | 'conditions';

export interface ConsentGate {
  hasConsent(householdId: string, dataType: ConsentDataType): Promise<boolean>;
}

/** Default when WP-1.1 is not wired yet: deny everything. Fails closed. */
export const denyAllConsent: ConsentGate = {
  async hasConsent() {
    return false;
  },
};

/** Test/dev helper: allow a fixed set of data types. */
export function allowConsentTypes(types: ReadonlySet<ConsentDataType>): ConsentGate {
  return {
    async hasConsent(_householdId, dataType) {
      return types.has(dataType);
    },
  };
}
