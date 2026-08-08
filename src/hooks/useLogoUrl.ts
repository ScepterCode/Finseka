import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Logos live in a private bucket, so turn the stored path into a temporary
 * viewable link. Full https links (older records) are used as they are.
 */
export function useLogoUrl(pathOrUrl: string | null | undefined) {
  const [value, setValue] = useState<string | null>(null);

  const isRemote = !!pathOrUrl && /^https?:\/\//i.test(pathOrUrl);

  const signed = useQuery({
    queryKey: ["logo-url", pathOrUrl],
    enabled: !!pathOrUrl && !isRemote,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("org-logos")
        .createSignedUrl(pathOrUrl!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  useEffect(() => {
    if (!pathOrUrl) setValue(null);
    else if (isRemote) setValue(pathOrUrl);
    else setValue(signed.data ?? null);
  }, [pathOrUrl, isRemote, signed.data]);

  return value;
}
