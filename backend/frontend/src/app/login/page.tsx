"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, KeyRound, LogIn, User } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageLoading } from "@/components/ui/Loading";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Where to go after signing in.
   *
   * Only same-origin absolute paths are honoured, so `next` cannot bounce the
   * user to an external site. A leading `/ui` is stripped because the router
   * re-applies `basePath` itself — leaving it in produces `/ui/ui/...`.
   */
  const nextPath = (() => {
    const raw = searchParams.get("next");
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard/";
    const stripped = raw.replace(/^\/ui(?=\/|$)/, "");
    return stripped || "/dashboard/";
  })();

  useEffect(() => {
    if (!loading && user) router.replace(nextPath);
  }, [loading, user, router, nextPath]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await signIn(username.trim(), password);
      setPassword("");
      router.replace(nextPath);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "เข้าสู่ระบบไม่สำเร็จ",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoading message="กำลังตรวจสอบเซสชัน…" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 text-center">
          <span
            className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20"
            aria-hidden="true"
          >
            <Eye className="size-7" />
          </span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            เข้าสู่ระบบ
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            สำหรับนักวิจัยและผู้ดูแลระบบเท่านั้น
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <Input
            label="ชื่อผู้ใช้"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            icon={<User className="size-4" aria-hidden="true" />}
          />
          <Input
            label="รหัสผ่าน"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            icon={<KeyRound className="size-4" aria-hidden="true" />}
          />

          {error && <Alert tone="error">{error}</Alert>}

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={submitting}
            icon={<LogIn className="size-4" aria-hidden="true" />}
          >
            เข้าสู่ระบบ
          </Button>
        </form>

        <a
          href="/ui/"
          className="mt-5 block rounded text-center text-sm text-slate-500 transition-colors hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
        >
          ← กลับไปหน้าแรก
        </a>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <LoginForm />
    </Suspense>
  );
}
