-- IMPORTING MEMBERS
--
-- A new organization brings in its members list from an Excel or CSV file in one go. The app
-- reads the file and checks each row; import_members() then saves the whole list together, so a
-- dropped connection never leaves half of it. Each import is remembered, so one made by mistake
-- (the wrong sheet, the wrong columns) can be undone while nothing has been recorded against its
-- members yet.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.member_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid,
  file_name text CHECK (file_name IS NULL OR length(file_name) <= 200),
  member_count int NOT NULL DEFAULT 0,
  branch_count int NOT NULL DEFAULT 0,
  debt_total numeric(14,2) NOT NULL DEFAULT 0,
  undone_at timestamptz,
  undone_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_imports_org_idx ON public.member_imports (org_id, created_at DESC);

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.member_imports(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;  -- the import is recorded after its members, with its totals
CREATE INDEX IF NOT EXISTS members_import_idx ON public.members (import_id) WHERE import_id IS NOT NULL;

-- Everyone in the organization can see its imports; they are only made and undone through the
-- functions below.
ALTER TABLE public.member_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_imports FROM anon, public;
GRANT SELECT ON public.member_imports TO authenticated;
GRANT ALL ON public.member_imports TO service_role;
CREATE POLICY member_imports_select ON public.member_imports
  FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));

CREATE TRIGGER audit_member_imports AFTER INSERT OR UPDATE OR DELETE ON public.member_imports
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- Saves a checked list of members. Each row is an object with "name" (required) and optionally
-- "phone", "branch" (a branch name: an existing one is matched ignoring case, a new one is
-- created), "joined_on", "tags" (an array), "email", "gender", "date_of_birth", "address",
-- "occupation", "next_of_kin_name", "next_of_kin_phone", and "owed" (₦ owed before FinSeka,
-- brought forward as "owed_label", default "Owed before FinSeka"). All or nothing.
CREATE OR REPLACE FUNCTION public.import_members(_rows jsonb, _file_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _import_id uuid := gen_random_uuid();
  _today date := public.org_today();
  _r jsonb;
  _n int := 0;
  _member_id uuid;
  _branch_name text;
  _branch_id uuid;
  _branches int := 0;
  _owed numeric;
  _owed_total numeric := 0;
  _debts int := 0;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'There are no members to import.';
  END IF;
  IF jsonb_array_length(_rows) > 2000 THEN
    RAISE EXCEPTION 'Import up to 2,000 members at a time.';
  END IF;

  FOR _r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    _n := _n + 1;
    IF length(trim(coalesce(_r ->> 'name', ''))) = 0 THEN
      RAISE EXCEPTION 'Row % has no name.', _n;
    END IF;

    _branch_id := NULL;
    _branch_name := nullif(regexp_replace(trim(coalesce(_r ->> 'branch', '')), '\s+', ' ', 'g'), '');
    IF _branch_name IS NOT NULL THEN
      SELECT id INTO _branch_id FROM branches
      WHERE org_id = _org_id AND lower(name) = lower(_branch_name)
      ORDER BY created_at LIMIT 1;
      IF _branch_id IS NULL THEN
        INSERT INTO branches (org_id, name) VALUES (_org_id, _branch_name) RETURNING id INTO _branch_id;
        _branches := _branches + 1;
      END IF;
    END IF;

    BEGIN
      INSERT INTO members (org_id, import_id, name, phone, branch_id, joined_on, tags, email, gender,
                           date_of_birth, address, occupation, next_of_kin_name, next_of_kin_phone)
      VALUES (
        _org_id, _import_id,
        trim(_r ->> 'name'),
        nullif(trim(coalesce(_r ->> 'phone', '')), ''),
        _branch_id,
        coalesce(nullif(_r ->> 'joined_on', '')::date, _today),
        coalesce((SELECT array_agg(DISTINCT trim(t)) FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(_r -> 'tags') = 'array' THEN _r -> 'tags' ELSE '[]'::jsonb END) t
                  WHERE trim(t) <> ''), '{}'),
        nullif(trim(coalesce(_r ->> 'email', '')), ''),
        nullif(lower(trim(coalesce(_r ->> 'gender', ''))), ''),
        nullif(_r ->> 'date_of_birth', '')::date,
        nullif(trim(coalesce(_r ->> 'address', '')), ''),
        nullif(trim(coalesce(_r ->> 'occupation', '')), ''),
        nullif(trim(coalesce(_r ->> 'next_of_kin_name', '')), ''),
        nullif(trim(coalesce(_r ->> 'next_of_kin_phone', '')), ''))
      RETURNING id INTO _member_id;
    EXCEPTION
      WHEN check_violation OR invalid_datetime_format OR datetime_field_overflow OR string_data_right_truncation THEN
        RAISE EXCEPTION 'Row % (%): %', _n, trim(_r ->> 'name'), SQLERRM;
    END;

    _owed := nullif(_r ->> 'owed', '')::numeric;
    IF _owed IS NOT NULL AND _owed > 0 THEN
      INSERT INTO brought_forward_debts (org_id, member_id, label, amount, as_of)
      VALUES (_org_id, _member_id,
              coalesce(nullif(trim(coalesce(_r ->> 'owed_label', '')), ''), 'Owed before FinSeka'),
              round(_owed, 2), _today);
      _owed_total := _owed_total + round(_owed, 2);
      _debts := _debts + 1;
    END IF;
  END LOOP;

  -- One History line per import, with its totals.
  INSERT INTO member_imports (id, org_id, created_by, file_name, member_count, branch_count, debt_total)
  VALUES (_import_id, _org_id, auth.uid(), nullif(left(trim(coalesce(_file_name, '')), 200), ''),
          _n, _branches, _owed_total);

  RETURN jsonb_build_object('import_id', _import_id, 'members', _n, 'branches', _branches,
                            'debts', _debts, 'owed', _owed_total);
END;
$$;

-- Removes the members an import added, if nothing has been recorded against any of them yet.
-- Branches it created are kept (they may be in use by now).
CREATE OR REPLACE FUNCTION public.undo_member_import(_import_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _undone timestamptz;
  _removed int;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  SELECT undone_at INTO _undone FROM member_imports WHERE id = _import_id AND org_id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import not found.';
  END IF;
  IF _undone IS NOT NULL THEN
    RAISE EXCEPTION 'This import was already undone.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM members m
    WHERE m.import_id = _import_id
      AND (EXISTS (SELECT 1 FROM due_payments p WHERE p.member_id = m.id)
           OR EXISTS (SELECT 1 FROM contribution_payments p WHERE p.member_id = m.id)
           OR EXISTS (SELECT 1 FROM brought_forward_payments p WHERE p.member_id = m.id)
           OR EXISTS (SELECT 1 FROM pledges p WHERE p.member_id = m.id)
           OR EXISTS (SELECT 1 FROM ledger_entries l WHERE l.member_id = m.id))
  ) THEN
    RAISE EXCEPTION 'Payments or pledges have already been recorded for some of these members, so the import can no longer be undone. Remove members one by one instead.';
  END IF;

  DELETE FROM members WHERE import_id = _import_id AND org_id = _org_id;
  GET DIAGNOSTICS _removed = ROW_COUNT;
  UPDATE member_imports SET undone_at = now(), undone_by = auth.uid() WHERE id = _import_id;
  RETURN _removed;
END;
$$;

REVOKE ALL ON FUNCTION public.import_members(jsonb, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.undo_member_import(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.import_members(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_member_import(uuid) TO authenticated;

RESET lock_timeout;
