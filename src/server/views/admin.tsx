import { esc } from "../view";
import { Layout, type PageChrome } from "./layout";
import { Empty } from "./partials/empty";
import { SettingsForm } from "./partials/settings-form";

export interface VariantOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface CookieFieldView {
  name: string;
  label: string;
  value: string;
  saved: boolean;
}

export interface SettingsView {
  outputDir: string;
  ffmpegPath: string;
  proxy: string;
  userAgent: string;
  bitrate: string;
  keepSource: boolean;
  cookieFields: CookieFieldView[];
  variants: VariantOption[];
}

export interface AdminMinutes {
  interval: number;
  maxDuration: string;
}

export interface AdminSystemItem {
  label: string;
  value: string;
}

export interface AdminStorageRow {
  handle: string;
  files: number;
  bytes: string;
  duration: string;
  pct: number;
}

export interface AdminView {
  notice: string | null;
  settings: SettingsView;
  minutes: AdminMinutes;
  system: { items: AdminSystemItem[] };
  storage: AdminStorageRow[];
}

export function Admin(props: {
  chrome: PageChrome;
  data: AdminView;
}): JSX.Element {
  const data = props.data;
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Admin</p>
          <h1>Settings</h1>
          <p class="page-sub">
            Capture defaults, paths, network, and what this machine is doing
            right now.
          </p>
        </div>
      </header>

      <div class="admin-page">
        <div class="split">
          <div>
            <SettingsForm data={data} />
          </div>
          <div class="stack">
            <section class="panel" aria-label="System">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Machine</p>
                  <h2>System</h2>
                </div>
              </div>
              <div class="panel-body">
                <dl class="meta-grid">
                  {data.system.items.map((item) => (
                    <div>
                      <dt>{esc(item.label)}</dt>
                      <dd>{esc(item.value)}</dd>
                    </div>
                  ))}
                </dl>
                <p class="hint admin-note">
                  State file: data/state.json, plaintext, local only.
                </p>
              </div>
            </section>
          </div>
        </div>

        <section class="panel admin-storage" aria-label="Storage">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Disk</p>
              <h2>Storage by user</h2>
            </div>
            <span class="counter">largest first</span>
          </div>
          <div class="panel-body">
            {data.storage.length > 0 ? (
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th scope="col">Handle</th>
                      <th scope="col" class="align-right">
                        Files
                      </th>
                      <th scope="col" class="align-right">
                        Size
                      </th>
                      <th scope="col">Share</th>
                      <th scope="col" class="align-right">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.storage.map((row) => (
                      <tr>
                        <td>
                          <strong>@{esc(row.handle)}</strong>
                        </td>
                        <td class="num">{row.files}</td>
                        <td class="num">{esc(row.bytes)}</td>
                        <td>
                          <span class="storage-bar">
                            <span style={`width: ${row.pct}%`}></span>
                          </span>
                        </td>
                        <td class="num">{esc(row.duration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No stored footage yet."
                hint="Finished captures group here by handle."
              />
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
