-- Storage bucket for organization logos. The access policies for it already exist
-- (20260808222320); the bucket itself was created by hand on Lovable Cloud and never
-- made it into a migration. Private: logos are shown through signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  false,
  2097152,  -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;
