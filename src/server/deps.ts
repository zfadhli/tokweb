import type { Engine } from '../engine'
import type { Store } from '../store'
import type { TikTokClient } from '../tiktok/client'

export interface ServerDeps {
  store: Store
  engine: Engine
  client: TikTokClient
}
