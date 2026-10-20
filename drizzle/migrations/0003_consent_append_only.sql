DROP INDEX "consent_household_type_version_key";

--> statement-breakpoint
-- NF-P3 (PRD 9): consent records are append-only.
-- UPDATE is never allowed. DELETE is allowed only inside a transaction that
-- sets onetable.allow_consent_delete = 'on' (the PV03 erasure seam, see
-- src/lib/consent/erase.ts). Cascades from household delete also fire this
-- trigger, so household erasure must go through that seam.
CREATE OR REPLACE FUNCTION consent_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consent is append-only (NF-P3): UPDATE is not allowed';
  END IF;
  IF current_setting('onetable.allow_consent_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'consent is append-only (NF-P3): DELETE requires the erasure seam';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_append_only_guard
  BEFORE UPDATE OR DELETE ON consent
  FOR EACH ROW EXECUTE FUNCTION consent_append_only();
