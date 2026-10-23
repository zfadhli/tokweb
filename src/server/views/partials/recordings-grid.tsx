import { esc } from "../../view";
import { Empty } from "./empty";
import type { RecordingRow } from "../recordings";

export interface RecordingsGridData {
  rows: RecordingRow[];
}

function Row(row: RecordingRow) {
  return (
    <article
      class="capture is-card"
      data-search={esc(row.search)}
      data-state={esc(row.bucket)}
      x-show={`(state === 'all' || state === '${esc(row.bucket)}') && $el.dataset.search.includes(q.toLowerCase())`}
    >
      <a class="capture-link" href={`/recordings/${esc(row.id)}`}>
        <span class="capture-art">
          <span class="capture-initial" aria-hidden="true">
            {esc(row.initial)}
          </span>
          {row.thumb ? (
            <img
              class="capture-thumb"
              src={`/api/recordings/${esc(row.id)}/thumb`}
              alt=""
              loading="lazy"
              decoding="async"
              onerror="this.remove()"
            />
          ) : null}
          <span class="capture-format">{esc(row.duration)}</span>
          <span class="capture-status">
            <span class={esc(row.chipClass)}>{esc(row.chipLabel)}</span>
          </span>
          {row.playable ? (
            <span class="capture-play">
              <svg class="icon" aria-hidden="true">
                <use href="#i-play" />
              </svg>
            </span>
          ) : null}
        </span>
        <span class="capture-body">
          <strong class="capture-handle">@{esc(row.handle)}</strong>
          <span class="capture-title">{esc(row.title)}</span>
          <span class="capture-meta">
            {esc(row.date)} · {esc(row.bytes)}
          </span>
        </span>
      </a>
      <div class="capture-actions">
        {row.hasFile ? (
          <a
            class="btn btn-small btn-ghost"
            href={`/api/recordings/${esc(row.id)}/download`}
            aria-label={`Download @${esc(row.handle)}`}
          >
            <svg class="icon" aria-hidden="true">
              <use href="#i-download" />
            </svg>
          </a>
        ) : null}
        <button
          class="icon-btn is-danger"
          type="button"
          aria-label={`Delete @${esc(row.handle)}`}
          hx-delete={`/recordings/${esc(row.id)}`}
          hx-confirm={esc(row.deleteConfirm)}
          hx-swap="none"
          {...(row.deletable
            ? {}
            : { disabled: true, title: esc(row.deleteTitle ?? "") })}
        >
          <svg class="icon" aria-hidden="true">
            <use href="#i-trash" />
          </svg>
        </button>
      </div>
    </article>
  );
}

export function RecordingsGrid(props: { data: RecordingsGridData }) {
  const rows = props.data.rows;
  return (
    <>
      {rows.length > 0 ? (
        <div class="capture-grid is-recordings">
          {rows.map((row) => (
            <Row {...row} />
          ))}
        </div>
      ) : (
        <Empty
          title="No recordings yet."
          hint="Captures land here once a watch user goes live with auto-record on."
        />
      )}
    </>
  );
}
