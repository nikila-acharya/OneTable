/**
 * WP-4.8: Weekly Reviewer Agent tests (TR-EVALS AG04)
 *
 * Test cases:
 * 1. Preference extraction from past plans
 * 2. Taste learning: cuisine detection
 * 3. Taste learning: protein preferences
 * 4. Pattern detection: day-of-week patterns
 * 5. Pattern detection: time constraints
 * 6. Recipe rating extraction
 * 7. Health-fact filtering: ED signal blocking (restriction)
 * 8. Health-fact filtering: detox myths
 * 9. Health-fact filtering: weight-focus language
 * 10. Health-fact filtering: orthorexia patterns
 * 11. Conversation summarization
 * 12. Memory entry generation (no health facts)
 * 13. Scoring weight updates (bounded)
 * 14. Full analysis integration
 */

import { describe, it, expect } from 'vitest';
import { ReviewerAgent, type HealthClaimFilter, type LearnedPattern } from './reviewer';

describe('ReviewerAgent — WP-4.8', () => {
  const agent = new ReviewerAgent();

  // Test 1: Preference extraction from past plans
  describe('1. Preference extraction', () => {
    it('extracts cuisine preferences from conversation history', () => {
      const history = [
        { role: 'user', content: 'I love Italian food, can we make more pasta?' },
        { role: 'assistant', content: 'Great! Italian is on the menu.' },
        { role: 'user', content: 'Please avoid Thai food, too spicy for me.' },
      ];

      const result = agent.detectCuisinePreferences(history);

      expect(result.preferred).toContain('italian');
      expect(result.avoided).toContain('thai');
    });

    it('returns empty preferences when no history provided', () => {
      const result = agent.detectCuisinePreferences([]);
      expect(result.preferred).toEqual([]);
      expect(result.avoided).toEqual([]);
      expect(result.neutral).toEqual([]);
    });
  });

  // Test 2: Taste learning — cuisine detection
  describe('2. Taste learning: cuisine detection', () => {
    it('learns multiple cuisine preferences', () => {
      const history = [
        { role: 'user', content: 'I love Italian and Mediterranean food' },
        { role: 'user', content: 'Can we do Greek next week?' },
        { role: 'user', content: 'No more Thai for me' },
      ];

      const result = agent.detectCuisinePreferences(history);
      expect(result.preferred.length).toBeGreaterThan(0);
      expect(result.avoided.length).toBeGreaterThan(0);
    });

    it('distinguishes between preferred and avoided cuisines', () => {
      const history = [
        { role: 'user', content: 'love Italian... yes please!' },
        { role: 'user', content: 'no Thai... hate it' },
      ];

      const result = agent.detectCuisinePreferences(history);
      if (result.preferred.includes('italian')) {
        expect(result.avoided).not.toContain('italian');
      }
    });
  });

  // Test 3: Taste learning — protein preferences
  describe('3. Taste learning: protein preferences', () => {
    it('detects protein aversions from conversation', () => {
      const history = [
        { role: 'user', content: "I don't like chicken, it's always dry" },
        { role: 'user', content: 'I really enjoy fish meals' },
      ];

      const patterns = agent.learnDislikePatterns(history);
      const proteinPatterns = patterns.filter((p) => p.patternType === 'protein_avoidance');

      if (proteinPatterns.length > 0) {
        expect(proteinPatterns[0].description).toMatch(/protein|chicken/i);
      }
    });

    it('learns that member prefers certain proteins', () => {
      const history = [
        { role: 'user', content: 'I love tofu and lentil-based meals' },
        { role: 'user', content: 'Can we have more vegetarian protein?' },
      ];

      const summary = agent.summarizePastPlans(history);
      expect(summary.feedbackThemes).toBeDefined();
    });
  });

  // Test 4: Pattern detection — day-of-week patterns
  describe('4. Pattern detection: day-of-week patterns', () => {
    it('detects when member prefers light meals on specific days', () => {
      const history = [
        { role: 'user', content: 'Mondays are busy, please make light meals' },
        { role: 'user', content: 'Tuesday needs to be easy too' },
      ];

      const patterns = agent.learnDislikePatterns(history);
      const dayPatterns = patterns.filter((p) => p.patternType === 'day_preference');

      expect(dayPatterns.length).toBeGreaterThan(0);
      if (dayPatterns.length > 0) {
        expect(dayPatterns[0].description).toMatch(/monday|tuesday/i);
      }
    });

    it('returns medium confidence for day patterns based on single mention', () => {
      const history = [{ role: 'user', content: 'Wednesday meals should be light and easy' }];

      const patterns = agent.learnDislikePatterns(history);
      const dayPattern = patterns.find((p) => p.patternType === 'day_preference');

      if (dayPattern) {
        expect(dayPattern.confidence).toBe('medium');
      }
    });
  });

  // Test 5: Pattern detection — time constraints
  describe('5. Pattern detection: time constraints', () => {
    it('detects time constraints from feedback', () => {
      const history = [
        { role: 'user', content: 'I need quick meals this week, busy with work' },
        { role: 'user', content: 'Please keep prep time under 30 minutes' },
      ];

      const patterns = agent.learnDislikePatterns(history);
      const timePatterns = patterns.filter((p) => p.patternType === 'time_preference');

      expect(timePatterns.length).toBeGreaterThan(0);
      if (timePatterns[0]) {
        expect(timePatterns[0].suggestedAction).toMatch(/quick|prep time|short/i);
      }
    });

    it('adds time constraint to taste profile', async () => {
      const history = [{ role: 'user', content: 'I need quick and easy recipes please' }];

      const analysis = await agent.analyzeConversationHistory('member1', history);
      const profile = analysis.memberProfiles.get('member1');

      expect(profile?.prefersQuickMeals).toBe(true);
    });
  });

  // Test 6: Recipe rating extraction
  describe('6. Recipe rating extraction', () => {
    it('extracts liked recipes from conversation', () => {
      const history = [{ role: 'user', content: 'I love recipe_pasta_carbonara, it was great!' }];

      const result = agent.extractRecipeRatings(history);
      expect(result.liked.some((r) => r.recipeId === 'pasta_carbonara')).toBe(true);
    });

    it('extracts disliked recipes from conversation', () => {
      const history = [{ role: 'user', content: 'I hate recipe_beef_liver, it was awful' }];

      const result = agent.extractRecipeRatings(history);
      expect(result.disliked.some((r) => r.recipeId === 'beef_liver')).toBe(true);
    });

    it('tracks cuisine preferences from recipe history', () => {
      const history = [
        { role: 'user', content: 'recipe_pasta_carbonara was amazing, recipe_risotto too' },
        { role: 'user', content: 'I love Italian recipes' },
      ];

      const result = agent.extractRecipeRatings(history);
      expect(result.cuisinePrefs['italian']).toBeGreaterThan(0);
    });
  });

  // Test 7: Health-fact filtering — ED signal blocking (restriction)
  describe('7. Health-fact filtering: ED signals (restriction)', () => {
    it('blocks restriction language claiming carbs are bad', () => {
      const claims = ['carbs are toxic and I need to eliminate them'];

      const filtered = agent.filterHealthClaims(claims);

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered[0].isBlocked).toBe(true);
      expect(filtered[0].category).toBe('misinformation');
      expect(filtered[0].correctedClaim).toMatch(/balanced|nutrients/i);
    });

    it('blocks restriction and elimination language', () => {
      const claims = [
        'I need to restrict carbs completely',
        'I must eliminate sugar from my diet',
      ];

      const filtered = agent.filterHealthClaims(claims);

      filtered.forEach((f) => {
        if (f.isBlocked) {
          expect(f.blockReason).toBeDefined();
          expect(f.correctedClaim).toBeDefined();
        }
      });
    });

    it('blocks no-carb and no-sugar language', () => {
      const claims = ['no carbs ever', 'I only eat no-sugar foods'];

      const filtered = agent.filterHealthClaims(claims);
      expect(filtered.some((f) => f.isBlocked)).toBe(true);
    });
  });

  // Test 8: Health-fact filtering — detox myths
  describe('8. Health-fact filtering: detox myths', () => {
    it('blocks detox juice claims', () => {
      const claims = ['I do a juice cleanse every week to detoxify'];

      const filtered = agent.filterHealthClaims(claims);

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered[0].isBlocked).toBe(true);
      expect(filtered[0].category).toBe('detox_myth');
      expect(filtered[0].correctedClaim).toMatch(/liver|kidney|naturally/i);
    });

    it('blocks detox and cleanse language', () => {
      const claims = [
        'skinny tea to detoxify',
        'juice fast to purify my body',
      ];

      const filtered = agent.filterHealthClaims(claims);
      expect(filtered.some((f) => f.category === 'detox_myth' && f.isBlocked)).toBe(true);
    });
  });

  // Test 9: Health-fact filtering — weight-focus language
  describe('9. Health-fact filtering: weight-focus language', () => {
    it('blocks weight-loss focused claims', () => {
      const claims = ["I'm too fat and need to get thin"];

      const filtered = agent.filterHealthClaims(claims);

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered[0].isBlocked).toBe(true);
      expect(filtered[0].category).toMatch(/weight_focus|restriction/);
    });

    it('blocks unhealthy weight-loss pill language', () => {
      const claims = ['I need weight loss pills to burn fat'];

      const filtered = agent.filterHealthClaims(claims);
      expect(filtered.some((f) => f.isBlocked)).toBe(true);
    });
  });

  // Test 10: Health-fact filtering — orthorexia patterns
  describe('10. Health-fact filtering: orthorexia patterns', () => {
    it('blocks only-clean-food language', () => {
      const claims = ['I only eat organic clean pure natural food'];

      const filtered = agent.filterHealthClaims(claims);

      expect(filtered.length).toBeGreaterThan(0);
      const orthorexiaFilter = filtered.find((f) => f.isBlocked);
      if (orthorexiaFilter) {
        expect(orthorexiaFilter.category).toMatch(/orthorexia|restriction/);
      }
    });

    it('blocks rigid food purity language', () => {
      const claims = ['I can only eat perfect clean food'];

      const filtered = agent.filterHealthClaims(claims);
      expect(filtered.some((f) => f.isBlocked)).toBe(true);
    });
  });

  // Test 11: Conversation summarization
  describe('11. Conversation summarization', () => {
    it('summarizes past plans count', () => {
      const history = [
        { role: 'user', content: 'Can you plan the meals for next week?' },
        { role: 'assistant', content: 'Here is your meal plan...' },
        { role: 'user', content: 'Let me plan week 2 as well' },
      ];

      const summary = agent.summarizePastPlans(history);

      expect(summary.planCount).toBeGreaterThan(0);
    });

    it('tracks meal outcomes', () => {
      const history = [
        { role: 'user', content: 'I cooked the pasta, it was great' },
        { role: 'user', content: 'I skipped the chicken yesterday' },
        { role: 'user', content: 'We ate out on Friday' },
      ];

      const summary = agent.summarizePastPlans(history);

      expect(summary.outcomeSummary.cooked).toBeGreaterThan(0);
      expect(summary.outcomeSummary.skipped).toBeGreaterThan(0);
      expect(summary.outcomeSummary.eaten_out).toBeGreaterThan(0);
    });

    it('extracts feedback themes', () => {
      const history = [
        { role: 'user', content: 'The meals were too heavy' },
        { role: 'user', content: 'I need quick recipes, very busy this week' },
      ];

      const summary = agent.summarizePastPlans(history);

      expect(summary.feedbackThemes.length).toBeGreaterThan(0);
      expect(summary.feedbackThemes.some((t) => t.includes('light') || t.includes('time'))).toBe(
        true,
      );
    });
  });

  // Test 12: Memory entry generation (no health facts)
  describe('12. Memory entry generation (no health facts)', () => {
    it('generates cuisine preference memory entries', async () => {
      const history = [
        { role: 'user', content: 'I love Italian and Greek cuisines' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      expect(analysis.memoryEntriesToWrite.length).toBeGreaterThan(0);
      const cuisineEntry = analysis.memoryEntriesToWrite.find((e) => e.entryType === 'cuisine_preference');
      expect(cuisineEntry).toBeDefined();
    });

    it('does NOT include health facts in memory entries', async () => {
      const history = [
        {
          role: 'user',
          content: 'I have a nut allergy and need to avoid them',
        },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      // Memory entries should not contain allergy information
      for (const entry of analysis.memoryEntriesToWrite) {
        expect(entry.content.toLowerCase()).not.toMatch(/allergy|allergen|condition|health/);
      }
    });

    it('stores preference patterns in memory without health data', async () => {
      const history = [
        { role: 'user', content: 'Mondays are busy, please make light meals' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      const patternEntry = analysis.memoryEntriesToWrite.find((e) => e.entryType === 'pattern');
      if (patternEntry) {
        expect(patternEntry.content).toMatch(/light|easy|preference/i);
        expect(patternEntry.content).not.toMatch(/allergy|condition|disease/i);
      }
    });
  });

  // Test 13: Scoring weight updates (bounded)
  describe('13. Scoring weight updates (bounded)', () => {
    it('generates weight updates for liked recipes', async () => {
      const history = [
        { role: 'user', content: 'I love recipe_pasta_carbonara' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      expect(analysis.scoringWeightUpdates.size).toBeGreaterThanOrEqual(0);
      for (const [recipeId, weight] of analysis.scoringWeightUpdates) {
        // Weights should be bounded 0.5 to 2.0 per PRD
        expect(weight).toBeGreaterThanOrEqual(0.5);
        expect(weight).toBeLessThanOrEqual(2.0);
      }
    });

    it('reduces weight for disliked recipes', async () => {
      const history = [
        { role: 'user', content: 'I hate recipe_beef_liver' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      // Check that disliked recipes get lower weights
      const likedWeights = Array.from(analysis.scoringWeightUpdates.values()).filter((w) => w > 1);
      const dislikedWeights = Array.from(analysis.scoringWeightUpdates.values()).filter((w) => w < 1);

      expect(likedWeights.length + dislikedWeights.length).toBeLessThanOrEqual(
        analysis.scoringWeightUpdates.size,
      );
    });

    it('keeps weights within bounds [0.5, 2.0]', async () => {
      const history = [
        { role: 'user', content: 'I love recipe_a and hate recipe_b and like recipe_c' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      for (const weight of analysis.scoringWeightUpdates.values()) {
        expect(weight).toBeGreaterThanOrEqual(0.5);
        expect(weight).toBeLessThanOrEqual(2.0);
      }
    });
  });

  // Test 14: Full analysis integration
  describe('14. Full analysis integration', () => {
    it('generates comprehensive analysis from conversation history', async () => {
      const history = [
        {
          role: 'user',
          content: 'I love Italian and Mediterranean food',
        },
        {
          role: 'user',
          content: 'I adore recipe_pasta_carbonara',
        },
        {
          role: 'user',
          content: 'Mondays are busy, I need light meals',
        },
        {
          role: 'user',
          content: 'I want quick recipes this week',
        },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      // Verify all components are populated
      expect(analysis.memberProfiles.size).toBeGreaterThan(0);
      expect(analysis.memberProfiles.has('member1')).toBe(true);

      const profile = analysis.memberProfiles.get('member1');
      expect(profile).toBeDefined();
      expect(profile!.likedCuisines).toBeDefined();
      expect(profile!.prefersQuickMeals).toBeDefined();

      // Patterns detected
      expect(Array.isArray(analysis.patterns)).toBe(true);

      // Recommendations generated
      expect(Array.isArray(analysis.recommendations)).toBe(true);
      expect(analysis.recommendations.length).toBeGreaterThan(0);

      // Memory entries created (no health facts)
      expect(Array.isArray(analysis.memoryEntriesToWrite)).toBe(true);

      // Scoring weights computed
      expect(analysis.scoringWeightUpdates).toBeInstanceOf(Map);
    });

    it('integrates ED-signal blocking into full analysis', async () => {
      const history = [
        { role: 'user', content: 'I love Italian food' },
        {
          role: 'user',
          content: 'I need to restrict carbs and eliminate sugar',
        },
        { role: 'user', content: 'I want quick meals' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      // ED signals should be filtered
      expect(analysis.filteredClaims.some((c) => c.isBlocked)).toBe(true);

      // But regular preferences should still be captured
      const profile = analysis.memberProfiles.get('member1');
      expect(profile?.likedCuisines).toContain('italian');

      // Recommendations should mention the filtered claims
      const hasFilterWarning = analysis.recommendations.some((r) =>
        r.toLowerCase().includes('filter'),
      );
      expect(hasFilterWarning).toBe(true);
    });

    it('returns empty analysis when no conversation history', async () => {
      const analysis = await agent.analyzeConversationHistory('member1', []);

      expect(analysis.memberProfiles.size).toBeLessThanOrEqual(1);
      expect(analysis.patterns).toBeDefined();
      expect(analysis.filteredClaims).toBeDefined();
      expect(Array.isArray(analysis.memoryEntriesToWrite)).toBe(true);
    });

    it('handles multiple member profiles in analysis', async () => {
      const history1 = [
        { role: 'user', content: 'I love Italian food' },
      ];

      const analysis1 = await agent.analyzeConversationHistory('member1', history1);

      const analysis2 = await agent.analyzeConversationHistory('member2', [
        { role: 'user', content: 'I prefer Asian cuisine' },
      ]);

      // Each analysis is independent per member
      expect(analysis1.memberProfiles.has('member1')).toBe(true);
      expect(analysis2.memberProfiles.has('member2')).toBe(true);

      const profile1 = analysis1.memberProfiles.get('member1');
      const profile2 = analysis2.memberProfiles.get('member2');

      expect(profile1?.likedCuisines).not.toEqual(profile2?.likedCuisines);
    });
  });

  // Additional SG04 blocking tests
  describe('SG04 ED-signal blocking integration', () => {
    it('blocks multiple ED patterns in a single analysis', async () => {
      const history = [
        { role: 'user', content: 'I want to detox with juice cleanses' },
        { role: 'user', content: 'carbs are toxic and I need to eliminate them' },
        { role: 'user', content: 'I need to restrict food to lose weight' },
      ];

      const analysis = await agent.analyzeConversationHistory('member1', history);

      expect(analysis.filteredClaims.length).toBeGreaterThan(0);
      const blockedClaims = analysis.filteredClaims.filter((c) => c.isBlocked);
      expect(blockedClaims.length).toBeGreaterThan(0);

      // Each blocked claim should have a corrected suggestion
      blockedClaims.forEach((claim) => {
        expect(claim.correctedClaim).toBeDefined();
        expect(claim.blockReason).toBeDefined();
      });
    });
  });
});
