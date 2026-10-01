import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Super admins confirm each sign-in with a 6-digit code from an authenticator app before the console
// opens. The first time, they link the app by scanning a QR code.
export function TwoStepGate() {
  const factors = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });

  if (factors.isLoading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  const verified = factors.data?.totp.find((f) => f.status === "verified");

  return (
    <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-7 shadow-lift">
      <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      {verified ? <EnterCode factorId={verified.id} /> : <SetUp />}
    </div>
  );
}

function useAfterVerified() {
  const { refreshMe } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["mfa-factors"] });
    refreshMe();
  };
}

function CodeField({ code, setCode }: { code: string; setCode: (code: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="two-step-code">6-digit code</Label>
      <Input
        id="two-step-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="text-center font-mono text-lg tracking-[0.4em]"
        placeholder="123456"
      />
    </div>
  );
}

function EnterCode({ factorId }: { factorId: string }) {
  const [code, setCode] = useState("");
  const done = useAfterVerified();
  const verify = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
    },
    onSuccess: done,
    onError: (e: Error) => {
      setCode("");
      toast.error(friendlyError(e));
    },
  });

  return (
    <>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Enter your two-step code
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Open your authenticator app and type the 6-digit code for FinSeka.
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
      >
        <CodeField code={code} setCode={setCode} />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={code.length !== 6 || verify.isPending}
        >
          {verify.isPending && <Loader2 className="size-4 animate-spin" />} Continue
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">
        Lost your phone? Ask another super admin to reset your two-step login.
      </p>
    </>
  );
}

function SetUp() {
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const done = useAfterVerified();

  const start = useMutation({
    mutationFn: async () => {
      // An earlier setup that was never finished would block a new one.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `FinSeka ${new Date().toISOString().slice(0, 16)}`,
      });
      if (error) throw error;
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    onSuccess: setFactor,
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor!.id,
        code,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Two-step login is on");
      done();
    },
    onError: (e: Error) => {
      setCode("");
      toast.error(friendlyError(e));
    },
  });

  return (
    <>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Turn on two-step login
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Super admins can open and wipe out any organization, so FinSeka asks for a code from your
        phone as well as your sign-in. You need an authenticator app such as Google Authenticator,
        Microsoft Authenticator or Authy.
      </p>
      {!factor ? (
        <Button
          size="lg"
          className="mt-6 w-full"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending && <Loader2 className="size-4 animate-spin" />} Set it up
        </Button>
      ) : (
        <form
          className="mt-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Scan this with your authenticator app</p>
            <img
              src={factor.qr}
              alt="QR code for your authenticator app"
              className="mx-auto size-48 rounded-2xl border border-border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">
              Can’t scan? Enter this key in the app instead:{" "}
              <span className="select-all break-all font-mono text-foreground">
                {factor.secret}
              </span>
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">2. Type the code it shows</p>
            <CodeField code={code} setCode={setCode} />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={code.length !== 6 || verify.isPending}
          >
            {verify.isPending && <Loader2 className="size-4 animate-spin" />} Turn on two-step login
          </Button>
        </form>
      )}
    </>
  );
}
