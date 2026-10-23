import Handlebars from 'handlebars'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(import.meta.dir, 'views')
const compiled = new Map<string, Handlebars.TemplateDelegate>()
let partialsLoaded = false

function loadPartials(): void {
  if (partialsLoaded) return
  partialsLoaded = true
  for (const file of readdirSync(join(VIEWS, 'partials'))) {
    if (!file.endsWith('.hbs')) continue
    Handlebars.registerPartial(file.slice(0, -4), readFileSync(join(VIEWS, 'partials', file), 'utf8'))
  }
  Handlebars.registerHelper('eq', (left: unknown, right: unknown) => left === right)
}

function render(name: string, context: unknown): string {
  loadPartials()
  let template = compiled.get(name)
  if (!template) {
    template = Handlebars.compile(readFileSync(join(VIEWS, `${name}.hbs`), 'utf8'))
    compiled.set(name, template)
  }
  return template(context)
}

export interface PageChrome {
  /** Nav key this page lights up. */
  active: 'home' | 'watch' | 'recordings' | 'admin'
  title: string
  live: number
  recording: number
  bun: string
}

export function renderPage(name: string, chrome: PageChrome, data: unknown): string {
  const body = render(name, data)
  return render('layout', { ...chrome, body: new Handlebars.SafeString(body) })
}

export function renderPartial(name: string, data: unknown): string {
  return render(name, data)
}

export function html(markup: string, status = 200): Response {
  return new Response(markup, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
