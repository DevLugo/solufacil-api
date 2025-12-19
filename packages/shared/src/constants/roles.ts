export const USER_ROLES = {
  ADMIN: 'ADMIN',
  NORMAL: 'NORMAL',
  CAPTURA: 'CAPTURA',
  DOCUMENT_REVIEWER: 'DOCUMENT_REVIEWER',
} as const

export type UserRoleType = (typeof USER_ROLES)[keyof typeof USER_ROLES]
