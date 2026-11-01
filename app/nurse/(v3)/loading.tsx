/**
 * Shown inside the Nurse V3 shell (sidebar and mobile nav stay in place) while a V3 screen's server data loads, so
 * moving between Dashboard and My Queue never leaves a blank page. Shapes only — no figures, names or tokens that
 * could be mistaken for real queue data. Announced once to screen readers; the pulse stops under
 * prefers-reduced-motion (globals.css).
 */
export default function NurseV3Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-[1176px] animate-pulse flex-col gap-4 px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
    >
      <p role="status" className="sr-only">
        Loading your nurse screen…
      </p>
      <div aria-hidden className="h-11 w-64 rounded-sm bg-subtle" />
      <div aria-hidden className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[140px] rounded-lg bg-subtle" />
        ))}
      </div>
      <div aria-hidden className="h-72 rounded-lg bg-subtle" />
    </main>
  )
}
