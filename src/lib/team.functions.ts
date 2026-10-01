import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type InviteInput = { fullName: string; email: string; role: "admin" | "viewer" };

export type InviteResult = {
  email: string;
  /** Temporary password for a new login; null when an existing login was attached. */
  password: string | null;
  attached: boolean;
  note: string;
};

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return `Fin-${out}`;
}

type UserClient = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => Promise<{ data: { org_id: string | null } | null }> };
    };
  };
  rpc: (n: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function requireAdminOrg(supabase: UserClient, userId: string) {
  const { data: inSupportSession } = await supabase.rpc("in_support_session");
  if (inSupportSession === true)
    throw new Error("Team changes cannot be made from a support session.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();
  const orgId = profile?.org_id ?? null;
  const { data: isAdmin } = await supabase.rpc("is_org_admin");
  if (!orgId || isAdmin !== true) throw new Error("Only an admin of an organization can do this.");
  return orgId;
}

export const inviteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: InviteInput) => {
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    const fullName = String(input.fullName ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (fullName.length < 2) throw new Error("Enter the person's name.");
    const role = input.role === "admin" ? "admin" : "viewer";
    return { email, fullName, role } as InviteInput;
  })
  .handler(async ({ data, context }): Promise<InviteResult> => {
    const orgId = await requireAdminOrg(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Someone who already has a FinSeka login (e.g. removed from another team) is
    // attached as they are and keeps their own password.
    const { data: existingId, error: lookupError } = await supabaseAdmin.rpc("user_id_for_email", {
      _email: data.email,
    });
    if (lookupError) throw new Error(lookupError.message);

    if (existingId) {
      const { error } = await supabaseAdmin.rpc("attach_member", {
        _user_id: existingId,
        _org_id: orgId,
        _role: data.role,
        _full_name: data.fullName,
        _must_change_password: false,
      });
      if (error) throw new Error(error.message);
      return {
        email: data.email,
        password: null,
        attached: true,
        note: "They already had a FinSeka login, so they can sign in with their own password.",
      };
    }

    const password = tempPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Could not create that account.");
    }
    const newUserId = created.data.user.id;

    // Profile and role are saved in one transaction; if that fails, remove the new
    // login again so no stray account is left behind.
    const { error: attachError } = await supabaseAdmin.rpc("attach_member", {
      _user_id: newUserId,
      _org_id: orgId,
      _role: data.role,
      _full_name: data.fullName,
      _must_change_password: true,
    });
    if (attachError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(attachError.message);
    }

    return {
      email: data.email,
      password,
      attached: false,
      note: "Email sending is not switched on for this app yet, so share this temporary password with them yourself.",
    };
  });

// The must_change_password flag is not writable by users, so it can only be cleared
// here, after the new password has actually been set.
export const completePasswordChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { password: string }) => {
    const password = String(input.password ?? "");
    if (password.length < 6) throw new Error("Use at least 6 characters.");
    return { password };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    if (profileError) throw new Error(profileError.message);
    return { ok: true };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Checked as the signed-in user: the only admin cannot leave others without one.
    const { data: blocker, error: checkError } = await (
      context.supabase as unknown as UserClient
    ).rpc("account_deletion_blocker");
    if (checkError) throw new Error(checkError.message);
    if (typeof blocker === "string" && blocker) throw new Error(blocker);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
