'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  Field,
  FieldRow,
  Input,
  LinkButton,
  MealBar,
  SegmentedControl,
  Select,
  StatusChip,
  TabBar,
  Tag,
  Textarea,
  BottomSheet,
} from '../../../components/ui';

const CUISINES = ['Indian', 'Italian', 'Mexican', 'Mediterranean', 'Thai', 'American'];

export default function Gallery() {
  const [cuisines, setCuisines] = useState<string[]>(['Indian', 'Italian']);
  const [allergies, setAllergies] = useState<string[]>(['Peanuts', 'Milk']);
  const [breakfast, setBreakfast] = useState(10);
  const [dinner, setDinner] = useState(30);
  const [tab, setTab] = useState('plan');
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <main
      className="ot-page"
      data-testid="components-page"
      style={{
        maxWidth: 430,
        margin: '0 auto',
        padding: '16px 20px 96px',
        fontFamily: 'var(--font-ui)',
        color: 'var(--ink)',
        background: 'var(--bg)',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: 'var(--text-title)', fontWeight: 300, margin: '8px 0 2px' }}>
        OneTable components
      </h1>
      <p className="ot-sec-muted" style={{ color: 'var(--ink-soft)', fontSize: 'var(--text-meta)' }}>
        WP-0.6 base set · tokens per PRD §16.3 · styled to match design/prototype.html
      </p>

      <section id="buttons">
        <h2 className="ot-sec">Buttons</h2>
        <Button>Let&apos;s get started</Button>
        <div style={{ height: 10 }} />
        <Button variant="ghost">Save for later</Button>
        <div style={{ height: 10 }} />
        <Button size="sm" wide={false}>
          Approve
        </Button>{' '}
        <Button size="sm" wide={false} variant="ghost">
          Decline
        </Button>
        <div style={{ height: 10 }} />
        <LinkButton>Skip for now: use our starter recipes</LinkButton>
      </section>

      <section id="fields">
        <h2 className="ot-sec">Fields</h2>
        <Field label="Household name" required>
          <Input defaultValue="The Rivera family" />
        </Field>
        <Field label="Time zone">
          <Select defaultValue="Eastern (New York)">
            <option>Eastern (New York)</option>
            <option>Central</option>
            <option>Mountain</option>
            <option>Pacific</option>
          </Select>
        </Field>
        <FieldRow>
          <Field label="Age" required hint="Years">
            <Input type="number" defaultValue={11} min={0} max={120} />
          </Field>
          <Field label="Likes">
            <Input defaultValue="pizza" />
          </Field>
        </FieldRow>
        <Field label="Where your food comes from" hint="Paste many links at once — we detect the platform.">
          <Textarea placeholder={'https://blog.example/recipes\nhttps://instagram.com/creator'} />
        </Field>
      </section>

      <section id="segmented">
        <h2 className="ot-sec">Segmented control</h2>
        <Field label="Weekday breakfast">
          <SegmentedControl
            ariaLabel="Weekday breakfast"
            value={breakfast}
            onChange={setBreakfast}
            options={[
              { value: 5, label: '5 min' },
              { value: 10, label: '10 min' },
              { value: 15, label: '15 min' },
              { value: 20, label: '20 min' },
            ]}
          />
        </Field>
        <Field label="Weeknight dinner">
          <SegmentedControl
            ariaLabel="Weeknight dinner"
            value={dinner}
            onChange={setDinner}
            options={[
              { value: 20, label: '20 min' },
              { value: 30, label: '30 min' },
              { value: 45, label: '45 min' },
              { value: 60, label: '60 min' },
            ]}
          />
        </Field>
      </section>

      <section id="chips">
        <h2 className="ot-sec">Chips</h2>
        <ChipGroup>
          {CUISINES.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={cuisines.includes(c)}
              onToggle={(sel) =>
                setCuisines((prev) => (sel ? [...prev, c] : prev.filter((x) => x !== c)))
              }
            />
          ))}
        </ChipGroup>
        <h3 style={{ fontSize: 'var(--text-section)', fontWeight: 500, margin: '18px 0 8px' }}>
          Allergies — always locked
        </h3>
        <ChipGroup>
          {allergies.map((a) => (
            <Chip key={a} label={a} locked />
          ))}
        </ChipGroup>
        <div style={{ marginTop: 10 }}>
          <Tag tone="allergy">Peanuts</Tag> <Tag tone="clinician">Clinician confirm needed</Tag>{' '}
          <Tag>Vegetarian</Tag>
        </div>
      </section>

      <section id="cards">
        <h2 className="ot-sec">Cards</h2>
        <Card title="Never planned" action={<LinkButton>Edit</LinkButton>}>
          <Tag tone="allergy">Peanuts</Tag> <Tag tone="allergy">Milk</Tag>
        </Card>
        <Card variant="outline" title="Spice Route Kitchen" action={<Button size="sm" wide={false}>Open</Button>}>
          <p style={{ margin: 0, fontSize: 'var(--text-meta)', color: 'var(--ink-soft)' }}>
            https://spice-route-kitchen.example
          </p>
          <div style={{ marginTop: 6 }}>
            <StatusChip tone="ok">42 recipes added</StatusChip>
          </div>
        </Card>
        <Card variant="accent" title="Your first week is ready to review">
          <p style={{ margin: 0, fontSize: 'var(--text-meta)', color: 'var(--ink-soft)' }}>
            28 meals · 61% of dinners from your sources · all safety checks passed
          </p>
        </Card>
        <Card variant="dashed" onClick={() => setSheetOpen(true)}>
          + Add family member
        </Card>
      </section>

      <section id="status-chips">
        <h2 className="ot-sec">Status chips</h2>
        <p style={{ margin: '4px 0' }}>
          <StatusChip tone="running">Importing recipes…</StatusChip>
        </p>
        <p style={{ margin: '4px 0' }}>
          <StatusChip tone="ok">42 recipes added</StatusChip>
        </p>
        <p style={{ margin: '4px 0' }}>
          <StatusChip tone="needs-action">Linked · share posts or add their website</StatusChip>
        </p>
      </section>

      <section id="meal-bars">
        <h2 className="ot-sec">Meal bars</h2>
        <MealBar
          slot="breakfast"
          title="Masala oats"
          time={10}
          who="Everyone"
          source="your notes"
          safetyPassed
          onOpen={() => {}}
        />
        <MealBar
          slot="lunch"
          title="Dal + rice"
          time={20}
          who="Per person"
          source="Spice Route Kitchen"
          safetyPassed
          onOpen={() => {}}
        />
        <MealBar slot="snack" title="Fruit + nuts mix" time={5} who="Everyone" onOpen={() => {}} />
        <MealBar
          slot="dinner"
          title="Veg pasta"
          time={30}
          who="Everyone"
          swap="Arjun swap: no mushrooms"
          source="Spice Route Kitchen"
          safetyPassed
          onOpen={() => {}}
        />
        <MealBar slot="dinner" title="" planned={false} />
      </section>

      <section id="bottom-sheet">
        <h2 className="ot-sec">Bottom sheet</h2>
        <Button onClick={() => setSheetOpen(true)}>Open member sheet</Button>
      </section>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onOk={() => setSheetOpen(false)}
        title="Arjun"
        aside={
          <details style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 6 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--primary-strong)' }}>
              More about Arjun
            </summary>
            <div className="ot-consent">
              Health details stay private — encrypted, never used for ads, and only your planner
              reads them.
              <label style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input type="checkbox" defaultChecked /> Add allergies (locked chips after saving)
              </label>
            </div>
            <div className="ot-note">
              Type 2 diabetes: the planner gives general guidance only — please confirm with your
              clinician.
            </div>
          </details>
        }
      >
        <Field label="Name" required>
          <Input defaultValue="Arjun" />
        </Field>
        <Field label="Age" required>
          <Input type="number" defaultValue={11} min={0} max={120} />
        </Field>
        <Field label="Activity">
          <SegmentedControl
            ariaLabel="Activity"
            value="very"
            onChange={() => {}}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'some', label: 'Some' },
              { value: 'active', label: 'Active' },
              { value: 'very', label: 'Very active' },
            ]}
          />
        </Field>
        <p style={{ fontSize: 'var(--text-meta)', color: 'var(--ink-soft)' }}>
          We plan for growth, never for weight loss.
        </p>
      </BottomSheet>

      <section id="tab-bar" style={{ marginTop: 24 }}>
        <h2 className="ot-sec">Tab bar</h2>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-card)',
            overflow: 'hidden',
          }}
        >
          <TabBar active={tab as 'plan'} onSelect={(t) => setTab(t)} />
        </div>
      </section>
    </main>
  );
}
