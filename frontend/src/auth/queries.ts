/** Sole owner of session state: `null` is signed out; `undefined` is unresolved. */

import type { AuthUser, LoginRequest, RegisterRequest } from "@poe2/protocol";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuthClient } from "../runtime/context.ts";
import type { AuthClient } from "./client.ts";
import type { AuthRequestError } from "./errors.ts";

export const AUTH_SESSION_KEY = ["auth", "session"] as const;

export type AuthSessionKey = typeof AUTH_SESSION_KEY;

export interface AuthActionState {
  readonly isPending: boolean;
  readonly error: AuthRequestError | null;
  /** Clears `error` once it has been shown. */
  reset: () => void;
}

export interface AuthCredentialAction<TCredentials> extends AuthActionState {
  /** Resolves with the authenticated user, or rejects with `AuthRequestError`. */
  submit: (credentials: TCredentials) => Promise<AuthUser>;
}

export interface AuthLogoutAction extends AuthActionState {
  submit: () => Promise<void>;
}

export function sessionQueryOptions(
  client: AuthClient,
): UseQueryOptions<AuthUser | null, AuthRequestError, AuthUser | null, AuthSessionKey> {
  return {
    queryKey: AUTH_SESSION_KEY,
    queryFn: ({ signal }) => client.fetchSession(signal),
  };
}

export function useSession(): UseQueryResult<AuthUser | null, AuthRequestError> {
  const client = useAuthClient();
  return useQuery(sessionQueryOptions(client));
}

export function useRegister(): AuthCredentialAction<RegisterRequest> {
  const client = useAuthClient();
  return useCredentialAction<RegisterRequest>((credentials) => client.register(credentials));
}

export function useLogin(): AuthCredentialAction<LoginRequest> {
  const client = useAuthClient();
  return useCredentialAction<LoginRequest>((credentials) => client.login(credentials));
}

export function useLogout(): AuthLogoutAction {
  const client = useAuthClient();
  const queryClient = useQueryClient();

  const mutation = useMutation<void, AuthRequestError, void>({
    gcTime: 0,
    mutationFn: () => client.logout(),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: AUTH_SESSION_KEY });
      queryClient.setQueryData<AuthUser | null>(AUTH_SESSION_KEY, null);
    },
  });

  const { mutateAsync } = mutation;
  const submit = useCallback(() => mutateAsync(), [mutateAsync]);

  return { submit, isPending: mutation.isPending, error: mutation.error, reset: mutation.reset };
}

/**
 * A mutation's variables stay in the mutation cache for as long as the mutation
 * does, so credentials are never passed as variables. They travel inside a
 * container that `takeCredentials` empties before the request is even issued,
 * leaving the cache holding an empty container rather than a password.
 */
interface CredentialsEnvelope<TCredentials> {
  credentials: TCredentials | null;
}

function takeCredentials<TCredentials>(envelope: CredentialsEnvelope<TCredentials>): TCredentials {
  const credentials = envelope.credentials;
  envelope.credentials = null;

  if (credentials === null) {
    throw new Error("Authentication credentials may only be submitted once");
  }

  return credentials;
}

/**
 * Cancelling the session query first stops a fetch that started before this
 * action from landing after it and restoring the previous answer.
 */
function useCredentialAction<TCredentials>(
  run: (credentials: TCredentials) => Promise<AuthUser>,
): AuthCredentialAction<TCredentials> {
  const queryClient = useQueryClient();

  const mutation = useMutation<AuthUser, AuthRequestError, CredentialsEnvelope<TCredentials>>({
    gcTime: 0,
    // Each submission fills its own envelope, so a retry would find an empty
    // one rather than replaying credentials this hook no longer holds.
    retry: 0,
    mutationFn: (envelope) => run(takeCredentials(envelope)),
    onSuccess: async (user) => {
      await queryClient.cancelQueries({ queryKey: AUTH_SESSION_KEY });
      queryClient.setQueryData<AuthUser | null>(AUTH_SESSION_KEY, user);
    },
  });

  const { mutateAsync } = mutation;
  const submit = useCallback(
    (credentials: TCredentials) => mutateAsync({ credentials }),
    [mutateAsync],
  );

  return { submit, isPending: mutation.isPending, error: mutation.error, reset: mutation.reset };
}
