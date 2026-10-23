import { Layout, type PageChrome } from "./layout";

export function NotFound(props: { chrome: PageChrome }) {
  return (
    <Layout {...props.chrome}>
      <header class="page-head">
        <div>
          <p class="eyebrow">Archive</p>
          <h1>Not found</h1>
          <p class="page-sub">That recording does not exist.</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="/recordings">
            Back to recordings
          </a>
        </div>
      </header>

      <section class="panel">
        <div class="empty">
          <strong>Nothing at this address.</strong>
          <p>
            Check the archive. Recordings are deleted for good once their file
            is gone.
          </p>
        </div>
      </section>
    </Layout>
  );
}
