# Glossary

- **Monitor** – a creator (or followers owner) being watched. Has mode, quality, poll
  interval, optional segment cap, and current live/recording state.
- **Recording** – one ffmpeg capture attempt for one creator. Terminal states:
  `completed`, `failed`, `cancelled`.
- **Variant** – requested feed quality: `best`, `hd`, `sd`, `audio`.
- **Resolver** – TikTok adapter that turns username/URL/room id into a `LiveRoom` with
  signed stream URLs. Interface: `LiveResolver`.
- **Journal** – `data/state.json`, owned by one process, written atomically.
- **Reconcile** – boot step that fails interrupted recordings and adopts orphan files.
- **Remux** – container change only (`-c copy`), FLV to MP4. No quality loss.
- **Transcode** – re-encode, used only when a bitrate is configured.
- **Segment** – one recording file; `maxDurationSec` ends it and a later poll may start
  a new one.
