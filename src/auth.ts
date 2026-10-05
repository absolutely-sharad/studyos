import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { DUMMY_HASH, hashPassword, PasswordBusyError, verifyPassword } from "@/lib/password";
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

/** The server is busy checking other passwords. Not the student's fault, so it is not counted as a failed attempt. */
export class ServerBusy extends CredentialsSignin {
  code = "busy";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** An older bcrypt hash, or scrypt with weaker settings, is replaced the moment its owner proves the password. */
async function upgradeHash(userId: string, currentHash: string, password: string) {
  try {
    const upgraded = await hashPassword(password);
    // Only if the hash is still the one we checked, so a concurrent change is never overwritten.
    await db.user.updateMany({ where: { id: userId, passwordHash: currentHash }, data: { passwordHash: upgraded } });
  } catch (err) {
    // The sign-in itself succeeded. If we're busy or the write failed, the upgrade happens next time.
    if (err instanceof PasswordBusyError) log.debug("password hash upgrade skipped: busy", { userId });
    else log.error("password hash upgrade failed", err, { userId });
  }
}

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
      // Unknown emails are checked against a dummy hash so "no such account" takes as long as "wrong password".
      let check;
      try {
        check = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      } catch (err) {
        if (err instanceof PasswordBusyError) throw new ServerBusy();
        throw err;
      }
      if (!user?.passwordHash || !check.ok) {
        await hit(RULES.loginFailures, emailSubject(email));
        return null;
      }
      if (check.needsRehash) await upgradeHash(user.id, user.passwordHash, password);
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
