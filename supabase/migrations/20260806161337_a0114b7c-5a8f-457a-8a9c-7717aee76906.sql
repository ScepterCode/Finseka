REVOKE ALL ON FUNCTION public.current_org_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE ALL ON FUNCTION public.is_org_admin() FROM anon, public;
REVOKE ALL ON FUNCTION public.setup_organization(text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.sync_due_payment_ledger() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.sync_contribution_payment_ledger() FROM anon, public, authenticated;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_organization(text, text, text) TO authenticated;