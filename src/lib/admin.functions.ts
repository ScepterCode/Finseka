import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type WipeInput = { orgId: string; confirmName: string; reason: string };

export type WipeResult = {
  name: string;
  counts: Record<string, number>;
  loginsDeleted: number;
  loginsFailed: number;
  logoFilesDeleted: number;
};

type UserClient = {
  rpc: (n: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deletes an organization, every record it owns, its logo files, and the logins of everyone in
// it (system admins keep theirs), so those emails can sign up again. The database refuses unless
// the caller is a system admin, typed the exact name, gave a reason and downloaded a copy in the
// last 30 minutes; the logins are deleted only after the records are gone.
export const wipeOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: WipeInput) => {
    const orgId = String(input.orgId ?? "");
    if (!UUID.test(orgId)) throw new Error("Organization not found.");
    return {
      orgId,
      confirmName: String(input.confirmName ?? ""),
      reason: String(input.reason ?? "").trim(),
    };
  })
  .handler(async ({ data, context }): Promise<WipeResult> => {
    const { data: isPlatformAdmin, error: checkError } = await (
      context.supabase as unknown as UserClient
    ).rpc("is_platform_admin");
    if (checkError) throw new Error(checkError.message);
    if (isPlatformAdmin !== true) throw new Error("Only FinSeka system admins can do this.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wiped, error } = await supabaseAdmin.rpc("wipe_organization", {
      _org_id: data.orgId,
      _confirm_name: data.confirmName,
      _reason: data.reason,
      _admin_id: context.userId,
    });
    if (error) throw new Error(error.message);
    const result = wiped as { name: string; user_ids: string[]; counts: Record<string, number> };

    // Logo files live in a folder named after the organization.
    let logoFilesDeleted = 0;
    const logos = supabaseAdmin.storage.from("org-logos");
    const { data: files } = await logos.list(data.orgId, { limit: 1000 });
    if (files?.length) {
      const { data: removed } = await logos.remove(files.map((f) => `${data.orgId}/${f.name}`));
      logoFilesDeleted = removed?.length ?? 0;
    }

    let loginsDeleted = 0;
    const failed: string[] = [];
    for (const id of result.user_ids) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (deleteError) failed.push(id);
      else loginsDeleted++;
    }

    await supabaseAdmin.rpc("log_platform_action", {
      _action: "wipe_logins",
      _org_id: data.orgId,
      _reason: null,
      _details: {
        org_name: result.name,
        deleted: loginsDeleted,
        failed,
        logo_files: logoFilesDeleted,
      },
      _admin_id: context.userId,
    });

    return {
      name: result.name,
      counts: result.counts,
      loginsDeleted,
      loginsFailed: failed.length,
      logoFilesDeleted,
    };
  });
