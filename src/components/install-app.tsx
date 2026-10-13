import { useState, type ReactNode } from "react";
import { EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";

import { promptInstall, useInstallState } from "@/lib/install";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * An "Install the app" control, drawn by `render` so each place can style it. One tap shows the
 * browser's install prompt where there is one; otherwise (iPhone, or a browser that has not
 * offered it) it explains how to add FinSeka to the home screen. Hidden once installed.
 */
export function InstallApp({ render }: { render: (onClick: () => void) => ReactNode }) {
  const { installed, canPrompt, ios } = useInstallState();
  const [helpOpen, setHelpOpen] = useState(false);

  if (installed) return null;

  const onClick = async () => {
    if (canPrompt) {
      try {
        if (await promptInstall()) toast.success("FinSeka is on your home screen");
      } catch {
        setHelpOpen(true);
      }
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      {render(() => void onClick())}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add FinSeka to your home screen</DialogTitle>
            <DialogDescription>
              It then opens like a normal app, full screen, with its own icon. Nothing to download
              from an app store.
            </DialogDescription>
          </DialogHeader>
          {ios ? (
            <ol className="space-y-3 text-sm">
              <Step n={1}>
                Open this page in <strong>Safari</strong>.
              </Step>
              <Step n={2}>
                Tap the <strong>Share</strong> button{" "}
                <Share className="inline size-4 align-text-bottom" aria-label="Share" /> at the
                bottom (or top) of the screen.
              </Step>
              <Step n={3}>
                Scroll down and tap <strong>Add to Home Screen</strong>{" "}
                <SquarePlus className="inline size-4 align-text-bottom" aria-hidden />.
              </Step>
              <Step n={4}>
                Tap <strong>Add</strong>. FinSeka appears on your home screen.
              </Step>
            </ol>
          ) : (
            <ol className="space-y-3 text-sm">
              <Step n={1}>
                Open your browser’s menu{" "}
                <EllipsisVertical className="inline size-4 align-text-bottom" aria-label="menu" />{" "}
                (top right in Chrome).
              </Step>
              <Step n={2}>
                Tap <strong>Install app</strong> or <strong>Add to home screen</strong>. On a
                computer, you can also click the install icon at the right of the address bar.
              </Step>
              <Step n={3}>Confirm. FinSeka appears with your other apps.</Step>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
