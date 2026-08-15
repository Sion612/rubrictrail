"use client";

import {
  AlertTriangle,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  LocaleProvider,
  useLocalizedMessages,
} from "@/components/locale-provider";
import { appEn, appZhCN } from "@/lib/i18n/messages/app";
import {
  purgeProjectState,
  readProjectStateWithStatus,
  type ProjectStatePurgeResult,
} from "@/lib/local-state";

type ClearFailureReason = Extract<
  ProjectStatePurgeResult,
  { ok: false }
>["reason"];

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
  reloadPage?: () => void;
}

function ErrorPageContent({
  reset,
  reloadPage = () => window.location.reload(),
}: ErrorPageProps) {
  const messages = useLocalizedMessages(appEn, appZhCN);
  const clearFailureMessages = useMemo<Record<ClearFailureReason, string>>(
    () => ({
      unavailable: messages["error.failure.unavailable"],
      "coordination-unavailable": messages["error.failure.coordination-unavailable"],
      "invalid-record": messages["error.failure.invalid-record"],
      "storage-error": messages["error.failure.storage-error"],
      "intent-changed": messages["error.failure.intent-changed"],
      conflict: messages["error.failure.conflict"],
    }),
    [messages],
  );
  const clearFailureMessagesRef = useRef(clearFailureMessages);
  useLayoutEffect(() => {
    clearFailureMessagesRef.current = clearFailureMessages;
  }, [clearFailureMessages]);
  const [observedBaseline] = useState(
    () => readProjectStateWithStatus().baseline,
  );
  const [isResetting, setIsResetting] = useState(false);
  const resetActive = useRef(false);

  async function handleResetLocalProject() {
    if (resetActive.current) return;
    if (
      !window.confirm(
        messages["error.confirmReset"],
      )
    ) {
      return;
    }

    resetActive.current = true;
    setIsResetting(true);
    let shouldReload = false;
    try {
      const result = await purgeProjectState(observedBaseline);
      if (result.ok) {
        shouldReload = true;
      } else {
        window.alert(clearFailureMessagesRef.current[result.reason]);
      }
    } catch {
      window.alert(clearFailureMessagesRef.current["storage-error"]);
    } finally {
      resetActive.current = false;
      setIsResetting(false);
    }

    if (shouldReload) reloadPage();
  }

  return (
    <main className="welcome-shell" id="main-content">
      <header className="welcome-header">
        <a className="brand-lockup" href="#main-content" aria-label={messages["error.recoveryLabel"]}>
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>RubricTrail</span>
        </a>
        <div className="mode-indicator">
          <span aria-hidden="true" />
          {messages["error.mode"]}
        </div>
        <LanguageSwitcher compact />
      </header>

      <section className="welcome-grid" aria-labelledby="error-title">
        <div className="welcome-copy">
          <p className="eyebrow">{messages["error.eyebrow"]}</p>
          <h1 id="error-title">{messages["error.title"]}</h1>
          <p className="welcome-lede">
            {messages["error.lede"]}
          </p>
        </div>

        <div className="welcome-workbench">
          <div className="workbench-heading">
            <div>
              <p className="eyebrow">{messages["error.whatHappened"]}</p>
              <h2>{messages["error.viewNeedsRecovery"]}</h2>
            </div>
            <AlertTriangle aria-hidden="true" />
          </div>

          <div className="inline-alert warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{messages["error.dataDamaged"]}</strong>
              <span>{messages["error.dataDamagedDetail"]}</span>
            </div>
          </div>

          <div className="integrity-note compact privacy-row">
            <ShieldCheck aria-hidden="true" />
            <p>
              <strong>{messages["error.noAutomaticDelete"]}</strong>{" "}
              {messages["error.noAutomaticDeleteDetail"]}
            </p>
          </div>

          <div className="summary-actions" aria-busy={isResetting}>
            <button
              className="button button-secondary button-large"
              type="button"
              onClick={handleResetLocalProject}
              disabled={isResetting}
              aria-busy={isResetting}
            >
              <Trash2 aria-hidden="true" />
              {isResetting ? messages["error.resetting"] : messages["error.reset"]}
            </button>
            <button
              className="button button-primary button-large"
              type="button"
              onClick={reset}
              disabled={isResetting}
            >
              <RefreshCw aria-hidden="true" />
              {messages["error.tryAgain"]}
            </button>
          </div>
        </div>
      </section>

      <footer className="welcome-footer">
        <span>{messages["error.footerLocal"]}</span>
        <span>{messages["error.footerNoDelete"]}</span>
      </footer>
    </main>
  );
}

export default function ErrorPage(props: ErrorPageProps) {
  return (
    <LocaleProvider>
      <ErrorPageContent {...props} />
    </LocaleProvider>
  );
}
