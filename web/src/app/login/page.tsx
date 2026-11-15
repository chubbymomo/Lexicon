"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

export default function LoginPage() {
  const meta = useResource(api.meta);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register" && meta.data?.registrationOpen;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        await api.register({
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          inviteCode: form.inviteCode,
        });
      } else {
        await api.login({ email: form.email, password: form.password });
      }
      // A full page load, so no screen keeps state from before the sign-in.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full reload
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-center font-display text-5xl font-semibold tracking-wide">Lexicon</h1>
      <p className="mt-2 text-center text-soft italic">A shared vocabulary, learned together.</p>

      <form onSubmit={submit} className="mt-10 space-y-4">
        {registering && (
          <Field label="Your name" name="displayName" required maxLength={60} autoComplete="name" />
        )}
        <Field label="Email" name="email" type="email" required autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          minLength={registering ? 10 : undefined}
          autoComplete={registering ? "new-password" : "current-password"}
          hint={registering ? "At least ten characters." : undefined}
        />
        {registering && (
          <Field
            label="Invite code"
            name="inviteCode"
            required
            hint="The code your group agreed on when setting Lexicon up."
          />
        )}
        {error && <Notice>{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "One moment…" : registering ? "Create account" : "Sign in"}
        </Button>
      </form>

      {meta.data?.registrationOpen && (
        <button
          className="label mt-6 hover:text-ink"
          onClick={() => {
            setMode(registering ? "login" : "register");
            setError(null);
          }}
        >
          {registering ? "I already have an account" : "Create an account"}
        </button>
      )}
    </main>
  );
}
