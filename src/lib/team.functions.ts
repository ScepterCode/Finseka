import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type InviteInput = { fullName: string; email: string; role: "admin" | "viewer" };

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return `Fin-${out}`;
}

async function requireAdminOrg(supabase: {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { org_id: string | null } | null }> } };
  };
  rpc: (n: string) => Promise<{ data: unknown }>;
}, userId: string) {
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
  .inputValidator((input: InviteInput) => {
    const email = String(input.email ?? "").trim().toLowerCase();
    const fullName = String(input.fullName ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (fullName.length < 2) throw new Error("Enter the person's name.");
    const role = input.role === "admin" ? "admin" : "viewer";
    return { email, fullName, role } as InviteInput;
  })
  .handler(async ({ data, context }) => {
    const orgId = await requireAdminOrg(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: newUserId,
        org_id: orgId,
        full_name: data.fullName,
        must_change_password: true,
      },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(profileError.message);

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: newUserId, org_id: orgId, role: data.role }, { onConflict: "user_id,role" });
    if (roleError) throw new Error(roleError.message);

    let emailed = false;
    let emailNote = "Email sending is not set up yet — share the temporary password yourself.";
    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      await (sendTemplateEmail as unknown as (
        t: string,
        to: string,
        o: { templateData: Record<string, string> },
      ) => Promise<unknown>)("team-invite", data.email, {
        templateData: { name: data.fullName, password, email: data.email },
      });
      emailed = true;
      emailNote = "We sent them an email with the temporary password.";
    } catch {
      emailed = false;
    }

    return { email: data.email, password, emailed, emailNote };
  });

export const revokeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => ({ userId: String(input.userId) }))
  .handler(async ({ data, context }) => {
    const orgId = await requireAdminOrg(context.supabase as never, context.userId);
    if (data.userId === context.userId) throw new Error("You cannot remove your own access here.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("org_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target || target.org_id !== orgId) throw new Error("That person is not in your organization.");

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
