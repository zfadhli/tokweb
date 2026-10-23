import { Layout, type PageChrome } from "./layout";
import { Users } from "./partials/users";

export type Bucket = "offline" | "live" | "recording";

export interface WatchRow {
  id: string;
  handle: string;
  title: string;
  initial: string;
  avatarUrl: string | null;
  status: string;
  statusTitle: string;
  chipClass: string;
  dot: boolean;
  dotClass: string;
  bucket: Bucket;
  isRecording: boolean;
  autoRecord: boolean;
  confirm: string;
}

export interface WatchColumn {
  key: Bucket;
  label: string;
  count: number;
  rows: WatchRow[];
}

export interface WatchView {
  notice: string | null;
  total: number;
  columns: WatchColumn[];
}

export function Watch(props: {
  chrome: PageChrome;
  data: WatchView;
}): JSX.Element {
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Watch</p>
          <h1>Users</h1>
          <p class="page-sub">
            Creators on watch. New additions start polling on the next interval.
          </p>
        </div>
      </header>

      <div class="watch-page">
        <div
          class="panel"
          id="users-panel"
          hx-get="/partials/users"
          hx-trigger="refreshUsers from:body, every 3s"
          hx-swap="innerMorph"
          hx-target="this"
        >
          <Users {...props.data} />
        </div>
      </div>
    </Layout>
  );
}
