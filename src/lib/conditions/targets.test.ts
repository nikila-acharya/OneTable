import { describe, it, expect } from 'vitest';
import { calculateTargets, type DRITarget } from './targets';

describe('Target calculator (WP-3.2, SG02/SG03)', () => {
  describe('calculateTargets: DRI-based general targets by age, sex, activity', () => {
    it('calculates daily energy requirement (EER) for an adult male, sedentary', () => {
      const target = calculateTargets({
        age: 30,
        sex: 'male',
        weight_kg: 80,
        height_cm: 180,
        activity: 'sedentary',
      });

      expect(target.energy_kcal).toBeGreaterThan(1800);
      expect(target.energy_kcal).toBeLessThan(2400);
    });

    it('calculates daily energy requirement for an adult female, moderate activity', () => {
      const target = calculateTargets({
        age: 28,
        sex: 'female',
        weight_kg: 65,
        height_cm: 165,
        activity: 'moderate',
      });

      expect(target.energy_kcal).toBeGreaterThan(1800);
      expect(target.energy_kcal).toBeLessThan(2400);
    });

    it('includes protein recommendation (RDA) based on weight', () => {
      const target = calculateTargets({
        age: 35,
        sex: 'male',
        weight_kg: 100,
        height_cm: 180,
        activity: 'moderate',
      });

      // RDA: 0.8 g/kg for adults
      expect(target.protein_g).toBe(100 * 0.8);
    });

    it('includes fiber (DGA 2020-2025)', () => {
      const target = calculateTargets({
        age: 35,
        sex: 'male',
        weight_kg: 80,
        height_cm: 180,
        activity: 'moderate',
      });

      // Men 19-50: 38 g/day
      expect(target.fiber_g).toBe(38);
    });

    it('calculates targets for a child (6–12 years)', () => {
      const target = calculateTargets({
        age: 8,
        sex: 'female',
        weight_kg: 30,
        height_cm: 130,
        activity: 'moderate',
      });

      expect(target.energy_kcal).toBeGreaterThan(1000);
      expect(target.energy_kcal).toBeLessThan(2000);
      // Under 18: maintenance only (SG02)
      expect(target.includes_growth).toBe(true);
      expect(target.weight_loss_allowed).toBe(false);
    });

    it('raises an error if asked for a deficit for a member under 18 (SG02)', () => {
      // The direct SG02 guard: method-level rejection
      expect(() => {
        calculateTargets({
          age: 15,
          sex: 'male',
          weight_kg: 70,
          height_cm: 175,
          activity: 'moderate',
          deficit_kcal: 500, // SG02: rejected
        });
      }).toThrow(/SG02|under 18|deficit/i);
    });

    it('raises an error if allow_deficit option is set for under 18', () => {
      // The direct SG02 guard: method-level rejection via options
      expect(() => {
        calculateTargets(
          {
            age: 17,
            sex: 'female',
            weight_kg: 60,
            height_cm: 165,
            activity: 'moderate',
          },
          { allow_deficit: true } // This should be rejected for under-18
        );
      }).toThrow(/SG02|under 18|deficit/i);
    });

    it('calculates adult energy floor (SG03): hard lower bound', () => {
      // SG03 floors are loaded from rules/energy_floors.yaml
      // For now, this test just verifies the method can flag the floor
      const target = calculateTargets({
        age: 25,
        sex: 'female',
        weight_kg: 65,
        height_cm: 165,
        activity: 'sedentary',
      });

      expect(target).toHaveProperty('energy_floor_kcal');
      expect(target.energy_floor_kcal).toBeGreaterThan(1000);
    });

    it('stores cited source URLs for each recommendation', () => {
      const target = calculateTargets({
        age: 35,
        sex: 'male',
        weight_kg: 80,
        height_cm: 180,
        activity: 'moderate',
      });

      expect(target.sources).toBeDefined();
      expect(target.sources.energy).toContain('National Academies');
      expect(target.sources.protein).toContain('RDA');
      expect(target.sources.fiber).toContain('Dietary Guidelines');
    });
  });

  describe('AC: targets are loaded from cited data files, not hard-coded guesses', () => {
    it('loads targets from a versioned reference file', () => {
      // M3.2 must load from data/dri-targets-2025.json or similar
      // For now, the test just verifies the method returns structured targets
      const target = calculateTargets({
        age: 30,
        sex: 'male',
        weight_kg: 80,
        height_cm: 180,
        activity: 'moderate',
      });

      expect(target).toMatchObject({
        energy_kcal: expect.any(Number),
        protein_g: expect.any(Number),
        fiber_g: expect.any(Number),
      });
    });
  });

  describe('Energy floor placeholder (SG03, values reviewed_by: false)', () => {
    it('marks floor values as unreviewed until RD signs off', () => {
      // This test just verifies the infrastructure
      // Real floors come from rules/energy_floors.yaml with reviewed_by: null
      const target = calculateTargets({
        age: 30,
        sex: 'female',
        weight_kg: 65,
        height_cm: 165,
        activity: 'moderate',
      });

      expect(target).toHaveProperty('energy_floor_kcal');
      expect(target).toHaveProperty('energy_floor_reviewed');
      // For M3, the RD hasn't reviewed yet
      expect(target.energy_floor_reviewed).toBe(false);
    });
  });
});
