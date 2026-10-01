-- FIX: the Super admins list came back empty. Supabase stores login emails as varchar(255), and a
-- function that returns a table must return exactly the declared types (text here), so Postgres
-- refused the query. The emails are now converted to text. Nothing else changes.
CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS TABLE (user_id uuid, email text, full_name text, added_at timestamptz, added_by_email text,
               last_sign_in_at timestamptz, is_you boolean, two_step boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT a.user_id, u.email::text, p.full_name, a.added_at, b.email::text, u.last_sign_in_at,
         a.user_id = auth.uid(),
         EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified')
  FROM public.platform_admins a
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN auth.users b ON b.id = a.added_by
  ORDER BY a.added_at;
END;
$$;
