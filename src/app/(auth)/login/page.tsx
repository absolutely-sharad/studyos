import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { GoogleButton, OrDivider } from "@/components/google-button";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if ((await auth())?.user) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-2 text-3xl font-bold">Sign in</h1>
      <p className="mb-8 text-muted">Pick up where your plan left off.</p>
      {googleEnabled && (
        <>
          <GoogleButton />
          <OrDivider />
        </>
      )}
      <AuthForm mode="login" action={loginAction} />
    </>
  );
}
