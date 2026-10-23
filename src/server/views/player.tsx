import { esc } from "../view";
import { Layout, type PageChrome } from "./layout";

export interface PlayerData {
  id: string;
  pageTitle: string;
  handle: string;
  hasFile: boolean;
  playable: boolean;
  remuxable: boolean;
  audio: boolean;
  isActive: boolean;
  state: string;
  date: string;
  duration: string;
  bytes: string;
  quality: string;
  fileName: string;
  error: string;
  deletable: boolean;
  deleteTitle: string | null;
  deleteConfirm: string;
}

export function Player(props: { chrome: PageChrome; data: PlayerData }) {
  const data = props.data;
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Archive</p>
          <h1>{esc(data.pageTitle)}</h1>
          <p class="page-sub">
            @{esc(data.handle)} · {esc(data.date)}
          </p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="/recordings">
            Back to recordings
          </a>
          {data.hasFile ? (
            <a
              class="btn btn-primary"
              href={`/api/recordings/${esc(data.id)}/download`}
            >
              Download
            </a>
          ) : null}
          <button
            class="btn btn-danger"
            type="button"
            hx-delete={`/recordings/${esc(data.id)}?redirect=/recordings`}
            hx-confirm={esc(data.deleteConfirm)}
            hx-swap="none"
            {...(data.deletable
              ? {}
              : { disabled: true, title: esc(data.deleteTitle ?? "") })}
          >
            Delete
          </button>
        </div>
      </header>

      <div class="player-shell">
        {data.playable ? (
          data.audio ? (
            <audio
              class="player-audio"
              controls={true as unknown as string}
              preload="metadata"
              src={`/api/recordings/${esc(data.id)}/file`}
            ></audio>
          ) : (
            <video
              class="player-video"
              controls
              {...{ preload: "metadata" }}
              src={`/api/recordings/${esc(data.id)}/file`}
            ></video>
          )
        ) : (
          <section class="panel">
            {data.isActive ? (
              <div class="empty">
                <strong>Still recording.</strong>
                <p>The playable file lands here when the capture finishes.</p>
              </div>
            ) : data.hasFile ? (
              <div class="empty">
                <strong>The browser cannot play this file.</strong>
                <p>Kept as {esc(data.fileName)}. Download it to play.</p>
                {data.remuxable ? (
                  <button
                    class="btn btn-primary"
                    type="button"
                    hx-post={`/recordings/${esc(data.id)}/remux`}
                  >
                    Convert to MP4
                  </button>
                ) : null}
              </div>
            ) : (
              <div class="empty">
                <strong>No file.</strong>
                <p>{esc(data.error)}</p>
              </div>
            )}
          </section>
        )}
        <dl class="meta-grid">
          <div>
            <dt>Started</dt>
            <dd>{esc(data.date)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{esc(data.duration)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{esc(data.bytes)}</dd>
          </div>
          <div>
            <dt>Quality</dt>
            <dd>{esc(data.quality)}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{esc(data.state)}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{esc(data.fileName)}</dd>
          </div>
        </dl>
      </div>
    </Layout>
  );
}
