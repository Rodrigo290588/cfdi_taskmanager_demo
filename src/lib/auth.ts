import NextAuth, { User } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"
import { JWT } from "next-auth/jwt"
import { Session } from "next-auth"
import type { Adapter } from "next-auth/adapters"
import { signInSchema } from "@/schemas/auth"

import { rateLimit } from "@/lib/rate-limit"

const authOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // 1. Validate Input with Zod
        const parsedCredentials = signInSchema.safeParse(credentials)

        if (!parsedCredentials.success) {
          return null
        }

        const { email, password } = parsedCredentials.data

        // 2. Rate Limiting Check (by email)
        // Using centralized rate limiter
        const { success } = rateLimit(email, { 
          interval: 15 * 60 * 1000, // 15 minutes
          limit: 5 // 5 attempts per window
        })

        if (!success) {
          throw new Error("Too many login attempts. Please try again later.")
        }

        const user = await prisma.user.findUnique({
          where: {
            email: email
          }
        })

        // 3. Timing Attack Mitigation
        if (!user || !user.password) {
          // Perform dummy comparison to simulate processing time
          // Using a pre-calculated valid hash to ensure consistent timing
          await bcrypt.compare(
            password,
            "$2b$10$huPOUmjEOrRVhh7IiDkWWeJiXfJNXMS8KezTCXLutccf6cAhzvFh6" // Valid dummy hash
          ).catch(() => {}) 
          
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          systemRole: user.systemRole,
        }
      }
    })
  ],
  session: {
    strategy: "jwt" as const,
  },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: User }) {
      if (user) {
        token.id = user.id!
        token.email = user.email
        token.name = user.name
        token.systemRole = user.systemRole
        token.onboardingStep = user.onboardingStep
        token.onboardingData = user.onboardingData
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        session.user.id = token.id
        session.user.email = token.email
        session.user.name = token.name
        session.user.systemRole = token.systemRole
        session.user.onboardingStep = token.onboardingStep
        session.user.onboardingData = token.onboardingData
      }
      return session
    },
  },
  pages: {
    signIn: "/auth/signin",
    signUp: "/auth/signup",
  },
  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions)
