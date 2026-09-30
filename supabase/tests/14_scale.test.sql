-- Things that keep FinSeka fast with many organizations on it.

-- Security rules must call the helpers as (SELECT ...), so each runs once per query rather
-- than once per row. A new rule written the old way fails here.
SELECT tests.eq('every security rule runs its helpers once per query',
  (SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND coalesce(qual, '') || coalesce(with_check, '')
         ~ '(?<!SELECT )(current_org_id|is_org_admin|auth\.uid)\(\)'),
  NULL::text);

-- Every table with an org_id can find one organization's rows by index.
SELECT tests.eq('every org_id column has an index starting with it',
  (SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
   JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE a.attname = 'org_id' AND NOT a.attisdropped
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)),
  NULL::text);

SELECT tests.eq('new SVG logos are refused; PNG, JPEG, WebP and GIF are allowed',
  (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'org-logos'),
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
