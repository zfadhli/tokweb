import { esc } from '../view'
import { Layout, type PageChrome } from './layout'
import { Empty } from './partials/empty'

export interface StatCard {
  label: string
  value: string
  note: string
  kind: 'plain' | 'hot'
}

export interface DayBar {
  label: string
  bytes: string
  /** Share of the week's peak day, so the bar chart scales with its panel. */
  pct: number
  rest: number
  hot: boolean
  zero: boolean
}

export interface CaptureCard {
  id: string
  handle: string
  initial: string
  title: string
  date: string
  duration: string
  bytes: string
  thumb: boolean
}

export interface CreatorCard {
  handle: string
  initial: string
  avatarUrl: string | null
  files: string
  bytes: string
}

export interface HomeView {
  stats: StatCard[]
  days: DayBar[]
  weekTotal: string
  captures: CaptureCard[]
  creators: CreatorCard[]
}

function Stat(props: StatCard) {
  return (
    <article class={`stat${props.kind === 'hot' ? ' is-hot' : ''}`}>
      <span class="stat-label">{esc(props.label)}</span>
      <strong class="stat-value">{esc(props.value)}</strong>
      <span class="stat-note">{esc(props.note)}</span>
    </article>
  )
}

function CreatorCardView(props: CreatorCard) {
  return (
    <article class="capture is-card">
      <a class="capture-link" href="/recordings">
        <span class="capture-art">
          <span class="capture-initial" aria-hidden="true">{esc(props.initial)}</span>
          {props.avatarUrl ? (
            <img class="capture-avatar" src={esc(props.avatarUrl)} alt="" loading="lazy" decoding="async" {...{ referrerpolicy: 'no-referrer' }} onerror="this.remove()" />
          ) : null}
          <span class="capture-format">{esc(props.files)}</span>
        </span>
        <span class="capture-body">
          <strong class="capture-handle">@{esc(props.handle)}</strong>
          <span class="capture-meta">{esc(props.bytes)}</span>
        </span>
      </a>
    </article>
  )
}

function CaptureCardView(props: CaptureCard) {
  return (
    <a class="capture" href={`/recordings/${esc(props.id)}`}>
      <span class="capture-art" aria-hidden="true">
        <span class="capture-initial">{esc(props.initial)}</span>
        {props.thumb ? (
          <img class="capture-thumb" src={`/api/recordings/${esc(props.id)}/thumb`} alt="" loading="lazy" decoding="async" onerror="this.remove()" />
        ) : null}
        <span class="capture-format">{esc(props.duration)}</span>
        <span class="capture-play"><svg class="icon" aria-hidden="true"><use href="#i-play" /></svg></span>
      </span>
      <span class="capture-body">
        <strong class="capture-handle">@{esc(props.handle)}</strong>
        <span class="capture-title">{esc(props.title)}</span>
        <span class="capture-meta">{esc(props.date)} · {esc(props.bytes)}</span>
      </span>
    </a>
  )
}

function DayBarView(props: DayBar) {
  return (
    <div class={`bar${props.hot ? ' is-today' : ''}${props.zero ? ' is-zero' : ''}`}>
      <span class="bar-track">
        <span class="bar-spacer" style={`flex-grow: ${props.rest}`}></span>
        <span class="bar-fill" style={`flex-grow: ${props.pct}`}></span>
      </span>
      <span class="bar-value">{esc(props.bytes)}</span>
      <span class="bar-label">{esc(props.label)}</span>
    </div>
  )
}

export function Home(props: { chrome: PageChrome; data: HomeView }) {
  const data = props.data
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Overview</p>
          <h1>Archive at a glance</h1>
          <p class="page-sub">What is capturing right now, what landed this week, and which creators fill the archive.</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-primary" href="/watch">Watch a creator</a>
          <a class="btn btn-ghost" href="/recordings">Open archive</a>
        </div>
      </header>

      <section class="stats" aria-label="Overview numbers">
        {data.stats.map((stat) => <Stat {...stat} />)}
      </section>

      <div class="split home-split">
        <div class="stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Creators</p>
                <h2>Top creators</h2>
              </div>
              <span class="counter">by files kept</span>
            </div>
            {data.creators.length > 0 ? (
              <div class="capture-grid is-creators">
                {data.creators.map((creator) => <CreatorCardView {...creator} />)}
              </div>
            ) : (
              <p class="empty-inline">No captures archived yet.</p>
            )}
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Archive</p>
                <h2>Latest captures</h2>
              </div>
              <a class="btn btn-ghost btn-small" href="/recordings">All recordings</a>
            </div>
            {data.captures.length > 0 ? (
              <div class="capture-grid">
                {data.captures.map((capture) => <CaptureCardView {...capture} />)}
              </div>
            ) : (
              <Empty
                title="Nothing captured yet."
                hint="Finished recordings land here with a browser-playable file and a download link."
              />
            )}
          </section>
        </div>

        <aside class="stack">
          <section class="panel is-fill">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Volume</p>
                <h2>Last 7 days</h2>
              </div>
              <span class="counter">{esc(data.weekTotal)}</span>
            </div>
            <div class="chart" role="img" aria-label="Captured bytes per day over the last seven days">
              {data.days.map((day) => <DayBarView {...day} />)}
            </div>
          </section>
        </aside>
      </div>
    </Layout>
  )
}
