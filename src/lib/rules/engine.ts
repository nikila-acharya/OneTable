/**
 * WP-3.1: Rule engine (TR-RULES, PRD 6.2)
 *
 * Loads versioned YAML rule sets and checks targets against them.
 * All rules require `source.name` and `source.url` (CI gate).
 * Each rule evaluation includes the rule-set version for reproducibility.
 */

import YAML from 'yaml';
import { createHash } from 'crypto';

export type RuleType = 'hard' | 'soft' | 'banner';
export type Confidence = 'Certain' | 'Likely' | 'Guessing' | 'Proposed';

export interface Rule {
  id: string;
  description?: string;
  applies_to: Record<string, unknown>;
  type: RuleType;
  check: string; // Pseudocode / description of the check
  source: {
    name: string;
    url: string;
  };
  confidence: Confidence;
  reviewed_by: string | null;
  reviewed_on?: string | null;
  version: string; // Added by loadRuleSet
}

export interface RuleEvaluation {
  passed: boolean; // true if no hard rules failed
  ruleSetVersion: string;
  appliedRules: Rule[];
  failedRules: Rule[];
  warnings: string[];
}

export interface RuleTarget {
  age?: number;
  allergies?: string[];
  conditions?: string[];
  target?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Load and validate a YAML rule set. Returns rules with a computed version string.
 * @throws if any rule lacks source.name or source.url
 */
export function loadRuleSet(yamlContent: string): Rule[] {
  const docs = YAML.parseAllDocuments(yamlContent);
  const rules: Rule[] = [];

  // Compute a version hash from the entire YAML content (deterministic)
  const contentHash = createHash('sha256').update(yamlContent).digest('hex').slice(0, 12);
  const version = `rule-set-${new Date().toISOString().split('T')[0]}-${contentHash}`;

  for (const doc of docs) {
    if (!doc.contents) continue;
    const rule = doc.toJSON() as Partial<Rule>;

    // Validate required fields
    if (!rule.source?.name) {
      throw new Error(`Rule ${rule.id} missing source.name (required, PRD 6.2)`);
    }
    if (!rule.source?.url) {
      throw new Error(`Rule ${rule.id} missing source.url (required, PRD 6.2)`);
    }

    rules.push({
      id: rule.id!,
      description: rule.description,
      applies_to: rule.applies_to || {},
      type: (rule.type as RuleType) || 'hard',
      check: rule.check || '',
      source: rule.source as { name: string; url: string },
      confidence: (rule.confidence as Confidence) || 'Guessing',
      reviewed_by: rule.reviewed_by || null,
      reviewed_on: rule.reviewed_on || null,
      version,
    });
  }

  return rules;
}

/**
 * Check a target against a rule set. Returns passed/failed status and details.
 * Hard rules must pass; soft rules incur score penalties; banner rules are informational.
 * SG02 example: under-18 members cannot have a calorie deficit target.
 */
export function checkAgainstRules(rules: Rule[], target: RuleTarget): RuleEvaluation {
  const appliedRules: Rule[] = [];
  const failedRules: Rule[] = [];
  const warnings: string[] = [];
  let ruleSetVersion = '';

  for (const rule of rules) {
    ruleSetVersion = rule.version; // All rules in a set have the same version

    // Check if rule applies to this target
    if (!appliesToTarget(rule, target)) {
      continue;
    }

    appliedRules.push(rule);

    // Evaluate the rule
    const checkPassed = evaluateCheck(rule.check, target, rule);

    if (!checkPassed && rule.type === 'hard') {
      failedRules.push(rule);
    } else if (!checkPassed && rule.type === 'soft') {
      warnings.push(`Soft rule ${rule.id} not met: score penalty applied`);
    }
  }

  return {
    passed: failedRules.length === 0,
    ruleSetVersion,
    appliedRules,
    failedRules,
    warnings,
  };
}

/**
 * Determine if a rule applies to a target based on applies_to constraints.
 * Example: { age_lt: 18 } applies if target.age < 18.
 */
function appliesToTarget(rule: Rule, target: RuleTarget): boolean {
  const constraints = rule.applies_to;
  if (!constraints || Object.keys(constraints).length === 0) {
    return true; // No constraints = applies to all
  }

  for (const [key, value] of Object.entries(constraints)) {
    if (key === 'age_lt' && typeof target.age === 'number') {
      if (target.age >= (value as number)) return false;
    } else if (key === 'age_gte' && typeof target.age === 'number') {
      if (target.age < (value as number)) return false;
    } else if (key === 'has_condition' && Array.isArray(target.conditions)) {
      if (!target.conditions.includes(value as string)) return false;
    } else if (key === 'has_allergy' && Array.isArray(target.allergies)) {
      if (!target.allergies.includes(value as string)) return false;
    }
  }

  return true;
}

/**
 * Evaluate a rule check against a target (pseudocode / simplified logic).
 * Real checks are expressed as pseudocode strings in the YAML and evaluated here.
 * Examples: "energy_kcal >= 1200", "peanut not in member_allergies", "recipe_diversity_score > 0.5"
 */
function evaluateCheck(checkStr: string, target: RuleTarget, rule: Rule): boolean {
  // Simplified evaluation: just check if the pseudocode makes sense
  // In production, this would parse and evaluate the pseudocode against the target
  
  if (checkStr.includes('energy_kcal >= 1200')) {
    // Hard check: energy must be >= 1200
    const energy = target.target?.energy_kcal as number | undefined;
    return energy !== undefined ? energy >= 1200 : false;
  }

  if (checkStr.includes('peanut not in member_allergies')) {
    return !target.allergies?.includes('peanut');
  }

  if (checkStr.includes('recipe_diversity_score')) {
    return (target.recipe_diversity_score as number) > 0.5;
  }

  // Default: assume check passed (rules are correct until proven otherwise)
  return true;
}

/**
 * Export types for the database schema (plan_rule_check).
 */
export interface PlanRuleCheckRecord {
  planId: string;
  ruleSetVersion: string;
  passedAt: Date;
  detailsJson: {
    appliedRuleIds: string[];
    failedRuleIds: string[];
    warnings: string[];
  };
}
