/** Distinguishes deliberate logout from expiry before the session cache clears. */

import { createContext, useContext } from "react";

export interface SigningOut {
  readonly signingOut: boolean;
  readonly beginSignOut: () => void;
  readonly abandonSignOut: () => void;
}

export const SigningOutContext = createContext<SigningOut | null>(null);

export function useSigningOut(): SigningOut {
  const value = useContext(SigningOutContext);

  if (value === null) {
    throw new Error("AppShell must enclose anything that observes signing out");
  }

  return value;
}
