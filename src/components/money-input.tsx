import * as React from "react";

import { Input } from "@/components/ui/input";
import { cleanAmount, groupAmount } from "@/lib/format";

type Props = Omit<React.ComponentProps<"input">, "type" | "value" | "onChange" | "min"> & {
  /** Plain number string, e.g. "1250.5" — what the parent keeps in state and passes to Number(). */
  value: string;
  onChange: (value: string) => void;
  /** Smallest amount allowed; checked on submit like a number input's min. */
  min?: number | string;
};

/**
 * A money box that shows thousands commas as you type (1,000,000) while handing the parent a
 * plain number string. Opens the number keypad on phones.
 */
export function MoneyInput({ value, onChange, min, ...props }: Props) {
  const ref = React.useRef<HTMLInputElement>(null);
  // How many digits/points sit before the caret, so it can be put back after commas move.
  const caretDigits = React.useRef<number | null>(null);
  const shown = groupAmount(value);

  React.useLayoutEffect(() => {
    const el = ref.current;
    const want = caretDigits.current;
    if (!el || want === null || document.activeElement !== el) return;
    caretDigits.current = null;
    let pos = 0;
    for (let seen = 0; pos < shown.length && seen < want; pos++) {
      if (shown[pos] !== ",") seen++;
    }
    el.setSelectionRange(pos, pos);
  }, [shown]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tooSmall = min !== undefined && value !== "" && Number(value) < Number(min);
    el.setCustomValidity(tooSmall ? `Enter at least ${groupAmount(String(min))}` : "");
  }, [value, min]);

  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        let typed = e.target.value;
        let caret = e.target.selectionStart ?? typed.length;
        // Backspace/Delete on a comma alone changes nothing, so take the digit beside it instead.
        if (typed.length < shown.length && cleanAmount(typed) === value) {
          const kind = (e.nativeEvent as InputEvent).inputType;
          if (kind === "deleteContentBackward" && caret > 0) {
            typed = typed.slice(0, caret - 1) + typed.slice(caret);
            caret -= 1;
          } else if (kind === "deleteContentForward") {
            typed = typed.slice(0, caret) + typed.slice(caret + 1);
          }
        }
        caretDigits.current = typed.slice(0, caret).replace(/[^\d.]/g, "").length;
        onChange(cleanAmount(typed));
      }}
    />
  );
}
