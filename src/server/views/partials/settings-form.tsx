import { esc } from "../../view";
import type { AdminView } from "../admin";

export function SettingsForm(props: {
  data: Pick<AdminView, "notice" | "settings" | "minutes">;
}): JSX.Element {
  const { notice, settings, minutes } = props.data;
  return (
    <div id="settings-panel" class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Defaults</p>
          <h2>Capture settings</h2>
        </div>
      </div>
      <div class="panel-body">
        {notice ? <p class="notice">{esc(notice)}</p> : null}
        <form
          hx-put="/admin/settings"
          hx-target="#settings-panel"
          hx-swap="outerHTML"
          {...{ "hx-disable": "find button" }}
        >
          <h3 class="admin-group">Capture defaults</h3>
          <div class="form-grid">
            <div class="field span-2">
              <label for="set-variant">Default quality</label>
              <select class="select" id="set-variant" name="defaultVariant">
                {settings.variants.map((variant) => (
                  <option
                    value={esc(variant.value)}
                    selected={variant.selected ? true : undefined}
                  >
                    {esc(variant.label)}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="set-interval">Default poll in minutes</label>
              <input
                class="input"
                id="set-interval"
                name="defaultIntervalMin"
                type="number"
                min="1"
                step="1"
                value={String(minutes.interval)}
              />
            </div>
            <div class="field">
              <label for="set-max">
                Default max segment in minutes, 0 = unlimited
              </label>
              <input
                class="input"
                id="set-max"
                name="defaultMaxDurationMin"
                type="number"
                min="0"
                step="1"
                value={esc(minutes.maxDuration)}
                placeholder="unlimited"
              />
            </div>
            <div class="field span-2">
              <label for="set-bitrate">Re-encode bitrate</label>
              <input
                class="input"
                id="set-bitrate"
                name="bitrate"
                type="text"
                value={esc(settings.bitrate)}
                placeholder="blank = stream copy"
              />
            </div>
          </div>
          <h3 class="admin-group">Paths</h3>
          <div class="form-grid">
            <div class="field span-2">
              <label for="set-outdir">Output directory</label>
              <input
                class="input"
                id="set-outdir"
                name="outputDir"
                type="text"
                value={esc(settings.outputDir)}
                autocomplete="off"
              />
            </div>
            <div class="field span-2">
              <label for="set-ffmpeg">ffmpeg path</label>
              <input
                class="input"
                id="set-ffmpeg"
                name="ffmpegPath"
                type="text"
                value={esc(settings.ffmpegPath)}
                autocomplete="off"
              />
            </div>
          </div>
          <h3 class="admin-group">Network</h3>
          <div class="form-grid">
            <div class="field">
              <label for="set-proxy">Proxy</label>
              <input
                class="input"
                id="set-proxy"
                name="proxy"
                type="text"
                value={esc(settings.proxy)}
                autocomplete="off"
                placeholder="blank = direct"
              />
            </div>
            <div class="field">
              <label for="set-ua">User agent override</label>
              <input
                class="input"
                id="set-ua"
                name="userAgent"
                type="text"
                value={esc(settings.userAgent)}
                autocomplete="off"
                placeholder="blank = default"
              />
            </div>
            {settings.cookieFields.map((field) => (
              <div class="field" x-data="{ show: false }">
                <label for={`set-cookie-${field.name}`}>{field.label}</label>
                <input
                  class="input"
                  type="password"
                  x-bind:type="show ? 'text' : 'password'"
                  id={`set-cookie-${field.name}`}
                  name={`cookie-${field.name}`}
                  value={esc(field.value)}
                  {...{ autocomplete: "new-password" }}
                  placeholder={`paste ${field.name} from your browser cookies`}
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-small"
                  x-on:click="show = !show"
                  x-text="show ? 'Hide' : 'Show'"
                >
                  Show
                </button>
                {field.saved ? (
                  <span class="hint">Status: saved.</span>
                ) : (
                  <span class="hint">Status: not set.</span>
                )}
              </div>
            ))}
            <div class="field span-2">
              <input type="hidden" name="clearCookies" value="" />
              <label class="check">
                <input type="checkbox" name="clearCookies" value="1" />
                <span class="check-box" aria-hidden="true"></span>Clear saved
                cookies
              </label>
            </div>
          </div>
          <h3 class="admin-group">Options</h3>
          <div class="form-grid">
            <div class="field span-2">
              <input type="hidden" name="keepSource" value="off" />
              <label class="check">
                <input
                  type="checkbox"
                  name="keepSource"
                  value="on"
                  checked={settings.keepSource ? true : undefined}
                />
                <span class="check-box" aria-hidden="true"></span>Keep
                intermediate TS capture
              </label>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
