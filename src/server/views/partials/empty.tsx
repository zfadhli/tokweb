import { esc } from '../../view'

export function Empty(props: { title: string; hint?: string | null }) {
  return (
    <div class="empty">
      <strong>{esc(props.title)}</strong>
      {props.hint ? <p>{esc(props.hint)}</p> : null}
    </div>
  )
}
