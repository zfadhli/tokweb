import { statSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import type { Recording } from "../core/types";
import type { ServerDeps } from "./deps";

export interface RemuxResult {
  ok: boolean;
  file: string | null;
  error: string | null;
}

const inflight = new Map<string, Promise<RemuxResult>>();

/** Remux a kept .ts capture to .mp4 next to it, once, on demand. */
export async function remuxRecording(
  deps: ServerDeps,
  recording: Recording,
): Promise<RemuxResult> {
  const pending = inflight.get(recording.id);
  if (pending) return pending;
  const job = run(deps, recording).finally(() => inflight.delete(recording.id));
  inflight.set(recording.id, job);
  return job;
}

function fail(error: string): RemuxResult {
  return { ok: false, file: null, error };
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function adopt(
  recording: Recording,
  source: string,
  target: string,
  keepSource: boolean,
): RemuxResult {
  recording.file = basename(target);
  recording.bytes = fileSize(target);
  recording.state = "completed";
  recording.error = null;
  if (!keepSource) {
    try {
      unlinkSync(source);
    } catch {
      // Best effort: the .ts is already a leftover at this point.
    }
  }
  return { ok: true, file: target, error: null };
}

async function run(
  deps: ServerDeps,
  recording: Recording,
): Promise<RemuxResult> {
  const source = deps.store.recordingPath(recording);
  if (!source) return fail("Recording file is missing.");
  if (!recording.file?.toLowerCase().endsWith(".ts"))
    return fail("Only .ts captures need remuxing.");
  const target = source.replace(/\.ts$/i, ".mp4");
  const { keepSource } = deps.store.state.settings;

  if (fileSize(target) > 0) return adopt(recording, source, target, keepSource);

  let code = 0;
  try {
    const child = Bun.spawn(
      [
        deps.store.state.settings.ffmpegPath,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        source,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        target,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    code = await child.exited;
    if (code !== 0) {
      const stderr = (await new Response(child.stderr).text()).trim();
      try {
        unlinkSync(target);
      } catch {
        // A partial target would be adopted as success on the next attempt.
      }
      return fail(
        stderr ? stderr.slice(-200) : `ffmpeg exited with code ${code}`,
      );
    }
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "ffmpeg did not start.",
    );
  }
  return adopt(recording, source, target, keepSource);
}
