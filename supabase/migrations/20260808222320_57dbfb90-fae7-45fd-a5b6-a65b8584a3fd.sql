CREATE POLICY "org_logos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "org_logos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.current_org_id()::text AND public.is_org_admin());

CREATE POLICY "org_logos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.current_org_id()::text AND public.is_org_admin());

CREATE POLICY "org_logos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.current_org_id()::text AND public.is_org_admin());