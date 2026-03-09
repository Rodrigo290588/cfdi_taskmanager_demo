import { SystemRole, MemberRole } from "@prisma/client"
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      id: string
      systemRole: SystemRole
      onboardingStep?: string
      onboardingData?: unknown
      memberships?: Array<{
        organizationId: string
        role: MemberRole
      }>
    } & DefaultSession["user"]
  }

  interface User {
    systemRole: SystemRole
    onboardingStep?: string
    onboardingData?: unknown
    memberships?: Array<{
      organizationId: string
      role: MemberRole
    }>
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    systemRole: SystemRole
    onboardingStep?: string
    onboardingData?: unknown
    memberships?: Array<{
      organizationId: string
      role: MemberRole
    }>
  }
}
