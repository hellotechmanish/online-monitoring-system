"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client-api";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { username: username.trim(), password } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Sign in failed"));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
      <Field label="Username" htmlFor="username" required>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-invalid={!!error || undefined}
          autoFocus
        />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error || undefined}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full justify-center" loading={loading}>
        Sign In
      </Button>
    </form>
  );
}
