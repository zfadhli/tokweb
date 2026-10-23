import { Elysia } from "elysia";
import { html } from "@elysia/html";
import { VARIANTS } from "../../core/types";
import type { ServerDeps } from "../deps";
import {
  COOKIE_FIELDS,
  cookiePairs,
  mergeCookies,
  updateSettings,
} from "../settings";
import { chrome } from "./home";
import { fmtBytes, fmtDuration, isActiveRecording } from "../view";
import { Admin, type AdminView } from "../views/admin";
import { SettingsForm } from "../views/partials/settings-form";

export function adminData(
  deps: ServerDeps,
  notice: string | null = null,
): AdminView {
  const { settings, recordings, monitors } = deps.store.state;
  const stored = recordings.filter(
    (recording) => !isActiveRecording(recording),
  );
  const groups = new Map<
    string,
    { files: number; bytes: number; duration: number }
  >();
  for (const recording of stored) {
    const group = groups.get(recording.uniqueId) ?? {
      files: 0,
      bytes: 0,
      duration: 0,
    };
    group.files += 1;
    group.bytes += recording.bytes || 0;
    group.duration += recording.durationMs || 0;
    groups.set(recording.uniqueId, group);
  }
  const ranked = [...groups.entries()]
    .sort((left, right) => right[1].bytes - left[1].bytes)
    .slice(0, 6);
  const peak = ranked[0]?.[1].bytes ?? 0;
  const archiveBytes = stored.reduce(
    (sum, recording) => sum + (recording.bytes || 0),
    0,
  );

  return {
    notice,
    settings: {
      outputDir: settings.outputDir,
      ffmpegPath: settings.ffmpegPath,
      proxy: settings.proxy,
      userAgent: settings.userAgent,
      bitrate: settings.bitrate,
      keepSource: settings.keepSource,
      cookieFields: (() => {
        const pairs = cookiePairs(settings.cookies);
        return COOKIE_FIELDS.map((field) => ({
          name: field.name,
          label: field.label,
          value: pairs[field.name] ?? "",
          saved: (pairs[field.name] ?? "") !== "",
        }));
      })(),
      variants: VARIANTS.map((value) => ({
        value,
        label: value,
        selected: value === settings.defaultVariant,
      })),
    },
    minutes: {
      interval: Math.max(1, Math.round(settings.defaultIntervalSec / 60)),
      maxDuration:
        settings.defaultMaxDurationSec > 0
          ? String(Math.round(settings.defaultMaxDurationSec / 60))
          : "",
    },
    system: {
      items: [
        { label: "Bun", value: Bun.version },
        { label: "ffmpeg", value: settings.ffmpegPath },
        { label: "Output directory", value: settings.outputDir },
        { label: "Data directory", value: deps.store.dataDir },
        { label: "Active recordings", value: String(deps.engine.activeCount) },
        { label: "Watch users", value: String(monitors.length) },
        { label: "Archive files", value: String(stored.length) },
        { label: "Archive size", value: fmtBytes(archiveBytes) },
      ],
    },
    storage: ranked.map(([handle, group]) => ({
      handle,
      files: group.files,
      bytes: fmtBytes(group.bytes),
      duration: fmtDuration(group.duration),
      pct: peak > 0 ? Math.max(2, Math.round((group.bytes / peak) * 100)) : 0,
    })),
  };
}

const ON_VALUES = new Set(["on", "true", "1"]);

function formValues(form: FormData, key: string): string[] {
  const out: string[] = [];
  for (const value of form.getAll(key)) {
    if (typeof value === "string") out.push(value);
  }
  return out;
}

function formFirst(form: FormData, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function parseMinutes(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value * 60 : undefined;
}

export function adminRoutes(deps: ServerDeps) {
  return new Elysia({ name: "admin" })
    .use(html())
    .get("/admin", ({ html, set }) => {
      set.headers["Cache-Control"] = "no-store";
      return html(
        <Admin
          chrome={chrome(deps, "admin", "Settings")}
          data={adminData(deps)}
        />,
      );
    })
    .put("/admin/settings", async ({ request }) => {
      const form = await request.formData();
      const input: Record<string, unknown> = {};
      const text = (key: string): void => {
        const value = formFirst(form, [key]);
        if (value !== undefined) input[key] = value;
      };
      text("outputDir");
      text("ffmpegPath");
      text("proxy");
      text("userAgent");
      text("bitrate");
      text("defaultVariant");

      const interval = parseMinutes(
        formFirst(form, [
          "defaultIntervalMin",
          "intervalMin",
          "defaultIntervalSec",
        ]),
      );
      if (interval !== undefined) input.defaultIntervalSec = interval;
      // Blank means unlimited (0); absent means untouched.
      if (
        formFirst(form, [
          "defaultMaxDurationMin",
          "maxDurationMin",
          "defaultMaxDurationSec",
        ]) !== undefined
      ) {
        input.defaultMaxDurationSec =
          parseMinutes(
            formFirst(form, [
              "defaultMaxDurationMin",
              "maxDurationMin",
              "defaultMaxDurationSec",
            ]),
          ) ?? 0;
      }

      // Hidden fallbacks always submit, so presence means the real form ran.
      if (form.has("keepSource")) {
        input.keepSource = formValues(form, "keepSource").some((value) =>
          ON_VALUES.has(value.trim().toLowerCase()),
        );
      }
      const clearCookies = form.has("clearCookies")
        ? formValues(form, "clearCookies").some((value) =>
            ON_VALUES.has(value.trim().toLowerCase()),
          )
        : false;
      if (clearCookies) input.cookies = "";
      else {
        const updates: Record<string, string> = {};
        let touched = false;
        for (const field of COOKIE_FIELDS) {
          const value = formFirst(form, [`cookie-${field.name}`]);
          if (value !== undefined) {
            touched = true;
            updates[field.name] = value.trim();
          }
        }
        if (touched)
          input.cookies = mergeCookies(
            deps.store.state.settings.cookies,
            updates,
          );
      }

      await updateSettings(deps, input);
      return new Response(
        await (<SettingsForm data={adminData(deps, "Settings saved.")} />),
        {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "HX-Trigger": JSON.stringify({
              toast: { message: "Settings saved.", level: "ok" },
            }),
          },
        },
      );
    });
}
