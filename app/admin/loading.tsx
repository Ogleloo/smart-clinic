/**
 * Shown inside the admin shell (sidebar and mobile nav stay in place) while an admin page's data loads, so moving
 * between admin areas never leaves a blank page. Shapes only — no figures that could pass for real data. Rendered
 * inside the shell's single <main>, so it is a plain container. Announced once to screen readers; the pulse stops
 * under prefers-reduced-motion (globals.css).
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[1176px] animate-pulse flex-col gap-4 px-0 py-2 sm:px-2">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div aria-hidden className="h-11 w-72 rounded-sm bg-subtle" />
      <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[140px] rounded-lg bg-subtle" />
        ))}
      </div>
      <div aria-hidden className="h-72 rounded-lg bg-subtle" />
    </div>
  )
}
