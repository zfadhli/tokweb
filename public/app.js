/* tokweb dashboard: one snapshot in, one render out. No framework. */

const state = {
  snapshot: null,
  settingsOpen: false,
}

const $ = (selector, root = document) => root.querySelector(selector)

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

function fmtDate(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initials(name) {
  const clean = String(name ?? '').replace(/[^a-z0-9]/gi, '')
  return (clean.slice(0, 2) || '?').toUpperCase()
}

function baseName(file) {
  return String(file ?? '').split(/[\\/]/).pop() || 'recording.mp4'
}

function recordingLabel(recording) {
  return recording.file ? baseName(recording.file) : `${recording.uniqueId}_${recording.roomId ?? 'room'}.mp4`
}

function elapsed(recording) {
  if (recording.endedAt) return recording.durationMs
  return Math.max(recording.durationMs, Date.now() - recording.startedAt)
}

function toast(message, level = 'info') {
  const node = h('div', { class: `toast ${level}`, text: message })
  $('#toasts').append(node)
  setTimeout(() => node.remove(), 4200)
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.error ? body.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body
}

function setLink(mode) {
  const node = $('#link-state')
  node.classList.toggle('is-live', mode === 'live')
  node.classList.toggle('is-down', mode === 'down')
  node.querySelector('span').textContent = mode === 'live' ? 'connected' : mode === 'down' ? 'reconnecting' : 'connecting'
}

function renderStats() {
  const snapshot = state.snapshot
  const monitors = snapshot.monitors
  const recordings = snapshot.recordings
  const active = snapshot.system.activeRecordings
  const live = monitors.filter((monitor) => monitor.live).length
  const completed = recordings.filter((recording) => recording.state === 'completed')
  const bytes = completed.reduce((sum, recording) => sum + (recording.bytes || 0), 0)
  const duration = completed.reduce((sum, recording) => sum + (recording.durationMs || 0), 0)

  $('#stat-active').textContent = String(active)
  $('#stat-active-note').textContent = active > 0 ? `${active} ffmpeg process${active === 1 ? '' : 'es'}` : 'idle'
  $('#stat-monitors').textContent = String(monitors.length)
  $('#stat-live').textContent = `${live} live`
  $('#stat-total').textContent = fmtBytes(bytes)
  $('#stat-count').textContent = `${completed.length} file${completed.length === 1 ? '' : 's'} · ${fmtDuration(duration)}`
  $('#stat-output').textContent = snapshot.system.outputDir
  $('#stat-output').title = snapshot.system.outputDir
  $('#stat-ffmpeg').textContent = snapshot.system.ffmpegPath
  $('#monitor-count').textContent = String(monitors.length)
  $('#recording-count').textContent = String(recordings.length)
  $('#foot-version').textContent = `bun ${snapshot.system.bun}`
  document.title = active > 0 ? `(${active}) tokweb — capturing` : 'tokweb — live capture console'
}

function statusOf(monitor) {
  if (monitor.state === 'recording') return { label: 'recording', className: 'recording' }
  if (monitor.state === 'error') return { label: 'error', className: 'error' }
  if (monitor.state === 'checking') return { label: 'checking', className: '' }
  if (monitor.live) return { label: 'live', className: 'live' }
  if (monitor.state === 'waiting') return { label: 'standby', className: '' }
  return { label: 'idle', className: '' }
}

function monitorCard(monitor) {
  const status = statusOf(monitor)
  const recording = monitor.recordingId || monitor.state === 'recording'
  const avatar = h(
    'div',
    { class: 'avatar' },
    monitor.avatarUrl
      ? h('img', { src: monitor.avatarUrl, alt: '', loading: 'lazy' })
      : initials(monitor.uniqueId ?? monitor.roomId),
  )

  const meta = h(
    'div',
    { class: 'monitor-meta' },
    h('span', { class: 'chip', text: monitor.variant }),
    monitor.live && monitor.viewers ? h('span', { class: 'chip', text: `${monitor.viewers} watching` }) : null,
    monitor.maxDurationSec ? h('span', { class: 'chip', text: `max ${Math.round(monitor.maxDurationSec / 60)}m` }) : null,
    h('span', { class: 'chip', text: `poll ${Math.round(monitor.intervalSec / 60)}m` }),
  )

  const variant = h(
    'select',
    { class: 'mini-select', 'data-action': 'variant', 'data-id': monitor.id, 'aria-label': 'Quality' },
    ...['best', 'hd', 'sd', 'audio'].map((value) =>
      h('option', { value, selected: monitor.variant === value, text: value }),
    ),
  )

  const auto = h(
    'label',
    { class: 'auto-toggle', title: 'Auto-record when live' },
    h('input', {
      type: 'checkbox',
      checked: monitor.autoRecord,
      'data-action': 'auto',
      'data-id': monitor.id,
    }),
    'auto',
  )

  const actions = h(
    'div',
    { class: 'monitor-actions' },
    h('button', { class: 'btn btn-mini', type: 'button', 'data-action': 'check', 'data-id': monitor.id, text: 'Check' }),
    recording
      ? h('button', {
          class: 'btn btn-mini btn-danger',
          type: 'button',
          'data-action': 'stop',
          'data-id': monitor.id,
          text: 'Stop',
        })
      : h('button', {
          class: 'btn btn-mini',
          type: 'button',
          'data-action': 'record',
          'data-id': monitor.id,
          text: 'Record',
        }),
    variant,
    auto,
    h('button', {
      class: 'icon-btn',
      type: 'button',
      'data-action': 'delete-monitor',
      'data-id': monitor.id,
      'aria-label': `Remove ${monitor.uniqueId ?? monitor.roomId}`,
      text: '✕',
    }),
  )

  const card = h(
    'article',
    {
      class: `monitor${monitor.live ? ' is-live' : ''}${recording ? ' is-recording' : ''}${
        monitor.state === 'error' ? ' is-error' : ''
      }`,
      'data-monitor': monitor.id,
    },
    avatar,
    h(
      'div',
      { class: 'monitor-main' },
      h(
        'div',
        { class: 'monitor-line' },
        h('strong', { class: 'monitor-name', text: `@${monitor.uniqueId ?? monitor.roomId}` }),
        h('span', { class: `status ${status.className}`, text: status.label }),
        monitor.recordingId
          ? h('span', { class: 'chip', text: `${fmtBytes(monitor.bytes || 0)}` })
          : null,
      ),
      h('div', {
        class: `monitor-title${monitor.state === 'error' ? ' is-error' : ''}`,
        text: monitor.lastError ? monitor.lastError : monitor.title || 'No title yet',
      }),
      meta,
    ),
    actions,
  )
  return card
}

const COLUMNS = ['offline', 'live', 'recording']

const COLUMN_EMPTY = {
  offline: 'Nobody on standby.',
  live: 'Nobody live right now.',
  recording: 'Not capturing.',
}

function columnOf(monitor) {
  if (monitor.recordingId || monitor.state === 'recording') return 'recording'
  if (monitor.live) return 'live'
  return 'offline'
}

function renderMonitors() {
  const focused = document.activeElement
  if (focused && focused.closest && focused.closest('.monitor') && focused.tagName === 'SELECT') return
  const buckets = { offline: [], live: [], recording: [] }
  for (const monitor of state.snapshot.monitors) buckets[columnOf(monitor)].push(monitor)
  for (const column of COLUMNS) {
    const list = $(`#list-${column}`)
    list.replaceChildren()
    const monitors = buckets[column]
    $(`#count-${column}`).textContent = String(monitors.length)
    if (monitors.length === 0) list.append(h('p', { class: 'col-empty', text: COLUMN_EMPTY[column] }))
    for (const monitor of monitors) list.append(monitorCard(monitor))
  }
}

function recordingRow(recording) {
  const active = recording.state === 'recording' || recording.state === 'starting' || recording.state === 'finalizing'
  const duration = elapsed(recording)
  const playable = Boolean(recording.fileUrl)

  const thumb = playable
    ? h('button', {
        class: 'thumb',
        type: 'button',
        'data-action': 'play',
        'data-id': recording.id,
        'aria-label': `Play ${recording.uniqueId}`,
        text: '▶',
      })
    : h('div', {
        class: `thumb${active ? ' is-active' : ''}`,
        'aria-hidden': 'true',
        text: active ? '●' : '—',
      })

  const actions = h(
    'div',
    { class: 'recording-actions' },
    playable
      ? h('button', {
          class: 'btn btn-mini',
          type: 'button',
          'data-action': 'play',
          'data-id': recording.id,
          text: 'Play',
        })
      : null,
    playable
      ? h('a', {
          class: 'btn btn-mini',
          href: recording.downloadUrl,
          download: baseName(recording.file),
          text: 'Save',
        })
      : h('span', { class: 'recording-note', text: active ? 'capturing' : 'no file' }),
    h('button', {
      class: 'icon-btn',
      type: 'button',
      'data-action': 'delete-recording',
      'data-id': recording.id,
      'aria-label': 'Delete recording',
      disabled: active,
      text: '✕',
    }),
  )

  return h(
    'article',
    { class: 'recording', 'data-recording': recording.id },
    thumb,
    h(
      'div',
      { class: 'recording-main' },
      h('div', { class: 'recording-name', text: active ? `@${recording.uniqueId} — capturing…` : recordingLabel(recording) }),
      h(
        'div',
        { class: 'recording-sub' },
        h('span', { text: `@${recording.uniqueId}` }),
        h('span', { text: fmtDate(recording.startedAt) }),
        h('span', { text: fmtBytes(recording.bytes) }),
        h('span', { text: recording.variant }),
        h('span', { class: `state ${recording.state}`, text: recording.state }),
      ),
    ),
    h(
      'div',
      { class: 'recording-duration' },
      fmtDuration(duration),
      h('small', { text: active ? 'in progress' : recording.state === 'completed' ? 'captured' : recording.state }),
    ),
    actions,
  )
}

function renderLibrary() {
  const library = $('#library')
  library.replaceChildren()
  const recordings = state.snapshot.recordings
  if (recordings.length === 0) {
    library.append(
      h(
        'div',
        { class: 'empty' },
        h('strong', { text: 'Nothing captured yet.' }),
        'Finished recordings land here with a browser-playable MP4 and a download link.',
      ),
    )
    return
  }
  for (const recording of recordings) library.append(recordingRow(recording))
}

function render() {
  if (!state.snapshot) return
  renderStats()
  renderMonitors()
  renderLibrary()
}

async function load() {
  state.snapshot = await api('/api/state')
  render()
}

function openSettings() {
  state.settingsOpen = true
  fillSettings()
  const dialog = $('#settings-dialog')
  if (!dialog.open) dialog.showModal()
}

function fillSettings() {
  const settings = state.snapshot.settings
  $('#set-output').value = settings.outputDir ?? ''
  $('#set-ffmpeg').value = settings.ffmpegPath ?? ''
  $('#set-variant').value = settings.defaultVariant ?? 'best'
  $('#set-interval').value = Math.max(1, Math.round((settings.defaultIntervalSec ?? 180) / 60))
  $('#set-duration').value = settings.defaultMaxDurationSec
    ? Math.max(1, Math.round(settings.defaultMaxDurationSec / 60))
    : ''
  $('#set-bitrate').value = settings.bitrate ?? ''
  $('#set-proxy').value = settings.proxy ?? ''
  $('#set-ua').value = settings.userAgent ?? ''
  $('#set-keep-source').checked = Boolean(settings.keepSource)
  $('#set-cookies').value = ''
  $('#set-clear-cookies').checked = false
  $('#cookie-note').textContent = settings.hasCookies ? 'saved' : 'not set'
}

function openPlayer(id) {
  const recording = state.snapshot.recordings.find((item) => item.id === id)
  if (!recording?.fileUrl) return
  $('#player-user').textContent = `@${recording.uniqueId} · ${recording.variant}`
  $('#player-title').textContent = recording.title || recordingLabel(recording)
  $('#player-meta').textContent = `${fmtDuration(recording.durationMs)} · ${fmtBytes(recording.bytes)} · ${fmtDate(
    recording.startedAt,
  )}`
  const video = $('#player-video')
  video.src = recording.fileUrl
  const download = $('#player-download')
  download.href = recording.downloadUrl
  download.download = baseName(recording.file)
  const dialog = $('#player-dialog')
  if (!dialog.open) dialog.showModal()
}

function closePlayer() {
  const dialog = $('#player-dialog')
  const video = $('#player-video')
  video.pause()
  video.removeAttribute('src')
  video.load()
  if (dialog.open) dialog.close()
}

function targetPayload(value) {
  const target = value.trim()
  if (!target) throw new Error('Enter a username, live URL, or room id.')
  if (/^https?:\/\//i.test(target) || /tiktok\.com\//i.test(target)) return { url: target }
  if (/^\d{6,}$/.test(target)) return { roomId: target }
  return { uniqueId: target }
}

async function addMonitor(event) {
  event.preventDefault()
  const payload = targetPayload($('#add-target').value)
  try {
    await api('/api/monitors', { method: 'POST', body: JSON.stringify(payload) })
    $('#add-target').value = ''
    toast(`Added ${payload.uniqueId ?? payload.roomId ?? payload.url} to the watchlist.`)
    await load()
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function saveSettings(event) {
  event.preventDefault()
  const payload = {
    outputDir: $('#set-output').value.trim(),
    ffmpegPath: $('#set-ffmpeg').value.trim(),
    defaultVariant: $('#set-variant').value,
    defaultIntervalSec: Math.max(10, Math.round((Number($('#set-interval').value) || 3) * 60)),
    defaultMaxDurationSec: Math.max(0, Math.round((Number($('#set-duration').value) || 0) * 60)),
    bitrate: $('#set-bitrate').value.trim(),
    proxy: $('#set-proxy').value.trim(),
    userAgent: $('#set-ua').value.trim(),
    keepSource: $('#set-keep-source').checked,
  }
  const cookies = $('#set-cookies').value.trim()
  if (cookies) payload.cookies = cookies
  if ($('#set-clear-cookies').checked) payload.cookies = ''
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
    state.settingsOpen = false
    $('#settings-dialog').close()
    toast('Settings saved.')
    await load()
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function monitorAction(action, id) {
  if (!id) return
  if (action === 'check') {
    toast('Checking room…')
    await api(`/api/monitors/${id}/check`, { method: 'POST' })
    toast('Room checked.')
  }
  if (action === 'record') {
    await api(`/api/monitors/${id}/record`, { method: 'POST' })
    toast('Recording started.')
  }
  if (action === 'stop') {
    await api(`/api/monitors/${id}/stop`, { method: 'POST' })
    toast('Recording stopped. Finalizing…')
  }
  if (action === 'delete-monitor') {
    if (!confirm('Remove this creator and stop any active recording?')) return
    await api(`/api/monitors/${id}`, { method: 'DELETE' })
    toast('Removed from watchlist.')
  }
  await load()
}

async function recordingAction(action, id) {
  if (!id) return
  if (action === 'play') {
    openPlayer(id)
    return
  }
  if (action === 'delete-recording') {
    if (!confirm('Delete this recording and its file? This cannot be undone.')) return
    await api(`/api/recordings/${id}`, { method: 'DELETE' })
    toast('Recording deleted.')
    await load()
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const action = target.dataset.action
  const id = target.dataset.id
  try {
    if (action === 'open-settings') return openSettings()
    if (action === 'close-settings') {
      state.settingsOpen = false
      $('#settings-dialog').close()
      return
    }
    if (action === 'close-player') return closePlayer()
    if (action === 'refresh') {
      await load()
      toast('State refreshed.')
      return
    }
    if (['check', 'record', 'stop', 'delete-monitor'].includes(action)) return await monitorAction(action, id)
    if (['play', 'delete-recording'].includes(action)) return await recordingAction(action, id)
  } catch (error) {
    toast(error.message, 'error')
  }
})

document.addEventListener('change', async (event) => {
  const target = event.target
  if (!target.matches('[data-action]')) return
  const action = target.dataset.action
  const id = target.dataset.id
  if (!id) return
  try {
    if (action === 'auto') {
      await api(`/api/monitors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ autoRecord: target.checked }),
      })
      toast(target.checked ? 'Auto-record enabled.' : 'Auto-record paused.')
      await load()
    }
    if (action === 'variant') {
      await api(`/api/monitors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ variant: target.value }),
      })
      toast(`Quality set to ${target.value}.`)
      await load()
    }
  } catch (error) {
    toast(error.message, 'error')
  }
})

$('#add-form').addEventListener('submit', addMonitor)
$('#settings-form').addEventListener('submit', saveSettings)
$('#settings-dialog').addEventListener('close', () => {
  state.settingsOpen = false
})
$('#player-dialog').addEventListener('close', closePlayer)

function connect() {
  if (!window.EventSource) {
    setInterval(() => load().catch(() => setLink('down')), 4_000)
    return
  }
  const source = new EventSource('/api/events')
  source.addEventListener('snapshot', (event) => {
    try {
      state.snapshot = JSON.parse(event.data)
      render()
      setLink('live')
    } catch {
      setLink('down')
    }
  })
  source.onopen = () => setLink('live')
  source.onerror = () => setLink('down')
}

load()
  .then(() => setLink('live'))
  .catch((error) => {
    setLink('down')
    toast(error.message, 'error')
  })
connect()
