-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'viewer');
CREATE TYPE public.due_frequency AS ENUM ('daily', 'weekly', 'monthly', 'yearly', 'custom');
CREATE TYPE public.ledger_kind AS ENUM ('income', 'expense');

-- ORGANIZATIONS
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name text NOT NULL DEFAULT '',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- HELPER FUNCTIONS (security definer, no RLS recursion)
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- ORG / PROFILE / ROLE POLICIES
CREATE POLICY "org_members_can_view_org" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.current_org_id());
CREATE POLICY "admins_can_update_org" ON public.organizations
  FOR UPDATE TO authenticated USING (id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "view_profiles_in_org" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR (org_id IS NOT NULL AND org_id = public.current_org_id()));
CREATE POLICY "insert_own_profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "view_roles_in_org" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR (org_id IS NOT NULL AND org_id = public.current_org_id()));

-- SETUP RPC: create organization + profile + admin role for the current user
CREATE OR REPLACE FUNCTION public.setup_organization(_org_name text, _full_name text, _phone text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT org_id INTO _org_id FROM public.profiles WHERE id = _uid;
  IF _org_id IS NOT NULL THEN
    RETURN _org_id;
  END IF;

  INSERT INTO public.organizations (name, created_by) VALUES (_org_name, _uid) RETURNING id INTO _org_id;

  INSERT INTO public.profiles (id, org_id, full_name, phone)
  VALUES (_uid, _org_id, coalesce(_full_name, ''), _phone)
  ON CONFLICT (id) DO UPDATE SET org_id = _org_id, full_name = coalesce(_full_name, public.profiles.full_name), phone = coalesce(_phone, public.profiles.phone);

  INSERT INTO public.user_roles (user_id, org_id, role) VALUES (_uid, _org_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.branches (org_id, name) VALUES (_org_id, 'Main Branch');

  RETURN _org_id;
END;
$$;

-- BRANCHES
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- MEMBERS
CREATE TABLE public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- DUES
CREATE TABLE public.dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  frequency public.due_frequency NOT NULL DEFAULT 'monthly',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dues TO authenticated;
GRANT ALL ON public.dues TO service_role;
ALTER TABLE public.dues ENABLE ROW LEVEL SECURITY;

-- DUE PAYMENTS
CREATE TABLE public.due_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_id uuid NOT NULL REFERENCES public.dues(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  period_label text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_at date NOT NULL DEFAULT current_date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (due_id, member_id, period_label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.due_payments TO authenticated;
GRANT ALL ON public.due_payments TO service_role;
ALTER TABLE public.due_payments ENABLE ROW LEVEL SECURITY;

-- CONTRIBUTIONS
CREATE TABLE public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  reason text,
  amount_per_person numeric(14,2) NOT NULL DEFAULT 0,
  target_amount numeric(14,2),
  due_date date,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contributions TO authenticated;
GRANT ALL ON public.contributions TO service_role;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

-- CONTRIBUTION MEMBERS (who is expected to pay)
CREATE TABLE public.contribution_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL REFERENCES public.contributions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  UNIQUE (contribution_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contribution_members TO authenticated;
GRANT ALL ON public.contribution_members TO service_role;
ALTER TABLE public.contribution_members ENABLE ROW LEVEL SECURITY;

-- CONTRIBUTION PAYMENTS
CREATE TABLE public.contribution_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL REFERENCES public.contributions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_at date NOT NULL DEFAULT current_date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contribution_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contribution_payments TO authenticated;
GRANT ALL ON public.contribution_payments TO service_role;
ALTER TABLE public.contribution_payments ENABLE ROW LEVEL SECURITY;

-- LEDGER
CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind public.ledger_kind NOT NULL,
  label text NOT NULL,
  description text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  entry_date date NOT NULL DEFAULT current_date,
  source_table text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_org_date_idx ON public.ledger_entries (org_id, entry_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- ORG-SCOPED POLICIES FOR DATA TABLES
CREATE POLICY "branches_select" ON public.branches FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "branches_write" ON public.branches FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "members_select" ON public.members FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "members_write" ON public.members FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "dues_select" ON public.dues FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "dues_write" ON public.dues FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "due_payments_select" ON public.due_payments FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "due_payments_write" ON public.due_payments FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "contributions_select" ON public.contributions FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "contributions_write" ON public.contributions FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "contribution_members_select" ON public.contribution_members FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "contribution_members_write" ON public.contribution_members FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "contribution_payments_select" ON public.contribution_payments FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "contribution_payments_write" ON public.contribution_payments FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "ledger_select" ON public.ledger_entries FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "ledger_write" ON public.ledger_entries FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

-- AUTO LEDGER ENTRIES FOR DUE PAYMENTS
CREATE OR REPLACE FUNCTION public.sync_due_payment_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _due_name text;
  _member_name text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'due_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name INTO _due_name FROM public.dues WHERE id = NEW.due_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id)
    VALUES (NEW.org_id, 'income', 'Dues',
            coalesce(_member_name, 'Member') || ' paid ' || coalesce(_due_name, 'dues') || ' (' || NEW.period_label || ')',
            NEW.amount, NEW.paid_at, 'due_payments', NEW.id);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = coalesce(_member_name, 'Member') || ' paid ' || coalesce(_due_name, 'dues') || ' (' || NEW.period_label || ')'
    WHERE source_table = 'due_payments' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER due_payments_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.due_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_due_payment_ledger();

-- AUTO LEDGER ENTRIES FOR CONTRIBUTION PAYMENTS
CREATE OR REPLACE FUNCTION public.sync_contribution_payment_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c_name text;
  _member_name text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'contribution_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name INTO _c_name FROM public.contributions WHERE id = NEW.contribution_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id)
    VALUES (NEW.org_id, 'income', 'Contribution',
            coalesce(_member_name, 'Member') || ' paid for ' || coalesce(_c_name, 'contribution'),
            NEW.amount, NEW.paid_at, 'contribution_payments', NEW.id);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = coalesce(_member_name, 'Member') || ' paid for ' || coalesce(_c_name, 'contribution')
    WHERE source_table = 'contribution_payments' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contribution_payments_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.contribution_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_contribution_payment_ledger();