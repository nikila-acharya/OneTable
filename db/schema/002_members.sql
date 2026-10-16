-- WP-1.2 (PR01, PV02) — member profile tables.
-- Merge into the WP-0.2 migration stream once the ORM (Prisma or Drizzle) is chosen;
-- keep column semantics identical.
--
-- PV02 AC: `member` has NO auth fields. Only `user` (WP-0.4) can authenticate.
-- NF-P1: height/weight/allergies/conditions do NOT live here — WP-1.3's encrypted
-- member_health table owns them. Likes/dislikes are preferences (member_pref), not
-- health data.

CREATE TABLE IF NOT EXISTS member (
  id              uuid PRIMARY KEY,
  household_id    text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  birth_ym        text NOT NULL CHECK (birth_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sex             text NOT NULL CHECK (sex IN ('female', 'male', 'prefer_not_to_say')),
  activity_level  text NOT NULL CHECK (activity_level IN ('sedentary', 'low_active', 'active', 'very_active')),
  diet_pattern    text CHECK (diet_pattern IN ('omnivore','vegetarian','vegan','pescatarian','halal','kosher','other')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_household_idx ON member (household_id);

CREATE TABLE IF NOT EXISTS member_pref (
  member_id  uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('like', 'dislike')),
  tag        text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 40),
  PRIMARY KEY (member_id, kind, tag)
);

-- PR01 meal attendance: per slot type and weekday. Weekdays are ISO (1 = Mon).
CREATE TABLE IF NOT EXISTS member_attendance (
  member_id  uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  meal_type  text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner')),
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  attending  boolean NOT NULL,
  -- MP01: the packed flag marks school/work lunches only.
  packed     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (member_id, meal_type, weekday),
  CONSTRAINT packed_is_lunch_only CHECK (NOT packed OR meal_type = 'lunch')
);
