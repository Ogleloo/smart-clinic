import type { ActionState } from '../../../app/actions/profile'

export interface ProfileSettingsHarnessProps {
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  idNumber: string | null
  email: string
  roleLabel: string
  clinicName: string | null
  today: string
}

export interface ProfileSettingsHarnessConfig {
  props: ProfileSettingsHarnessProps
  /** What the mocked updateProfile() returns on every call — the test sets this to simulate a server rejection. */
  updateProfileResponse: ActionState
}

declare global {
  interface Window {
    // Namespaced (not __harnessConfig) so this never collides with the nurse-queue-harness's own global Window
    // augmentation of the same name — both files are compiled together by one project-wide tsc.
    __profileHarnessConfig: ProfileSettingsHarnessConfig
    __profileHarness: { calls: { name: string; args: unknown[] }[] }
  }
}
