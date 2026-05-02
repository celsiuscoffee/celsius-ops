-- Restore public read policies for the `invoices` and `product-images`
-- buckets. RLS is enabled on storage.objects, and even though both buckets
-- have public=true, Supabase still requires an explicit SELECT policy or
-- every fetch returns the Cloudflare-style "content blocked" page.
--
-- The hr-documents and ads-* buckets are intentionally private and read
-- via signed URLs from the server, so they don't need a public policy.
--
-- IF NOT EXISTS guards make this idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_public_read'
  ) THEN
    CREATE POLICY "invoices_public_read" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'invoices');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_public_insert'
  ) THEN
    CREATE POLICY "invoices_public_insert" ON storage.objects
      FOR INSERT TO public WITH CHECK (bucket_id = 'invoices');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_public_update'
  ) THEN
    CREATE POLICY "invoices_public_update" ON storage.objects
      FOR UPDATE TO public USING (bucket_id = 'invoices');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_images_public_read'
  ) THEN
    CREATE POLICY "product_images_public_read" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_images_public_insert'
  ) THEN
    CREATE POLICY "product_images_public_insert" ON storage.objects
      FOR INSERT TO public WITH CHECK (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_images_public_update'
  ) THEN
    CREATE POLICY "product_images_public_update" ON storage.objects
      FOR UPDATE TO public USING (bucket_id = 'product-images');
  END IF;
END $$;
