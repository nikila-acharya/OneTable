import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import RecipesTab from '@/components/recipes/RecipesTab';

describe('RecipesTab (WP-3.8, RX01)', () => {
  const mockMembers = [
    { id: 'm1', name: 'Alice', age: 30 },
    { id: 'm2', name: 'Bob', age: 28 },
  ];

  const mockRecipes = [
    {
      id: 'r1',
      name: 'Grilled Salmon',
      meal_types: ['lunch', 'dinner'],
      energy_kcal: 450,
      protein_g: 40,
      prep_time_min: 15,
      own_source: true,
    },
    {
      id: 'r2',
      name: 'Oatmeal',
      meal_types: ['breakfast'],
      energy_kcal: 300,
      protein_g: 10,
      prep_time_min: 5,
      own_source: false,
    },
  ];

  const mockSlots = [
    {
      id: 'slot-1',
      plan_id: 'plan-1',
      date: new Date('2026-11-10'),
      meal_type: 'breakfast' as const,
      member_id: 'm1',
      recipe_id: 'r2',
      mode: 'shared' as const,
      locked: false,
    },
    {
      id: 'slot-2',
      plan_id: 'plan-1',
      date: new Date('2026-11-10'),
      meal_type: 'dinner' as const,
      member_id: 'm1',
      recipe_id: 'r1',
      mode: 'shared' as const,
      locked: true,
    },
  ];

  const mockTargets = {
    m1: {
      energy_kcal: 2000,
      energy_floor_kcal: 1800,
      energy_floor_reviewed: false,
      weight_loss_allowed: true,
      includes_growth: false,
      protein_g: 50,
      fiber_g: 25,
      sources: {},
    },
    m2: {
      energy_kcal: 1800,
      energy_floor_kcal: 1600,
      energy_floor_reviewed: false,
      weight_loss_allowed: true,
      includes_growth: false,
      protein_g: 45,
      fiber_g: 25,
      sources: {},
    },
  };

  it('renders without crashing', () => {
    const { container } = render(
      <RecipesTab
        household_id="h1"
        members={mockMembers}
        slots={mockSlots}
        recipes={mockRecipes}
        targets={mockTargets}
      />
    );

    expect(container).toBeTruthy();
  });

  it('accepts onSwap callback', () => {
    const onSwap = vi.fn();
    const { container } = render(
      <RecipesTab
        household_id="h1"
        members={mockMembers}
        slots={mockSlots}
        recipes={mockRecipes}
        targets={mockTargets}
        onSwap={onSwap}
      />
    );

    expect(container).toBeTruthy();
    expect(onSwap).not.toHaveBeenCalled();
  });

  it('accepts onRegenerateDay callback', () => {
    const onRegenerateDay = vi.fn();
    const { container } = render(
      <RecipesTab
        household_id="h1"
        members={mockMembers}
        slots={mockSlots}
        recipes={mockRecipes}
        targets={mockTargets}
        onRegenerateDay={onRegenerateDay}
      />
    );

    expect(container).toBeTruthy();
  });

  it('handles slots with locked status', () => {
    const { container } = render(
      <RecipesTab
        household_id="h1"
        members={mockMembers}
        slots={mockSlots.filter((s) => s.locked)}
        recipes={mockRecipes}
        targets={mockTargets}
      />
    );

    expect(container).toBeTruthy();
  });
});
