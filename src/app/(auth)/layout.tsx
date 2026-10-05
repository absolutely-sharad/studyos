import { Wordmark } from "@/components/brand";
import { brand } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-md px-5 pt-10">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">{children}</main>
      <p className="pb-8 text-center text-sm text-muted">
        {brand.appName} by {brand.company}
      </p>
    </div>
  );
}
