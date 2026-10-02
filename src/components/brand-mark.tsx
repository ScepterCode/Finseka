// The FinSeka mark (three people and the record book): wine on light backgrounds, white in dark mode.
export function BrandMark({ className = "size-9" }: { className?: string }) {
  return (
    <>
      <img
        src="/brand/finseka-mark.png"
        alt=""
        aria-hidden
        className={`${className} shrink-0 object-contain dark:hidden`}
      />
      <img
        src="/brand/finseka-mark-white.png"
        alt=""
        aria-hidden
        className={`${className} hidden shrink-0 object-contain dark:block`}
      />
    </>
  );
}
