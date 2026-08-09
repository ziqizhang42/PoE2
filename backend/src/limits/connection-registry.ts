/** Two-phase socket admission spanning the asynchronous HTTP upgrade. */

export interface ConnectionKey {
  readonly userId: string;
  readonly address: string;
}

export interface ConnectionAdmission {
  /** False means the upgrade reservation expired before its socket arrived. */
  claim(): boolean;
  release(): void;
}

export interface ConnectionRegistry {
  admit(key: ConnectionKey): Promise<ConnectionAdmission | null>;
}
