import { esc } from "../view";
import { Layout, type PageChrome } from "./layout";
import { RecordingsGrid } from "./partials/recordings-grid";

export interface RecordingRow {
  id: string;
  handle: string;
  title: string;
  initial: string;
  date: string;
  duration: string;
  bytes: string;
  fileName: string | null;
  thumb: boolean;
  playable: boolean;
  hasFile: boolean;
  deletable: boolean;
  deleteTitle: string | null;
  deleteConfirm: string;
  search: string;
  bucket: "completed" | "failed" | "active";
  chipClass: string;
  chipLabel: string;
}

export interface RecordingCounts {
  all: number;
  completed: number;
  failed: number;
  active: number;
}

export interface RecordingsStat {
  label: string;
  value: string;
  note: string;
  kind: "plain" | "hot";
}

export interface RecordingsView {
  stats: RecordingsStat[];
  counts: RecordingCounts;
  rows: RecordingRow[];
}

function Stat(props: RecordingsStat) {
  return (
    <article class={`stat${props.kind === "hot" ? " is-hot" : ""}`}>
      <span class="stat-label">{esc(props.label)}</span>
      <strong class="stat-value">{esc(props.value)}</strong>
      <span class="stat-note">{esc(props.note)}</span>
    </article>
  );
}

export function Recordings(props: {
  chrome: PageChrome;
  data: RecordingsView;
}) {
  const data = props.data;
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Archive</p>
          <h1>Recordings</h1>
          <p class="page-sub">Every capture on this machine, newest first.</p>
        </div>
        <div class="page-actions">
          <button
            class="btn btn-ghost"
            type="button"
            hx-post="/recordings/rescan"
            hx-swap="none"
            title="Scan the output folder for files added or deleted outside the app"
          >
            <svg class="icon" aria-hidden="true">
              <use href="#i-refresh" />
            </svg>
            Rescan
          </button>
        </div>
      </header>

      <div x-data="{ q: '', state: 'all' }" class="recordings-page">
        <section class="stats" aria-label="Archive totals">
          {data.stats.map((stat) => (
            <Stat {...stat} />
          ))}
        </section>

        <section class="panel">
          <div class="panel-head recordings-toolbar">
            <div class="recordings-search">
              <input
                class="input"
                type="search"
                placeholder="Search handle or title"
                aria-label="Search recordings"
                x-model="q"
              />
            </div>
            <div class="filter-row" role="group" aria-label="Filter recordings">
              <button
                type="button"
                class="btn btn-small"
                x-bind:class="{ 'is-active': state === 'all' }"
                x-on:click="state = 'all'"
                x-bind:aria-pressed="state === 'all'"
              >
                All ({data.counts.all})
              </button>
              <button
                type="button"
                class="btn btn-small"
                x-bind:class="{ 'is-active': state === 'completed' }"
                x-on:click="state = 'completed'"
                x-bind:aria-pressed="state === 'completed'"
              >
                Completed ({data.counts.completed})
              </button>
              <button
                type="button"
                class="btn btn-small"
                x-bind:class="{ 'is-active': state === 'failed' }"
                x-on:click="state = 'failed'"
                x-bind:aria-pressed="state === 'failed'"
              >
                Failed ({data.counts.failed})
              </button>
              <button
                type="button"
                class="btn btn-small"
                x-bind:class="{ 'is-active': state === 'active' }"
                x-on:click="state = 'active'"
                x-bind:aria-pressed="state === 'active'"
              >
                In progress ({data.counts.active})
              </button>
            </div>
          </div>
          <div
            id="recordings-panel"
            hx-get="/partials/recordings"
            hx-trigger="refreshRecordings from:body, every 5s"
            hx-swap="innerMorph"
            hx-target="this"
          >
            <RecordingsGrid data={data} />
          </div>
        </section>
      </div>
    </Layout>
  );
}
