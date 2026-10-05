import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { GoogleButton, OrDivider } from "@/components/google-button";
import { signupAction } from "../actions";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage() {
  if ((await auth())?.user) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-2 text-3xl font-bold">Create your account</h1>
      <p className="mb-8 text-muted">Your syllabus, notes and plan stay private to your account.</p>
      {googleEnabled && (
        <>
          <GoogleButton />
          <OrDivider />
        </>
      )}
      <AuthForm mode="signup" action={signupAction} />
    </>
  );
}
