import React, { useState, useMemo } from 'react';
import type { Recipe, MealSlot } from '@/lib/planner/planner';
import type { DRITarget } from '@/lib/conditions/targets';

export interface RecipesTabProps {
  household_id: string;
  members: Array<{ id: string; name: string; age: number }>;
  slots: MealSlot[];
  recipes: Recipe[];
  targets: Record<string, DRITarget>; // { member_id -> DRITarget }
  onRecipeSelect?: (slot: MealSlot, recipe: Recipe) => void;
  onSwap?: (slot: MealSlot) => void;
  onRegenerateDay?: (date: Date) => void;
}

/**
 * WP-3.8: Recipes tab (RX01)
 *
 * Shows the weekly plan with recipes, grouped by day and meal type.
 * Users can:
 * - View recipe details (energy, protein, allergens, source)
 * - Swap a recipe (see 3 alternatives)
 * - Regenerate a day
 * - See daily nutrient roll-up
 */
export const RecipesTab: React.FC<RecipesTabProps> = ({
  household_id,
  members,
  slots,
  recipes,
  targets,
  onRecipeSelect,
  onSwap,
  onRegenerateDay,
}) => {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Group slots by date
  const slotsByDay = useMemo(() => {
    const grouped: Record<string, MealSlot[]> = {};
    slots.forEach((slot) => {
      const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : slot.date;
      if (!grouped[dateStr]) grouped[dateStr] = [];
      grouped[dateStr].push(slot);
    });
    return grouped;
  }, [slots]);

  // Group by meal type within each day
  const slotsByDayAndMeal = useMemo(() => {
    const result: Record<string, Record<string, MealSlot[]>> = {};
    Object.entries(slotsByDay).forEach(([day, daySlots]) => {
      result[day] = {};
      daySlots.forEach((slot) => {
        if (!result[day][slot.meal_type]) result[day][slot.meal_type] = [];
        result[day][slot.meal_type].push(slot);
      });
    });
    return result;
  }, [slotsByDay]);

  const getMemberName = (memberId: string) => members.find((m) => m.id === memberId)?.name || memberId;
  const getRecipeName = (recipeId: string) => recipes.find((r) => r.id === recipeId)?.name || '(empty)';

  const renderRecipeDetail = (slot: MealSlot) => {
    const recipe = recipes.find((r) => r.id === slot.recipe_id);
    if (!recipe) return <div className="text-gray-500">No recipe assigned</div>;

    const member = members.find((m) => m.id === slot.member_id);
    const target = member ? targets[member.id] : null;

    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg">{recipe.name}</h3>
            <p className="text-sm text-gray-600">{recipe.meal_types?.join(', ')}</p>
          </div>
          {slot.locked && <span className="bg-yellow-100 px-2 py-1 text-sm font-medium">🔒 Locked</span>}
        </div>

        {/* Nutrition */}
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-600">Energy</p>
            <p className="font-semibold">
              {recipe.energy_kcal} kcal
              {target && <span className="text-xs text-gray-500"> / {target.energy_kcal} kcal</span>}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Protein</p>
            <p className="font-semibold">
              {recipe.protein_g}g
              {target && <span className="text-xs text-gray-500"> / {target.protein_g}g</span>}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Prep time</p>
            <p className="font-semibold">{recipe.prep_time_min || '–'} min</p>
          </div>
        </div>

        {/* Allergen warning */}
        {(recipe as any).allergens?.length ? (
          <div className="mt-3 bg-red-50 border border-red-200 p-2 rounded text-sm">
            <strong>⚠️ Allergens:</strong> {(recipe as any).allergens.join(', ')}
          </div>
        ) : null}

        {/* Source badge */}
        {recipe.own_source && <div className="mt-2 inline-block bg-green-100 px-2 py-1 text-xs font-medium">🏠 Our Recipe</div>}

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          {!slot.locked && onSwap && (
            <button
              onClick={() => onSwap(slot)}
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            >
              Swap
            </button>
          )}
          {onRegenerateDay && (
            <button
              onClick={() => {
                const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : slot.date;
                onRegenerateDay(typeof slot.date === 'string' ? new Date(slot.date) : slot.date);
              }}
              className="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600"
            >
              Regenerate Day
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Weekly Meal Plan</h2>

      <div className="space-y-6">
        {Object.entries(slotsByDayAndMeal).map(([dayStr, meals]) => (
          <div key={dayStr} className="border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedDay(expandedDay === dayStr ? null : dayStr)}
              className="w-full bg-gray-100 px-4 py-3 font-semibold text-left hover:bg-gray-200 flex justify-between items-center"
            >
              <span>{dayStr}</span>
              <span>{expandedDay === dayStr ? '▼' : '▶'}</span>
            </button>

            {expandedDay === dayStr && (
              <div className="p-4 space-y-4">
                {['breakfast', 'lunch', 'snack', 'dinner'].map((mealType) => (
                  <div key={mealType} className="border-l-4 border-blue-300 pl-4">
                    <h4 className="font-semibold capitalize text-lg mb-2">{mealType}</h4>

                    {meals[mealType]?.length ? (
                      <div className="space-y-3">
                        {meals[mealType].map((slot) => (
                          <div
                            key={slot.id}
                            onClick={() => setSelectedSlotId(selectedSlotId === slot.id ? null : slot.id)}
                            className={`p-3 rounded border cursor-pointer transition ${
                              selectedSlotId === slot.id
                                ? 'bg-blue-50 border-blue-400'
                                : 'bg-white border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{getRecipeName(slot.recipe_id)}</p>
                                <p className="text-sm text-gray-600">{getMemberName(slot.member_id)}</p>
                              </div>
                              {slot.locked && <span className="text-lg">🔒</span>}
                            </div>

                            {selectedSlotId === slot.id && <div className="mt-3">{renderRecipeDetail(slot)}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No {mealType} assigned</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecipesTab;
