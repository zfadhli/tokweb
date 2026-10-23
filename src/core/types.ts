/**
 * Domain types. External payloads never enter this file unparsed; see
 * src/tiktok/parse.ts for the boundary.
 */

export const VARIANTS = ["best", "hd", "sd", "audio"] as const;
export type Variant = (typeof VARIANTS)[number];

export type LiveStatus = "live" | "offline";
export type StreamFormat = "flv" | "hls" | "m4a";

export interface StreamSource {
  url: string;
  format: StreamFormat;
  quality: string;
}

export interface LiveRoom {
  status: LiveStatus;
  uniqueId: string;
  nickname: string;
  avatarUrl: string | null;
  roomId: string | null;
  title: string;
  viewers: number;
  streams: StreamSource[];
}

export interface ResolveInput {
  uniqueId?: string | null;
  roomId?: string | null;
  url?: string | null;
}

export interface ResolveResult {
  room: LiveRoom;
  /** Which stream to feed ffmpeg. Null when offline or no feed. */
  source: StreamSource | null;
}

export type RecordingState =
  | "starting"
  | "recording"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

export interface Recording {
  id: string;
  monitorId: string | null;
  uniqueId: string;
  roomId: string | null;
  title: string;
  variant: Variant;
  state: RecordingState;
  /** File name relative to settings.outputDir. */
  file: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  bytes: number;
  error: string | null;
}

export type MonitorState =
  "idle" | "checking" | "waiting" | "live" | "recording" | "error" | "stopped";

export interface Monitor {
  id: string;
  uniqueId: string | null;
  roomId: string | null;
  variant: Variant;
  autoRecord: boolean;
  intervalSec: number;
  maxDurationSec: number | null;
  state: MonitorState;
  live: boolean;
  title: string;
  viewers: number;
  avatarUrl: string | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  recordingId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  outputDir: string;
  ffmpegPath: string;
  cookies: string;
  proxy: string;
  userAgent: string;
  defaultVariant: Variant;
  defaultIntervalSec: number;
  defaultMaxDurationSec: number;
  bitrate: string;
  keepSource: boolean;
}

export interface AppState {
  version: 1;
  settings: Settings;
  monitors: Monitor[];
  recordings: Recording[];
}

export interface MonitorInput {
  uniqueId?: string;
  url?: string;
  roomId?: string;
  variant?: Variant;
  autoRecord?: boolean;
  intervalSec?: number;
  maxDurationSec?: number | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const isLive = (room: LiveRoom): boolean => room.status === "live";
