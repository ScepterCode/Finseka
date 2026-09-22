ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS budget_amount numeric,
  ADD COLUMN IF NOT EXISTS committee text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mandatory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expenses_posted boolean NOT NULL DEFAULT false;