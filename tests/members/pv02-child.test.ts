// PV02 — parent-managed child profiles and under-13 collection limits.
import { beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, ADULT, KID_11, TEEN_14 } from '../helpers';

async function addMember(h: ReturnType<typeof makeHarness>, input: Record<string, unknown>) {
  const { applied } = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, input));
  if (!applied.ok || applied.status !== 'applied') throw new Error('setup failed');
  return applied.data;
}

describe('PV02: no auth fields on member', () => {
  const h = makeHarness();
  beforeAll(() => {
    h.consent.granted.add('measurements');
    h.consent.granted.add('allergies');
  });

  it('rejects email/phone/password keys on an adult member too', async () => {
    for (const key of ['email', 'phone', 'password', 'authProvider', 'login']) {
      const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, [key]: 'x' });
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation_failed');
      if (!r.ok && r.error.issues) {
        expect(r.error.issues.some((i) => i.code === 'auth_fields_forbidden')).toBe(true);
      }
    }
  });

  it('rejects identity/contact keys for a child (credentials, device, location)', async () => {
    for (const key of ['username', 'deviceId', 'geolocation', 'ssn']) {
      const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...KID_11, [key]: 'x' });
      expect(r.ok, key).toBe(false);
      if (!r.ok && r.error.issues) {
        expect(r.error.issues.some((i) => i.code === 'auth_fields_forbidden')).toBe(true);
      }
    }
  });

  it('stores a member with zero auth-ish columns — the record itself is proof', async () => {
    const m = await addMember(h, { ...KID_11 });
    const keys = Object.keys(m).map((k) => k.toLowerCase());
    for (const forbidden of ['email', 'phone', 'password', 'auth', 'login', 'credential']) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });
});

describe('PV02: under-13 collection limits', () => {
  const h = makeHarness();
  beforeAll(() => {
    h.consent.granted.add('measurements');
    h.consent.granted.add('allergies');
    h.consent.granted.add('conditions');
  });

  it('refuses weight for an 11-year-old even WITH measurement consent', async () => {
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...KID_11, weightKg: 32 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.issues) {
      expect(r.error.issues.some((i) => i.code === 'child_collection_limit' && i.field === 'weightKg')).toBe(true);
    }
  });

  it('refuses weight for a child on UPDATE as well', async () => {
    const m = await addMember(h, { ...KID_11 });
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { id: m.id, weightKg: 34 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.issues) expect(r.error.issues[0]?.code).toBe('child_collection_limit');
  });

  it('allows the planning set for a child: allergies, likes/dislikes, optional height', async () => {
    const m = await addMember(h, {
      ...KID_11,
      allergies: ['peanut'],
      likes: ['pasta'],
      dislikes: ['okra'],
      heightCm: 140,
    });
    const stored = await h.repo.getMember(h.householdId, m.id);
    expect(stored).not.toBeNull();
    const health = await h.health.getMemberHealth(m.id, h.householdId);
    expect(health?.allergies).toEqual(['peanut']);
    expect(health?.heightCm).toBe(140);
    expect(health?.weightKg).toBeUndefined();
  });

  it('allows weight for a 14-year-old (13-17 band) with measurement consent', async () => {
    const m = await addMember(h, { ...TEEN_14, weightKg: 55 });
    const health = await h.health.getMemberHealth(m.id, h.householdId);
    expect(health?.weightKg).toBe(55);
  });

  it('applies the limit by DERIVED age: a child turns 13, then weight becomes acceptable', async () => {
    const kid = makeHarness();
    kid.consent.granted.add('measurements');
    // same birthday month boundary used in age tests: 2013-11 turns 13 on 2026-11-01
    // 2026-10-16: born 2013-11 is still 12 — refused at validation.
    const before = await kid.service.createOrUpdateMember(kid.agentCtx(), {
      name: 'Meera', birthYm: '2013-11', sex: 'female', activityLevel: 'active', weightKg: 40,
    });
    expect(before.ok).toBe(false);
    if (!before.ok && before.error.issues) {
      expect(before.error.issues.some((i) => i.code === 'child_collection_limit')).toBe(true);
    }

    // 2026-11-02: derived age is now 13 — the same write is acceptable.
    kid.setNow('2026-11-02T00:00:00Z');
    const after = await kid.applyWithApproval((ctx) =>
      kid.service.createOrUpdateMember(ctx, { name: 'Meera', birthYm: '2013-11', sex: 'female', activityLevel: 'active', weightKg: 40 }),
    );
    expect(after.applied.ok && after.applied.status).toBe('applied');
  });
});
