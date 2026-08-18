import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { SIGN_IN_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { returnPath } from "../../app/routes.ts";
import { useSession } from "../../auth/queries.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { EYEBROW, H_XL, NOTE } from "../../ui/classes.ts";
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
    <div className="py-8">
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
                ? `${SEGMENT} selected-control`
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
                ? `${SEGMENT} selected-control`
                : `${SEGMENT} text-ink-2 hover:text-ink`
            }
          >
            Create account
          </button>
        </div>

        {/* Remount to clear credentials and errors when changing mode. */}
        <CredentialForm key={mode} mode={mode} />
      </div>
    </div>
  );
}
