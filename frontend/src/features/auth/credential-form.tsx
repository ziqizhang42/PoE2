import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from "@poe2/protocol";
import { useState, type FormEvent } from "react";

import { useLogin, useRegister } from "../../auth/queries.ts";
import { Button } from "../../ui/button.tsx";
import { TextField } from "../../ui/text-field.tsx";
import {
  describeAuthError,
  PASSWORD_RULE,
  USERNAME_RULE,
  validatePassword,
  validateUsername,
  type AuthMode,
} from "./messages.ts";

interface FieldErrors {
  readonly username: string | null;
  readonly password: string | null;
}

const NO_FIELD_ERRORS: FieldErrors = { username: null, password: null };

function readField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads the password only at submission and never stores it in React state. */
export function CredentialForm({ mode }: { mode: AuthMode }) {
  const login = useLogin();
  const register = useRegister();
  const action = mode === "login" ? login : register;

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (action.isPending) {
      return;
    }

    const form = event.currentTarget;
    const data = new FormData(form);
    const username = readField(data, "username");
    const password = readField(data, "password");

    const errors: FieldErrors = {
      username: validateUsername(username),
      password: validatePassword(password),
    };
    setFieldErrors(errors);

    if (errors.username !== null || errors.password !== null) {
      action.reset();
      // Focus the first invalid field so its associated error is announced.
      const invalid = errors.username === null ? "password" : "username";
      form.querySelector<HTMLInputElement>(`input[name="${invalid}"]`)?.focus();
      return;
    }

    void action.submit({ username, password }).then(
      () => {},
      () => {},
    );
  };

  const submitLabel = mode === "login" ? "Sign in" : "Create account";

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Credentials" className="max-w-md">
      <TextField
        id="auth-username"
        name="username"
        label="Username"
        type="text"
        autoComplete="username"
        maxLength={USERNAME_MAX_LENGTH}
        spellCheck={false}
        autoCapitalize="none"
        hint={USERNAME_RULE}
        error={fieldErrors.username}
        disabled={action.isPending}
      />
      <TextField
        id="auth-password"
        name="password"
        label="Password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={PASSWORD_RULE}
        error={fieldErrors.password}
        disabled={action.isPending}
      />

      {action.error === null ? null : (
        <p
          role="alert"
          className="mb-4 rounded-md border-l-[3px] border-l-pen-2 bg-pen-2-soft px-3 py-2.5 text-sm text-pen-2-text"
        >
          {describeAuthError(action.error, mode)}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={action.isPending}>
        {action.isPending ? `${submitLabel}…` : submitLabel}
      </Button>
    </form>
  );
}
