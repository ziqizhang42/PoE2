import { useCallback, useMemo, useState, type ReactNode } from "react";

import { SigningOutContext } from "./signing-out.ts";

/** Shell-scoped sign-out intent shared by navigation and route guards. */
export function SigningOutProvider({ children }: { children: ReactNode }) {
  const [signingOut, setSigningOut] = useState(false);

  const beginSignOut = useCallback(() => {
    setSigningOut(true);
  }, []);

  const abandonSignOut = useCallback(() => {
    setSigningOut(false);
  }, []);

  const value = useMemo(
    () => ({ signingOut, beginSignOut, abandonSignOut }),
    [signingOut, beginSignOut, abandonSignOut],
  );

  return <SigningOutContext value={value}>{children}</SigningOutContext>;
}
