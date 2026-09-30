-- Organization logos: stop accepting new SVG uploads. An SVG file can carry scripts; PNG,
-- JPEG, WebP and GIF cannot. Logos already uploaded as SVG are left alone and still show.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'org-logos';
