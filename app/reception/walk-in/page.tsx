import { redirect } from 'next/navigation'

/**
 * Legacy route, kept as a redirect rather than removed: anything that
 * still links here (e.g. a bookmark, or a handoff from elsewhere in
 * reception) lands on the unified check-in wizard instead, with the same
 * three query params preserved. WalkInWizard itself stays in the tree,
 * unreferenced, until it's safe to delete as a separate cleanup — see
 * docs/SESSION_HANDOFF.md.
 */
export default async function WalkInRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; patientName?: string; newPatientName?: string }>
}) {
  const { patientId, patientName, newPatientName } = await searchParams

  const params = new URLSearchParams()
  if (patientId) params.set('patientId', patientId)
  if (patientName) params.set('patientName', patientName)
  if (newPatientName) params.set('newPatientName', newPatientName)

  const query = params.toString()
  redirect(`/reception/check-in${query ? `?${query}` : ''}`)
}
