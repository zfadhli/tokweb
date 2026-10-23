import { esc } from "../../view";
import { Empty } from "./empty";
import type { WatchColumn, WatchRow, WatchView } from "../watch";

function Row(props: WatchRow) {
  return (
    <article class="watch-card">
      <div class="watch-card-head">
        <span class="user-cell">
          <span class="avatar" aria-hidden="true">
            {props.avatarUrl ? (
              <img src={esc(props.avatarUrl)} alt="" />
            ) : (
              esc(props.initial)
            )}
          </span>
          <span class="cell-main">
            <strong>@{esc(props.handle)}</strong>
            <span>{esc(props.title)}</span>
          </span>
        </span>
        <span class={esc(props.chipClass)}>
          {props.dot ? (
            <span
              class={`status-dot ${esc(props.dotClass)}`}
              aria-hidden="true"
            ></span>
          ) : null}
          {esc(props.status)}
        </span>
      </div>
      <div class="watch-card-foot">
        <label class="check">
          <input
            type="checkbox"
            name="autoRecord"
            checked={props.autoRecord ? true : undefined}
            aria-label={`Auto-record @${esc(props.handle)}`}
            hx-patch={`/watch/${esc(props.id)}`}
            hx-trigger="change"
            hx-include="this"
            hx-swap="none"
          />
          <span class="check-box" aria-hidden="true"></span>Auto
        </label>
        <span class="row-actions">
          <button
            class="btn btn-small btn-ghost"
            type="button"
            hx-post={`/watch/${esc(props.id)}/check`}
            hx-swap="none"
          >
            Check
          </button>
          {props.isRecording ? (
            <button
              class="btn btn-small"
              type="button"
              hx-post={`/watch/${esc(props.id)}/stop`}
              hx-swap="none"
            >
              Stop
            </button>
          ) : (
            <button
              class="btn btn-small"
              type="button"
              hx-post={`/watch/${esc(props.id)}/record`}
              hx-swap="none"
            >
              Record
            </button>
          )}
          <button
            class="icon-btn is-danger"
            type="button"
            aria-label={`Remove @${esc(props.handle)}`}
            hx-delete={`/watch/${esc(props.id)}`}
            hx-confirm={esc(props.confirm)}
            hx-swap="none"
          >
            <svg class="icon" aria-hidden="true">
              <use href="#i-trash" />
            </svg>
          </button>
        </span>
      </div>
    </article>
  );
}

function Column(props: Omit<WatchColumn, "key">) {
  return (
    <section class="watch-column">
      <header class="watch-column-head">
        <h2>{esc(props.label)}</h2>
        <span class="count">{props.count}</span>
      </header>
      {props.rows.length > 0 ? (
        <>
          {props.rows.map((row) => (
            <Row {...row} />
          ))}
        </>
      ) : (
        <p class="watch-column-empty">None</p>
      )}
    </section>
  );
}

export function Users(props: WatchView): JSX.Element {
  return (
    <>
      {props.notice ? <p class="notice is-error">{esc(props.notice)}</p> : null}
      <div class="watch-tools">
        <form
          class="add-form"
          hx-post="/watch"
          hx-target="#users-panel"
          hx-swap="outerHTML"
          {...{ "hx-disable": "find button" }}
        >
          <div class="field">
            <label for="watch-target">Username, live URL, or room id</label>
            <div class="add-row">
              <input
                class="input"
                id="watch-target"
                name="target"
                type="text"
                autocomplete="off"
                placeholder="@creator or https://tiktok.com/@creator/live"
              />
              <button class="btn btn-primary" type="submit">
                Add user
              </button>
            </div>
          </div>
        </form>
      </div>
      {props.total > 0 ? (
        <div class="watch-grid">
          {props.columns.map((column) => (
            <Column
              label={column.label}
              count={column.count}
              rows={column.rows}
            />
          ))}
        </div>
      ) : (
        <Empty
          title="No users on watch."
          hint="Add a creator above. Polling starts on the next interval."
        />
      )}
    </>
  );
}
