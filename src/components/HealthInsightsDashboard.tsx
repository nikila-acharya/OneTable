/**
 * WP-5.3 — Health Insights Dashboard: Weekly summaries, trends, metrics
 * Shows meal stats, activity completion, check-in history, energy targets
 * Displays member health profiles with progress toward goals
 */

import React, { useMemo } from "react";
import type { MemberProfile } from "@/agent/setup";
import type { CheckIn } from "@/agent/activity";
import type { MealPlan } from "@/lib/planner";

export interface HealthInsightProps {
  householdId: string;
  members: MemberProfile[];
  mealPlans: MealPlan[];
  checkIns: CheckIn[];
  targetEnergyPerMember: Record<string, number>;
}

/**
 * Member Health Card Component
 */
function MemberHealthCard({
  member,
  checkIns,
  targetEnergy,
}: {
  member: MemberProfile;
  checkIns: CheckIn[];
  targetEnergy: number;
}): JSX.Element {
  // Calculate completion rate for this member
  const memberCheckIns = checkIns.filter((c) => c.memberId === member.memberId);
  const completionRate =
    memberCheckIns.length > 0
      ? Math.round(
          (memberCheckIns.filter((c) => c.activities.length > 0).length /
            memberCheckIns.length) *
            100
        )
      : 0;

  // Get latest check-in
  const latestCheckIn = memberCheckIns.sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  )[0];

  return (
    <div className="health-card member-health-card">
      <h3>{member.name}</h3>

      <div className="health-metrics">
        {/* Age & Activity */}
        <div className="metric">
          <span className="metric-label">Age:</span>
          <span className="metric-value">{member.age}</span>
        </div>

        <div className="metric">
          <span className="metric-label">Activity:</span>
          <span className="metric-value">{member.activity}</span>
        </div>

        {/* Energy target */}
        <div className="metric">
          <span className="metric-label">Target Energy:</span>
          <span className="metric-value">{targetEnergy.toLocaleString()} kcal</span>
        </div>

        {/* Check-in completion */}
        <div className="metric">
          <span className="metric-label">Activity Completion:</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${completionRate}%` }}></div>
          </div>
          <span className="metric-value">{completionRate}%</span>
        </div>

        {/* Allergies */}
        {member.allergies.length > 0 && (
          <div className="metric allergies">
            <span className="metric-label">Allergies:</span>
            <div className="allergy-list">
              {member.allergies.map((allergen) => (
                <span key={allergen} className="allergy-badge">
                  ⚠️ {allergen}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Latest check-in */}
        {latestCheckIn && (
          <div className="metric">
            <span className="metric-label">Latest Check-In:</span>
            <span className="metric-value">
              {new Date(latestCheckIn.completedAt).toLocaleDateString()}
              {latestCheckIn.notes && <p>{latestCheckIn.notes}</p>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Weekly Meal Stats Component
 */
function WeeklyMealStats({ mealPlans }: { mealPlans: MealPlan[] }): JSX.Element {
  const stats = useMemo(() => {
    if (mealPlans.length === 0) {
      return {
        totalMeals: 0,
        avgCalories: 0,
        mealTypes: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
        ownSourceCount: 0,
      };
    }

    const allMeals = mealPlans.flatMap((p) => p.meals);
    const totalCalories = allMeals.reduce((sum, m) => sum + m.recipe.caloriesPerServing, 0);
    const mealTypeCount = {
      breakfast: allMeals.filter((m) => m.mealType === "breakfast").length,
      lunch: allMeals.filter((m) => m.mealType === "lunch").length,
      dinner: allMeals.filter((m) => m.mealType === "dinner").length,
      snack: allMeals.filter((m) => m.mealType === "snack").length,
    };
    const ownSourceCount = allMeals.filter((m) => m.recipe.isOwnSource).length;

    return {
      totalMeals: allMeals.length,
      avgCalories: Math.round(totalCalories / allMeals.length),
      mealTypes: mealTypeCount,
      ownSourceCount,
    };
  }, [mealPlans]);

  return (
    <div className="health-card weekly-meal-stats">
      <h3>🍽️ Weekly Meal Summary</h3>

      <div className="health-metrics">
        <div className="metric">
          <span className="metric-label">Total Meals:</span>
          <span className="metric-value">{stats.totalMeals}</span>
        </div>

        <div className="metric">
          <span className="metric-label">Avg Calories/Meal:</span>
          <span className="metric-value">{stats.avgCalories}</span>
        </div>

        <div className="metric">
          <span className="metric-label">Own-Source Recipes:</span>
          <span className="metric-value">{stats.ownSourceCount}</span>
        </div>

        <div className="metric">
          <span className="metric-label">Meal Distribution:</span>
          <div className="meal-type-breakdown">
            <div className="meal-type">
              <span>Breakfast:</span>
              <span className="badge">{stats.mealTypes.breakfast}</span>
            </div>
            <div className="meal-type">
              <span>Lunch:</span>
              <span className="badge">{stats.mealTypes.lunch}</span>
            </div>
            <div className="meal-type">
              <span>Dinner:</span>
              <span className="badge">{stats.mealTypes.dinner}</span>
            </div>
            <div className="meal-type">
              <span>Snacks:</span>
              <span className="badge">{stats.mealTypes.snack}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Health Insights Dashboard
 */
export function HealthInsightsDashboard({
  householdId,
  members,
  mealPlans,
  checkIns,
  targetEnergyPerMember,
}: HealthInsightProps): JSX.Element {
  return (
    <div className="health-insights-dashboard">
      <h2>📊 Health & Activity Insights</h2>

      {/* Member health cards */}
      <div className="members-section">
        <h3>Household Members</h3>
        <div className="members-grid">
          {members.map((member) => (
            <MemberHealthCard
              key={member.memberId}
              member={member}
              checkIns={checkIns}
              targetEnergy={targetEnergyPerMember[member.memberId] || 2000}
            />
          ))}
        </div>
      </div>

      {/* Weekly meal stats */}
      <div className="meals-section">
        <WeeklyMealStats mealPlans={mealPlans} />
      </div>

      {/* Recent check-ins timeline */}
      <div className="checkins-section">
        <h3>📝 Recent Check-Ins</h3>
        <div className="checkins-timeline">
          {checkIns.length === 0 ? (
            <p className="empty-state">No check-ins yet. Start tracking your activities!</p>
          ) : (
            checkIns
              .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
              .slice(0, 5)
              .map((checkIn) => (
                <div key={checkIn.checkInId} className="checkin-item">
                  <span className="checkin-date">
                    {new Date(checkIn.completedAt).toLocaleDateString()}
                  </span>
                  <span className="checkin-week">{checkIn.week}</span>
                  <span className="checkin-activities">
                    {checkIn.activities.length} activities
                  </span>
                  {checkIn.notes && <p className="checkin-notes">{checkIn.notes}</p>}
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CSS styles for health insights
 */
export const healthInsightsStyles = `
.health-insights-dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  background: #f5f5f5;
}

.health-insights-dashboard h2 {
  margin: 0;
  font-size: 24px;
  color: #333;
}

.health-insights-dashboard h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #555;
}

/* Member Health Cards */
.members-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.health-card {
  background: white;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.member-health-card {
  border-left: 4px solid #2196f3;
}

.member-health-card h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #1976d2;
}

.health-metrics {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.metric {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.metric-label {
  font-weight: 600;
  color: #666;
}

.metric-value {
  color: #333;
  font-weight: 500;
}

/* Progress bar */
.progress-bar {
  width: 100px;
  height: 6px;
  background: #e0e0e0;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  transition: width 0.3s ease;
}

/* Allergies */
.allergies {
  flex-direction: column;
  align-items: flex-start;
}

.allergy-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.allergy-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #ffebee;
  color: #c62828;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

/* Weekly Meal Stats */
.weekly-meal-stats {
  border-left: 4px solid #ff9800;
}

.weekly-meal-stats h3 {
  color: #f57c00;
}

.meal-type-breakdown {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.meal-type {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  background: #ffe0b2;
  color: #e65100;
  border-radius: 4px;
  font-weight: 600;
}

/* Check-ins Timeline */
.checkins-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkins-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #999;
  background: white;
  border-radius: 6px;
  border: 1px dashed #ddd;
}

.checkin-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: white;
  border-left: 4px solid #4caf50;
  border-radius: 4px;
  font-size: 13px;
}

.checkin-date {
  font-weight: 600;
  color: #333;
  min-width: 100px;
}

.checkin-week {
  background: #e8f5e9;
  padding: 2px 8px;
  border-radius: 4px;
  color: #2e7d32;
  font-weight: 500;
  font-size: 11px;
}

.checkin-activities {
  color: #666;
  margin-left: auto;
}

.checkin-notes {
  margin: 4px 0 0 0;
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  color: #555;
  font-size: 12px;
  font-style: italic;
}
`;
