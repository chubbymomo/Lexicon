"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, ApiFailure, type Me } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Notice } from "./ui";

const SessionContext = createContext<Me | null>(null);

/** The signed-in user. Only call inside `<AppShell>`. */
export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe must be used inside AppShell");
  return me;
}

/** Page frame for signed-in pages: loads the session, or sends the visitor to sign in. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useResource(api.me);
  const due = useResource(api.dueReviews, pathname);
  const signedOut = session.error instanceof ApiFailure && session.error.status === 401;

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  async function signOut() {
    await api.logout().catch(() => {});
    // A full page load drops every screen cached for the signed-in user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full reload
    window.location.assign("/login");
  }

  const links = [
    { href: "/", label: "Library" },
    {
      href: "/review",
      label: due.data?.dueCount ? `Review (${due.data.dueCount})` : "Review",
    },
    { href: "/progress", label: "Progress" },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule py-5">
        <Link href="/" className="font-display text-3xl font-semibold tracking-wide">
          Lexicon
        </Link>
        {session.data && (
          <nav className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className="label whitespace-nowrap hover:text-ink aria-[current=page]:text-accent"
              >
                {link.label}
              </Link>
            ))}
            <button onClick={signOut} className="label whitespace-nowrap hover:text-ink">
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="pt-8">
        {session.data ? (
          <SessionContext.Provider value={session.data}>{children}</SessionContext.Provider>
        ) : session.error && !signedOut ? (
          <Notice>{session.error.message}</Notice>
        ) : (
          <p className="text-soft">Opening the lexicon…</p>
        )}
      </main>
    </div>
  );
}
