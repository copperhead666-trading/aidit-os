"use client";

import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
      };
    };
  }
}

type EnterState =
  | { kind: "loading"; message: string }
  | { kind: "outside"; message: string }
  | { kind: "verifying"; message: string }
  | { kind: "denied"; message: string };

export default function EnterPage() {
  const router = useRouter();
  const [state, setState] = useState<EnterState>({
    kind: "loading",
    message: "Membuka sesi Telegram...",
  });
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const createSession = useCallback(async () => {
    const webApp = window.Telegram?.WebApp;
    const initData = webApp?.initData;

    if (typeof initData !== "string" || initData.trim() === "") {
      setState({
        kind: "outside",
        message: "Halaman ini hanya bisa dibuka dari Telegram Mini App pemilik.",
      });
      return;
    }

    setState({ kind: "verifying", message: "Memverifikasi sesi Telegram..." });
    window.Telegram?.WebApp?.ready?.();

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!response.ok) {
        let reason = "Sesi Telegram ditolak.";
        try {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && typeof (body as { reason?: unknown }).reason === "string") {
            reason = (body as { reason: string }).reason;
          }
        } catch {
          reason = "Sesi Telegram ditolak.";
        }

        setState({ kind: "denied", message: reason });
        return;
      }

      router.replace("/");
    } catch {
      setState({
        kind: "denied",
        message: "Tidak bisa membuat sesi Telegram saat ini.",
      });
    }
  }, [router]);

  useEffect(() => {
    document.body.dataset.enterStandalone = "true";
    return () => {
      delete document.body.dataset.enterStandalone;
    };
  }, []);

  useEffect(() => {
    if (scriptLoaded) {
      void createSession();
    }
  }, [createSession, scriptLoaded]);

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() =>
          setState({
            kind: "outside",
            message: "Halaman ini hanya bisa dibuka dari Telegram Mini App pemilik.",
          })
        }
      />
      <style jsx global>{`
        body[data-enter-standalone="true"] > aside,
        body:has([data-enter-page]) > aside,
        body[data-enter-standalone="true"] .os-shell > .sticky,
        body:has([data-enter-page]) .os-shell > .sticky {
          display: none;
        }

        body[data-enter-standalone="true"] .os-shell,
        body:has([data-enter-page]) .os-shell {
          margin-left: 0 !important;
          margin-right: 0 !important;
          min-height: 100vh;
        }

        body[data-enter-standalone="true"] .os-shell main,
        body:has([data-enter-page]) .os-shell main {
          min-height: 100vh;
          padding: 0;
        }

        body[data-enter-standalone="true"] .os-shell main > div,
        body:has([data-enter-page]) .os-shell main > div {
          margin: 0;
          max-width: none;
        }
      `}</style>
      <main
        data-enter-page
        className="grid min-h-screen place-items-center bg-os-bg px-5 py-8 text-os-text"
      >
        <section className="w-full max-w-sm border border-os-border bg-os-surface px-6 py-7 text-center shadow-[0_24px_80px_-28px_rgba(0,0,0,0.65)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-os-dim">FounderOS Cockpit</p>
          <h1 className="mt-3 text-xl font-semibold text-os-text">Masuk lewat Telegram</h1>
          <p className="mt-4 text-sm leading-6 text-os-muted">{state.message}</p>
        </section>
      </main>
    </>
  );
}