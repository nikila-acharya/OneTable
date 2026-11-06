/**
 * WP-5.4 — Database Schema & Migrations for OneTable
 * Postgres schema for households, members, plans, check-ins, approval cards, action logs
 * Uses Neon (serverless Postgres) for production
 */

// Migration: 001_initial_schema.sql
export const migration001InitialSchema = `
-- Households
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id VARCHAR(255) NOT NULL,
  timezone VARCHAR(50) DEFAULT 'America/New_York',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_households_owner_id ON households(owner_id);

-- Members
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  age INTEGER NOT NULL,
  activity VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_members_household_id ON members(household_id);

-- Member health profiles (allergies, conditions)
CREATE TABLE member_health_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  allergies TEXT[] DEFAULT ARRAY[]::TEXT[],
  conditions TEXT[] DEFAULT ARRAY[]::TEXT[],
  diet_preferences TEXT[] DEFAULT ARRAY[]::TEXT[],
  target_energy_kcal INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Meal plans
CREATE TABLE meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  plan_id VARCHAR(255) NOT NULL UNIQUE,
  seed INTEGER,
  start_date DATE NOT NULL,
  plan_days INTEGER NOT NULL,
  meals_data JSONB NOT NULL,
  rationale TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'draft'
);

CREATE INDEX idx_meal_plans_household_id ON meal_plans(household_id);
CREATE INDEX idx_meal_plans_status ON meal_plans(status);

-- Meal slots (individual meals)
CREATE TABLE meal_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal_type VARCHAR(50) NOT NULL,
  recipe_id VARCHAR(255) NOT NULL,
  recipe_name VARCHAR(255) NOT NULL,
  calories_per_serving INTEGER,
  locked BOOLEAN DEFAULT FALSE,
  skipped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_meal_slots_plan_id ON meal_slots(meal_plan_id);
CREATE INDEX idx_meal_slots_date ON meal_slots(date);

-- Approval cards (from Coordinator)
CREATE TABLE approval_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  card_id VARCHAR(255) NOT NULL UNIQUE,
  proposed_by VARCHAR(100) NOT NULL,
  tool VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  diff_data JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  approved_at TIMESTAMP,
  approved_by VARCHAR(255),
  declined_at TIMESTAMP,
  declined_by VARCHAR(255),
  decline_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_approval_cards_household_id ON approval_cards(household_id);
CREATE INDEX idx_approval_cards_status ON approval_cards(status);
CREATE INDEX idx_approval_cards_expires_at ON approval_cards(expires_at);

-- Action log (every tool call)
CREATE TABLE action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  action_id VARCHAR(255) NOT NULL UNIQUE,
  run_id VARCHAR(255) NOT NULL,
  parent_run_id VARCHAR(255),
  agent_role VARCHAR(100) NOT NULL,
  tool VARCHAR(100) NOT NULL,
  permission_level VARCHAR(10) NOT NULL,
  inputs_summary TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  reversible BOOLEAN DEFAULT FALSE,
  previous_state JSONB,
  undone_at TIMESTAMP,
  undone_by_action_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_action_logs_household_id ON action_logs(household_id);
CREATE INDEX idx_action_logs_run_id ON action_logs(run_id);
CREATE INDEX idx_action_logs_reversible ON action_logs(reversible, undone_at);
CREATE INDEX idx_action_logs_created_at ON action_logs(created_at);

-- Weekly check-ins
CREATE TABLE check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  week VARCHAR(10) NOT NULL,
  activities_data JSONB NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_check_ins_household_id ON check_ins(household_id);
CREATE INDEX idx_check_ins_member_id ON check_ins(member_id);
CREATE INDEX idx_check_ins_week ON check_ins(week);

-- Activity goals (HHS guidelines)
CREATE TABLE activity_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  goal_id VARCHAR(255) NOT NULL UNIQUE,
  goal_type VARCHAR(50) NOT NULL,
  frequency VARCHAR(50) NOT NULL,
  target_value INTEGER NOT NULL,
  unit VARCHAR(50) NOT NULL,
  completed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_goals_household_id ON activity_goals(household_id);
CREATE INDEX idx_activity_goals_member_id ON activity_goals(member_id);

-- Grocery lists
CREATE TABLE grocery_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  list_id VARCHAR(255) NOT NULL UNIQUE,
  items_data JSONB NOT NULL,
  total_items INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  instacart_link VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_grocery_lists_household_id ON grocery_lists(household_id);
CREATE INDEX idx_grocery_lists_status ON grocery_lists(status);

-- Pantry inventory
CREATE TABLE pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  purchased_at TIMESTAMP,
  expires_at TIMESTAMP,
  shelf_life_days INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pantry_items_household_id ON pantry_items(household_id);
CREATE INDEX idx_pantry_items_expires_at ON pantry_items(expires_at);

-- Health tips (clinical + pool)
CREATE TABLE health_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id VARCHAR(255) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  source_url VARCHAR(500),
  source_type VARCHAR(50) NOT NULL,
  category VARCHAR(100),
  visibility VARCHAR(50) DEFAULT 'visible',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_tips_source_type ON health_tips(source_type);
CREATE INDEX idx_health_tips_visibility ON health_tips(visibility);

-- Preferences memory (learned over time)
CREATE TABLE preferences_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  key VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  source VARCHAR(100),
  confidence DECIMAL(3, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_preferences_memory_household_id ON preferences_memory(household_id);
CREATE INDEX idx_preferences_memory_member_id ON preferences_memory(member_id);

-- Budget tracking (tokens, tools, delegations)
CREATE TABLE budget_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
  tier VARCHAR(50) DEFAULT 'free',
  monthly_token_budget INTEGER DEFAULT 50000,
  tokens_used_this_month INTEGER DEFAULT 0,
  token_reset_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_budget_tracking_tier ON budget_tracking(tier);

-- Audit log (all changes)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  action VARCHAR(50),
  changes JSONB,
  actor_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_household_id ON audit_logs(household_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
`;

/**
 * TypeScript interfaces matching the schema
 */

export interface HouseholdRow {
  id: string;
  name: string;
  owner_id: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface MemberRow {
  id: string;
  household_id: string;
  name: string;
  age: number;
  activity: string;
  created_at: string;
  updated_at: string;
}

export interface MemberHealthProfileRow {
  id: string;
  member_id: string;
  allergies: string[];
  conditions: string[];
  diet_preferences: string[];
  target_energy_kcal?: number;
  created_at: string;
  updated_at: string;
}

export interface MealPlanRow {
  id: string;
  household_id: string;
  plan_id: string;
  seed: number;
  start_date: string;
  plan_days: number;
  meals_data: Record<string, unknown>;
  rationale: string;
  created_at: string;
  accepted_at?: string;
  status: string;
}

export interface ApprovalCardRow {
  id: string;
  household_id: string;
  card_id: string;
  proposed_by: string;
  tool: string;
  summary: string;
  diff_data: Record<string, unknown>;
  status: string;
  approved_at?: string;
  approved_by?: string;
  declined_at?: string;
  declined_by?: string;
  decline_reason?: string;
  created_at: string;
  expires_at: string;
}

export interface ActionLogRow {
  id: string;
  household_id: string;
  action_id: string;
  run_id: string;
  parent_run_id?: string;
  agent_role: string;
  tool: string;
  permission_level: "P" | "A";
  inputs_summary: string;
  result_summary: string;
  tokens_used: number;
  duration_ms: number;
  reversible: boolean;
  previous_state?: Record<string, unknown>;
  undone_at?: string;
  undone_by_action_id?: string;
  created_at: string;
}

export interface CheckInRow {
  id: string;
  household_id: string;
  member_id: string;
  week: string;
  activities_data: Record<string, unknown>;
  notes?: string;
  created_at: string;
}

export interface ActivityGoalRow {
  id: string;
  household_id: string;
  member_id: string;
  goal_id: string;
  goal_type: string;
  frequency: string;
  target_value: number;
  unit: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
}

export interface BudgetTrackingRow {
  id: string;
  household_id: string;
  tier: string;
  monthly_token_budget: number;
  tokens_used_this_month: number;
  token_reset_date: string;
  created_at: string;
  updated_at: string;
}
