import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, emailSubject, hit, peek, RULES } from "@/lib/rate-limit";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

/** Thrown from `authorize` so the login form can tell "slow down" apart from "wrong password". */
export class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// A real cost-12 hash. Checking against it when the email is unknown makes "no such account"
// take as long as "wrong password", so response time doesn't reveal which emails are registered.
const TIMING_HASH = "$2b$12$AWw/6IfkM1/PWbVhHjd7KeNR/kmjdiTTUTSVyBbBRbHJKdUEUkei.";

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const providers: Provider[] = [
  Credentials({
    credentials: { email: {}, password: {} },
    // This is the only place a password is ever checked, so the brute-force limits live here and
    // also cover direct POSTs to /api/auth/callback/credentials, not just our login form.
    async authorize(raw, request) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { email, password } = parsed.data;

      const [byAddress, byAccount] = await Promise.all([
        hit(RULES.loginIp, clientIp(request.headers)),
        peek(RULES.loginFailures, emailSubject(email)),
      ]);
      if (!byAddress.ok || !byAccount.ok) throw new TooManyAttempts();

      const user = await db.user.findUnique({ where: { email } });
      const matches = await bcrypt.compare(password, user?.passwordHash ?? TIMING_HASH);
      if (!user?.passwordHash || !matches) {
        await hit(RULES.loginFailures, emailSubject(email));
        return null;
      }
      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];
if (googleEnabled) providers.push(Google);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter's types target the default @prisma/client output; the runtime API is identical.
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
