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

export type AddAdminResult = {
  email: string;
  /** Temporary password for a brand-new login; null when an existing login was made a super admin. */
  password: string | null;
};

// Makes someone a super admin. An existing FinSeka login (including Google sign-in) keeps its way of
// signing in; for a new email a login is created with a temporary password, changed on first sign-in.
export const addSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { email: string; fullName: string }) => {
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    return { email, fullName: String(input.fullName ?? "").trim() };
  })
  .handler(async ({ data, context }): Promise<AddAdminResult> => {
    const { data: isPlatformAdmin, error: checkError } = await (
      context.supabase as unknown as UserClient
    ).rpc("is_platform_admin");
    if (checkError) throw new Error(checkError.message);
    if (isPlatformAdmin !== true) throw new Error("Only FinSeka system admins can do this.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingId, error: lookupError } = await supabaseAdmin.rpc("user_id_for_email", {
      _email: data.email,
    });
    if (lookupError) throw new Error(lookupError.message);

    let userId = existingId as string | null;
    let password: string | null = null;
    if (!userId) {
      if (data.fullName.length < 2) throw new Error("Enter the person's name.");
      const { tempPassword } = await import("@/lib/team.functions");
      password = tempPassword();
      const created = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Could not create that account.");
      }
      userId = created.data.user.id;
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({ id: userId, full_name: data.fullName, must_change_password: true });
      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error(profileError.message);
      }
    }

    const { error } = await supabaseAdmin.rpc("grant_platform_admin", {
      _user_id: userId,
      _by: context.userId,
    });
    if (error) {
      if (password) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(error.message);
    }
    return { email: data.email, password };
  });

// Removes another super admin's authenticator app (e.g. a lost phone), so they set it up again at
// their next sign-in. Supabase signs them out everywhere when a confirmed authenticator is removed.
export const resetSuperAdminTwoStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string }) => {
    const userId = String(input.userId ?? "");
    if (!UUID.test(userId)) throw new Error("That person is not a super admin.");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: checkError } = await (
      context.supabase as unknown as UserClient
    ).rpc("is_platform_admin");
    if (checkError) throw new Error(checkError.message);
    if (isPlatformAdmin !== true) throw new Error("Only FinSeka system admins can do this.");
    if (data.userId === context.userId) {
      throw new Error("Ask another super admin to reset your two-step login.");
    }

    // Read as the signed-in super admin, so the database checks their two-step sign-in too.
    const { data: admins, error: adminsError } = await (
      context.supabase as unknown as {
        rpc: (n: "admin_list_admins") => Promise<{
          data: { user_id: string; email: string | null }[] | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc("admin_list_admins");
    if (adminsError) throw new Error(adminsError.message);
    const target = admins?.find((a) => a.user_id === data.userId);
    if (!target) throw new Error("That person is not a super admin.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: list, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: data.userId,
    });
    if (listError) throw new Error(listError.message);
    let removed = 0;
    for (const f of list?.factors ?? []) {
      const { error } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
        id: f.id,
        userId: data.userId,
      });
      if (error) throw new Error(error.message);
      removed++;
    }

    await supabaseAdmin.rpc("log_platform_action", {
      _action: "two_step_reset",
      _org_id: null,
      _reason: null,
      _details: { email: target.email, authenticators_removed: removed },
      _admin_id: context.userId,
    });
    return { removed };
  });
