/**
 * WP-4.8: Weekly Reviewer Agent (AG04)
 *
 * Learns from past meal plans and household member feedback:
 * - Reads past plans, outcomes (cooked, skipped, eaten out), and conversation history
 * - Extracts preference signals: liked recipes, disliked meals, cuisine preferences
 * - Detects learned patterns: "user always rejects heavy dinners on Tue" → schedule light meals
 * - Filters health claims: blocks ED-promoting myths ("carbs are bad", "detox juice")
 * - Returns structured analysis without storing health facts
 *
 * AG04: Updates planner scoring weights, writes preference memory (no health facts),
 * and provides a "what changed" summary for user review.
 *
 * Permission levels:
 * - R: get_plan, get_memory, list_outcomes
 * - A: write_memory, update_scoring_weights
 * - NO X-level access
 */

/**
 * A member's preference profile extracted from conversation history and past plans.
 */
export interface TasteProfile {
  /** Cuisines the member has selected or rated highly */
  likedCuisines: string[];
  /** Cuisines or meal types the member has rejected */
  dislikedCuisines: string[];
  /** Proteins the member tends to accept */
  likedProteins: string[];
  /** Proteins the member tends to reject */
  dislikedProteins: string[];
  /** Meals the member rates highly (by recipe ID) */
  favoriteRecipeIds: string[];
  /** Meals the member rejects (by recipe ID) */
  rejectedRecipeIds: string[];
  /** True if this member prefers quick meals */
  prefersQuickMeals?: boolean;
  /** True if this member prefers complex/involved meals */
  prefersComplexMeals?: boolean;
  /** Day-of-week patterns: { 'monday': 'light', 'tuesday': 'light', ... } */
  dayPatterns?: Record<string, 'light' | 'heavy' | 'balanced' | 'unknown'>;
}

/**
 * A pattern detected in member behavior or preferences.
 */
export interface LearnedPattern {
  /** Pattern type: day preference, protein avoidance, cuisine shift, time constraint, etc. */
  patternType: string;
  /** Human-readable description */
  description: string;
  /** Confidence: 'high', 'medium', 'low' based on evidence count */
  confidence: 'high' | 'medium' | 'low';
  /** Number of data points supporting this pattern */
  evidenceCount: number;
  /** Suggested action for the meal planner */
  suggestedAction?: string;
}

/**
 * A health claim found in conversation or memory, flagged if it violates evidence-based guidance.
 */
export interface HealthClaimFilter {
  /** The claim text (e.g., "carbs are toxic") */
  claim: string;
  /** ED signal category or health misinformation type */
  category:
    | 'restriction'
    | 'orthorexia'
    | 'detox_myth'
    | 'weight_focus'
    | 'misinformation'
    | 'other';
  /** True if this claim should block memory write */
  isBlocked: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Evidence-based counter-message */
  correctedClaim?: string;
}

/**
 * Output from the Reviewer Agent: structured learnings from past plans and feedback.
 */
export interface ReviewerAnalysis {
  /** Per-member taste profiles */
  memberProfiles: Map<string, TasteProfile>;
  /** Detected patterns across the household */
  patterns: LearnedPattern[];
  /** Health claims that were filtered out (ED signals, misinformation) */
  filteredClaims: HealthClaimFilter[];
  /** Recommendations for the next planner run */
  recommendations: string[];
  /** Memory entries safe to write (no health facts) */
  memoryEntriesToWrite: Array<{
    memberId: string;
    entryType: 'recipe_preference' | 'cuisine_preference' | 'pattern' | 'note';
    content: string;
    source: string;
  }>;
  /** Weight adjustments for planner scoring (per recipe ID) */
  scoringWeightUpdates: Map<string, number>;
}

/**
 * ED-promoting and misinformation claims that should be filtered.
 * Patterns from SG04 extended for memory review context.
 */
const ED_CLAIM_PATTERNS = [
  // Restriction and disordered eating language
  /\b(carbs? are (toxic|poison|bad|evil))/i,
  /\b(sugar is (toxic|poison|bad|evil))/i,
  /\b(I need to (restrict|eliminate|cut out) (carbs?|sugar|fat|protein))/i,
  /\b((almost )?no? (carbs?|sugar|fat|protein)( ever)?)/i,
  /\b(detox(ify)?|cleanse|purify) (juice|tea|fast)/i,
  /\b(juice ?only|juice fast|juice cleanse)/i,
  /\b(skinny (tea|coffee|juice))/i,
  /\b(weight ?(loss|reduction) (pill|supplement|drink|tea))/i,
  /\b(fat ?burn(ing|er))/i,
  /\b(calorie (cutting|restriction|deficit).*extreme)/i,
  /\b(eat ?less|skip ?(meals?|breakfast|lunch|dinner).*(?:lose weight|slim|thin))/i,
  /\b((excessive|compulsive) ?(exercise|working out?))/i,
  /\b(orthorex|ortho-rex)/i,
  /\b(only ?(organic|clean|pure|natural) food)/i,
  // Rigid purity rules ("I only eat organic clean pure natural food",
  // "I can only eat perfect clean food") never matched: the pattern above needs
  // the adjective directly against "food", so these claims passed unfiltered.
  /\bonly\s+(?:eat|eating|have|drink)\b[^.!?]*\b(clean|pure|organic|natural|perfect|wholesome)\b/i,
  /\b(can\s+only\s+eat)\b/i,
  /\b(clean|pure|perfect|real)\s+food/i,
  /\b(food\s+purity|pure\s+eating|toxic\s+food)\b/i,
  /\b(this (will |food )makes you (fat|obese|gain weight))/i,
  // Weight-focused language
  /\b(I'm (too )?fat|I'm ?(so )?obese)/i,
  /\b(I need to (get |be )?thin(ner)?)/i,
  /\b((only )?thin|skinny) (people|girls|women|bodies)/i,
  // Misinformation about health
  /\b(sugar causes diabetes)/i,
  /\b(fat (makes you fat|clogs arteries))/i,
  /\b(carbs? (spike|raise|cause) (blood ?sugar|diabetes))/i,
];

/**
 * Positive health terms that should NOT be filtered.
 */
const POSITIVE_HEALTH_TERMS = [
  'balanced',
  'nutrient-dense',
  'wholesome',
  'healthy',
  'energizing',
  'nourishing',
  'well-balanced',
  'variety',
];

/**
 * ReviewerAgent: learns from past member feedback and meal outcomes.
 */
export class ReviewerAgent {
  private agentId = 'reviewer';

  /**
   * Summarize past meal plans and feedback from conversation history.
   */
  summarizePastPlans(conversationHistory: Array<{ role: string; content: string }>): {
    planCount: number;
    outcomeSummary: Record<string, number>;
    feedbackThemes: string[];
  } {
    if (!conversationHistory || conversationHistory.length === 0) {
      return { planCount: 0, outcomeSummary: {}, feedbackThemes: [] };
    }

    let planCount = 0;
    const outcomes: Record<string, number> = {
      cooked: 0,
      skipped: 0,
      eaten_out: 0,
      modified: 0,
    };
    const feedbackThemes: string[] = [];

    for (const msg of conversationHistory) {
      const content = msg.content.toLowerCase();

      // Count plan mentions
      if (content.includes('plan') && (content.includes('week') || content.includes('meal'))) {
        planCount++;
      }

      // Track outcomes
      if (content.includes('cooked') || content.includes('made')) outcomes.cooked++;
      if (content.includes('skip') || content.includes('skipped')) outcomes.skipped++;
      if (content.includes('ate out') || content.includes('restaurant')) outcomes.eaten_out++;
      if (content.includes('modified') || content.includes('changed')) outcomes.modified++;

      // Extract themes
      if (content.includes('too heavy')) feedbackThemes.push('prefers_light_meals');
      if (content.includes('too spicy')) feedbackThemes.push('avoid_spicy');
      if (content.includes('too bland')) feedbackThemes.push('prefers_flavored');
      if (content.includes('quick') || content.includes('fast')) feedbackThemes.push('time_constraint');
      if (content.includes('vegetarian') || content.includes('vegan')) feedbackThemes.push('plant_based');
      if (content.includes('expensive')) feedbackThemes.push('cost_conscious');
    }

    return {
      planCount: Math.max(1, planCount), // At least 1 inferred
      outcomeSummary: outcomes,
      feedbackThemes: [...new Set(feedbackThemes)],
    };
  }

  /**
   * Extract recipe ratings and preferences from conversation history.
   */
  extractRecipeRatings(conversationHistory: Array<{ role: string; content: string }>): {
    liked: Array<{ recipeId: string; reason?: string }>;
    disliked: Array<{ recipeId: string; reason?: string }>;
    cuisinePrefs: Record<string, number>;
  } {
    const liked: Array<{ recipeId: string; reason?: string }> = [];
    const disliked: Array<{ recipeId: string; reason?: string }> = [];
    const cuisinePrefs: Record<string, number> = {};

    if (!conversationHistory) return { liked, disliked, cuisinePrefs };

    for (const msg of conversationHistory) {
      if (msg.role !== 'user') continue;
      const content = msg.content.toLowerCase();

      // Recipe ids arrive as `recipe_pasta_carbonara`. The old pattern required a
      // colon or space after "recipe", so the canonical underscore form never
      // matched and every rating came back empty. The separator is required, so
      // the plural word "recipes" cannot be captured as an id.
      const MENTION = /recipe(?:[_-]|[:\s])([a-z][a-z0-9]*(?:[_-][a-z0-9]+)*)/gi;
      const LIKE = /\b(loved|loves|love|great|amazing|favorite|favourite|excellent|wonderful|delicious|liked|likes)\b/;
      const DISLIKE = /\b(hated|hate|awful|terrible|disliked|dislike|disgusting|gross|nasty|never)\b/;

      // Sentiment is read per clause, the same way cuisine preference is, so a
      // praise word about one dish cannot attach to a different dish in the
      // same message.
      for (const clause of content.split(/[,.;!?]+/)) {
        const avoid = DISLIKE.test(clause);
        const prefer = !avoid && LIKE.test(clause);
        if (!avoid && !prefer) continue;

        for (const m of clause.matchAll(MENTION)) {
          const recipeId = m[1];
          if (!recipeId) continue;
          const entry = { recipeId, reason: clause.trim().slice(0, 100) };
          if (avoid) disliked.push(entry);
          else liked.push(entry);
        }
      }

      // Cuisine preferences
      const cuisines = [
        'italian',
        'mexican',
        'asian',
        'indian',
        'thai',
        'greek',
        'french',
        'mediterranean',
      ];
      for (const cuisine of cuisines) {
        if (content.includes(cuisine)) {
          cuisinePrefs[cuisine] = (cuisinePrefs[cuisine] ?? 0) + 1;
        }
      }
    }

    return { liked, disliked, cuisinePrefs };
  }

  /**
   * Detect cuisine preferences from conversation history and meal outcomes.
   */
  detectCuisinePreferences(conversationHistory: Array<{ role: string; content: string }>): {
    preferred: string[];
    avoided: string[];
    neutral: string[];
  } {
    const cuisines: Record<string, 'preferred' | 'avoided' | 'neutral'> = {};
    const cuisineList = [
      'italian',
      'mexican',
      'asian',
      'chinese',
      'japanese',
      'thai',
      'indian',
      'greek',
      'mediterranean',
      'french',
    ];

    if (!conversationHistory) return { preferred: [], avoided: [], neutral: [] };

    // Sentiment is read per clause, not per phrase template. The previous version
    // matched hardcoded strings like `no ${cuisine}`, so "No more Thai for me" and
    // "Please avoid Thai food" both fell through to neutral and the household's
    // stated aversion was never learned.
    const POSITIVE =
      /\b(love|loves|liked|likes|enjoy\w*|prefer\w*|favorite|favourite|great|amazing|delicious|awesome|more)\b/;
    const NEGATIVE =
      /\b(no|never|stop|dislike\w*|hate|avoid\w*|skip\w*|can't|cannot|not a fan|too spicy|get rid)\b/;

    for (const msg of conversationHistory) {
      // Only the household's own words are evidence of taste: learning a
      // preference from the assistant echoing "Italian is on the menu" would
      // reinforce whatever the agent itself served.
      if (msg.role !== 'user') continue;

      const clauses = msg.content.toLowerCase().split(/[,.;!?]+/);
      for (const cuisine of cuisineList) {
        for (const clause of clauses) {
          if (!clause.includes(cuisine)) continue;

          const avoided = NEGATIVE.test(clause);
          const preferred = !avoided && POSITIVE.test(clause);
          const next = avoided ? 'avoided' : preferred ? 'preferred' : 'neutral';

          // A stated aversion outranks an earlier positive reading of the same
          // cuisine, and a direct statement outranks a bare mention.
          const current = cuisines[cuisine];
          if (current === 'avoided') continue;
          if (current === 'preferred' && next === 'neutral') continue;
          cuisines[cuisine] = next;
        }
      }
    }

    return {
      preferred: Object.entries(cuisines)
        .filter(([, v]) => v === 'preferred')
        .map(([k]) => k),
      avoided: Object.entries(cuisines)
        .filter(([, v]) => v === 'avoided')
        .map(([k]) => k),
      neutral: Object.entries(cuisines)
        .filter(([, v]) => v === 'neutral')
        .map(([k]) => k),
    };
  }

  /**
   * Learn dislike patterns from member feedback and outcomes.
   */
  learnDislikePatterns(conversationHistory: Array<{ role: string; content: string }>): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];
    const contentJoined = conversationHistory.map((m) => m.content).join(' ').toLowerCase();

    // Day-of-week patterns
    const dayPatterns = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of dayPatterns) {
      if (
        contentJoined.includes(`${day}`) &&
        (contentJoined.includes('light') || contentJoined.includes('easy'))
      ) {
        patterns.push({
          patternType: 'day_preference',
          description: `Member prefers light meals on ${day}`,
          confidence: 'medium',
          evidenceCount: 1,
          suggestedAction: `Schedule lighter meals on ${day}`,
        });
      }
    }

    // Protein dislikes
    const proteins = ['chicken', 'beef', 'pork', 'fish', 'turkey', 'tofu', 'lentils', 'beans'];
    for (const protein of proteins) {
      if (
        contentJoined.includes(protein) &&
        (contentJoined.includes("don't like") ||
          contentJoined.includes('dislike') ||
          contentJoined.includes('avoid') ||
          contentJoined.includes('tired of'))
      ) {
        patterns.push({
          patternType: 'protein_avoidance',
          description: `Member tends to reject meals with ${protein}`,
          confidence: 'medium',
          evidenceCount: 1,
          suggestedAction: `Limit ${protein} in upcoming plans`,
        });
      }
    }

    // Spice preference
    if (contentJoined.includes('spicy') && contentJoined.includes('not')) {
      patterns.push({
        patternType: 'spice_preference',
        description: 'Member prefers mild meals without spice',
        confidence: 'medium',
        evidenceCount: 1,
        suggestedAction: 'Avoid highly spiced recipes',
      });
    }

    // Complexity preference
    if (contentJoined.includes('quick') || contentJoined.includes('easy')) {
      patterns.push({
        patternType: 'time_preference',
        description: 'Member prefers quick and easy meals',
        confidence: 'medium',
        evidenceCount: 1,
        suggestedAction: 'Prioritize recipes with short prep time',
      });
    }

    return patterns;
  }

  /**
   * Filter health claims: block ED-promoting myths and misinformation.
   * Returns claim analysis without storing raw health data.
   */
  filterHealthClaims(claimTexts: string[]): HealthClaimFilter[] {
    const filtered: HealthClaimFilter[] = [];

    for (const claim of claimTexts) {
      let matched = false;

      for (const pattern of ED_CLAIM_PATTERNS) {
        if (pattern.test(claim)) {
          // Determine category
          // Word boundaries matter: unbounded /fat|thin/ matched inside ordinary
          // words ("after", "thinnest") and mislabelled a purity claim as
          // weight_focus. Purity is also tested before weight language so a
          // "clean food" claim is not stolen by a stray body-shape word.
          let category: HealthClaimFilter['category'] = 'other';
          if (/\b(carbs?|sugar)\b[^.!?]*\b(toxic|poison|bad|evil)\b/i.test(claim)) {
            category = 'misinformation';
          } else if (/\b(detox\w*|cleanse\w*|purif\w*)\b/i.test(claim)) {
            category = 'detox_myth';
          } else if (
            /\bonly\s+(eat|eating|have|had)\b/i.test(claim) ||
            /\bonly\s+(clean|pure|organic|natural|perfect)\b/i.test(claim) ||
            /\b(clean|pure|perfect)\s+food\b/i.test(claim) ||
            /\bethorex|\borthorex/i.test(claim)
          ) {
            category = 'orthorexia';
          } else if (/\b(restrict|eliminate|cut\s*out|cutting\s+out|no\s+carbs|avoid\s+(carbs|sugar|fat))\b/i.test(claim)) {
            category = 'restriction';
          } else if (/\b(weight|fat|thin|thinner|skinny|obese|slim)\b/i.test(claim)) {
            category = 'weight_focus';
          }

          filtered.push({
            claim: claim.slice(0, 200),
            category,
            isBlocked: true,
            blockReason: `Blocked ${category}: evidence-based guidance differs from this claim`,
            correctedClaim: this.provideEvidenceBasedAlternative(category),
          });

          matched = true;
          break;
        }
      }

      // If no ED pattern matched but contains health terms, still store for review
      if (!matched && this.containsHealthTerms(claim)) {
        filtered.push({
          claim: claim.slice(0, 200),
          category: 'other',
          isBlocked: false,
          blockReason: undefined,
        });
      }
    }

    return filtered;
  }

  /**
   * Check if a claim contains health-related terms.
   */
  private containsHealthTerms(text: string): boolean {
    const healthTerms = [
      'health',
      'diet',
      'nutrition',
      'weight',
      'calories',
      'carbs',
      'protein',
      'fat',
      'sugar',
      'allergy',
      'condition',
      'diabetes',
      'blood pressure',
    ];
    return healthTerms.some((term) => text.toLowerCase().includes(term));
  }

  /**
   * Provide evidence-based counter-claim for a blocked health claim.
   */
  private provideEvidenceBasedAlternative(category: HealthClaimFilter['category']): string {
    const corrections: Record<HealthClaimFilter['category'], string> = {
      restriction:
        'All food groups have important nutrients. A balanced diet includes whole grains, proteins, healthy fats and fruits/vegetables.',
      orthorexia:
        'A healthy diet includes a wide variety of foods. Overly rigid food rules can be harmful. Aim for balance and flexibility.',
      detox_myth:
        'Your body naturally detoxifies through the liver and kidneys. Juices and cleanses are not necessary and can lack important nutrients.',
      weight_focus:
        'Health encompasses far more than weight. Focus on how you feel, your energy, and sustainable habits rather than numbers on a scale.',
      misinformation:
        'All food groups provide nutrients. A balanced diet includes carbohydrates, protein, healthy fats, fruits and vegetables, and no macronutrient is toxic.',
      other: 'When in doubt, consult evidence-based nutrition sources or a registered dietitian.',
    };
    return corrections[category];
  }

  /**
   * Generate a comprehensive analysis from member conversation history and outcomes.
   */
  async analyzeConversationHistory(
    memberId: string,
    conversationHistory: Array<{ role: string; content: string }>,
    recipeCatalog?: Map<string, { name: string; cuisine: string; prepTime?: number }>,
  ): Promise<ReviewerAnalysis> {
    const memberProfiles = new Map<string, TasteProfile>();
    const patterns: LearnedPattern[] = [];
    const filteredClaims: HealthClaimFilter[] = [];
    const recommendations: string[] = [];
    const memoryEntriesToWrite: ReviewerAnalysis['memoryEntriesToWrite'] = [];
    const scoringWeightUpdates = new Map<string, number>();

    // Summarize past plans
    const summary = this.summarizePastPlans(conversationHistory);

    // Extract recipe ratings
    const ratings = this.extractRecipeRatings(conversationHistory);

    // Detect cuisine preferences
    const cuisines = this.detectCuisinePreferences(conversationHistory);

    // Learn dislike patterns
    const dislikePatterns = this.learnDislikePatterns(conversationHistory);
    patterns.push(...dislikePatterns);

    // Filter health claims
    const claimTexts = conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    const claims = this.filterHealthClaims(claimTexts);
    filteredClaims.push(...claims);

    // Build member taste profile
    const profile: TasteProfile = {
      likedCuisines: cuisines.preferred,
      dislikedCuisines: cuisines.avoided,
      likedProteins: [],
      dislikedProteins: [],
      favoriteRecipeIds: ratings.liked.map((r) => r.recipeId),
      rejectedRecipeIds: ratings.disliked.map((r) => r.recipeId),
      prefersQuickMeals:
        summary.feedbackThemes.includes('time_constraint') ||
        dislikePatterns.some((p) => p.patternType === 'time_preference'),
    };

    memberProfiles.set(memberId, profile);

    // Generate recommendations
    if (cuisines.preferred.length > 0) {
      recommendations.push(
        `Focus on ${cuisines.preferred.join(', ')} cuisines which member has shown preference for`,
      );
    }
    if (summary.feedbackThemes.includes('time_constraint')) {
      recommendations.push('Prioritize quick and easy meals (under 30 minutes prep)');
    }
    if (dislikePatterns.length > 0) {
      recommendations.push(
        `Consider detected patterns: ${dislikePatterns.map((p) => p.description).join('; ')}`,
      );
    }
    if (claims.some((c) => c.isBlocked)) {
      recommendations.push('Some health claims were filtered for evidence-based accuracy');
    }

    // Build memory entries (NO HEALTH FACTS)
    if (cuisines.preferred.length > 0) {
      memoryEntriesToWrite.push({
        memberId,
        entryType: 'cuisine_preference',
        content: `Prefers ${cuisines.preferred.join(', ')} cuisines`,
        source: 'conversation_history_analysis',
      });
    }

    if (profile.favoriteRecipeIds.length > 0) {
      memoryEntriesToWrite.push({
        memberId,
        entryType: 'recipe_preference',
        content: `Favorite recipes: ${profile.favoriteRecipeIds.join(', ')}`,
        source: 'conversation_history_analysis',
      });
    }

    for (const pattern of dislikePatterns) {
      if (!pattern.description.toLowerCase().includes('health') && 
          !pattern.description.toLowerCase().includes('calorie')) {
        memoryEntriesToWrite.push({
          memberId,
          entryType: 'pattern',
          content: pattern.description,
          source: 'behavior_pattern_detection',
        });
      }
    }

    // Build scoring weight updates (bounded 0.5x to 2x per PRD)
    for (const recipeId of ratings.liked) {
      scoringWeightUpdates.set(recipeId.recipeId, 1.3); // Slight boost for liked recipes
    }
    for (const recipeId of ratings.disliked) {
      scoringWeightUpdates.set(recipeId.recipeId, 0.7); // Slight reduction for disliked recipes
    }

    return {
      memberProfiles,
      patterns,
      filteredClaims,
      recommendations,
      memoryEntriesToWrite,
      scoringWeightUpdates,
    };
  }
}

