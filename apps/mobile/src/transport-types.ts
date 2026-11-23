import type { Info, ServerEvent } from "@sarsat/shared/protocol";

export type Command = { type: "stop" } | { type: "retune"; centerHz: number } | ({ type: "start" } & Record<string, unknown>);
export type Transport = {
  info(): Promise<Info>;
  send(command: Command): void;
  close(): void;
  watchDevices?(listener: (devices: Info["devices"]) => void): () => void;
  // Native only: copy a WAV picked on the tablet and return its playlist name.
  pickFile?(): Promise<string | null>;
  label: string;
};
export type TransportHandlers = {
  event(event: ServerEvent): void;
  connection(connected: boolean, reason?: string): void;
};
