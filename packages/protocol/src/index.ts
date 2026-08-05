export {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  AuthUserSchema,
  LoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSchema,
  RegisterRequestSchema,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  UsernameSchema,
} from "./auth.js";
export type {
  AuthErrorCode,
  AuthErrorResponse,
  AuthSessionResponse,
  AuthUser,
  LoginRequest,
  RegisterRequest,
} from "./auth.js";

export {
  ActiveGameSnapshotSchema,
  BoardSchema,
  CellSchema,
  FinishedGameSnapshotSchema,
  GAME_STATUSES,
  GameResultSchema,
  GameSnapshotSchema,
  LobbyEntrySchema,
  PlayerSchema,
  ScoreByPlayerSchema,
  SquareSchema,
  WaitingGameSnapshotSchema,
} from "./game.js";
export type {
  ActiveGameSnapshot,
  FinishedGameSnapshot,
  GameSnapshot,
  GameStatus,
  LobbyEntry,
  WaitingGameSnapshot,
} from "./game.js";

export { HealthResponseSchema } from "./health.js";
export type { HealthResponse } from "./health.js";

export {
  WS_ERROR_CODES,
  WS_PROTOCOL_VERSION,
  WsClientMessageSchema,
  WsCommandAcceptedMessageSchema,
  WsCommandRejectedMessageSchema,
  WsErrorCodeSchema,
  WsGameClosedMessageSchema,
  WsGameMoveMessageSchema,
  WsGameSnapshotMessageSchema,
  WsLobbyCancelMessageSchema,
  WsLobbyCreateMessageSchema,
  WsLobbyJoinMessageSchema,
  WsLobbySnapshotMessageSchema,
  WsServerMessageSchema,
  WsSessionReadyMessageSchema,
} from "./websocket.js";
export type {
  WsClientMessage,
  WsCommandAcceptedMessage,
  WsCommandRejectedMessage,
  WsErrorCode,
  WsGameClosedMessage,
  WsGameMoveMessage,
  WsGameSnapshotMessage,
  WsLobbyCancelMessage,
  WsLobbyCreateMessage,
  WsLobbyJoinMessage,
  WsLobbySnapshotMessage,
  WsServerMessage,
  WsSessionReadyMessage,
} from "./websocket.js";
