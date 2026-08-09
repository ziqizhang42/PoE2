import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { SIGN_IN_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { returnPath } from "../../app/routes.ts";
import { useSession } from "../../auth/queries.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { CARD, EYEBROW, H_LG, H_XL, NOTE, STACK, TWO_UP } from "../../ui/classes.ts";
import { CredentialForm } from "./credential-form.tsx";
import type { AuthMode } from "./messages.ts";

const SEGMENT = "cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-colors";

export function AuthPage() {
  useDocumentTitle(SIGN_IN_TITLE);
  const session = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(
    params.get("mode") === "register" ? "register" : "login",
  );

  // Avoid flashing the form before redirecting a restored session.
  if (session.data === undefined) {
    if (!session.isError) {
      return <PagePending label="Restoring your session…" />;
    }
  } else if (session.data !== null) {
    return <Navigate to={returnPath(location.state)} replace />;
  }

  return (
    <div className={TWO_UP}>
      <div>
        <p className={EYEBROW}>Account</p>
        <h1 className={H_XL}>Sign in to play</h1>
        <p className={`${NOTE} mb-6`}>
          A game needs two identities that persist, so playing needs an account. Nothing else here
          does.
        </p>

        <div
          role="group"
          aria-label="Account action"
          className="mb-6 inline-flex rounded-full bg-sunken p-1"
        >
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => {
              setMode("login");
            }}
            className={
              mode === "login"
                ? `${SEGMENT} bg-surface text-ink shadow-lift`
                : `${SEGMENT} text-ink-2 hover:text-ink`
            }
          >
            Sign in
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => {
              setMode("register");
            }}
            className={
              mode === "register"
                ? `${SEGMENT} bg-surface text-ink shadow-lift`
                : `${SEGMENT} text-ink-2 hover:text-ink`
            }
          >
            Create account
          </button>
        </div>

        {/* Remount to clear credentials and errors when changing mode. */}
        <CredentialForm key={mode} mode={mode} />
      </div>

      <aside className={STACK} aria-labelledby="account-facts-title">
        <h2 id="account-facts-title" className={EYEBROW}>
          What an account is here
        </h2>
        <div className={CARD}>
          <h3 className={H_LG}>A username and a password</h3>
          <p className={NOTE}>
            That is the whole record. No email address, no display name, and nothing else to fill
            in.
          </p>
        </div>
        <div className={CARD}>
          <h3 className={H_LG}>The session is a cookie the server sets</h3>
          <p className={NOTE}>
            The browser never holds a token this code can read, and signing out ends the session on
            the server rather than waiting for it to expire.
          </p>
        </div>
        <div className={CARD}>
          <h3 className={H_LG}>Attempts are rate limited</h3>
          <p className={NOTE}>
            Repeated sign-ins are refused for a while — both from one address and against one
            account — so a wrong guess costs more than the next attempt.
          </p>
        </div>
        <div className={CARD}>
          <h3 className={H_LG}>There is no way to reset a password</h3>
          <p className={NOTE}>
            Recovery needs somewhere to send it, and there is no email address on file. A forgotten
            password means a new account.
          </p>
        </div>
      </aside>
    </div>
  );
}
