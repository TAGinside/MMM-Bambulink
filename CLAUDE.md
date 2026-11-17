# CLAUDE.md — MMM-Bambulink

MagicMirror² module showing the status of Bambu Lab printers over local MQTT (TLS, port 8883).

## Language rules

- **Always reply to the user in French.**
- Repository content meant for the public (README, package.json) is written in **English**.
- Code comments and commit messages are written in **French** (existing convention).

## Files

- `MMM-Bambulink.js` — front-end (DOM, tiles / temperature graph, AMS display). Receives `BAMBULINK_STATUS` and `BAMBULINK_CONNECTION`; replaces `this.printerStatus` with each status payload.
- `node_helper.js` — back-end: one MQTT connection per module instance.
- `css/MMM-Bambulink.css`, `config example/config_example.js`, `thumbnails/`.
- `test/incremental.test.js` — isolated test (mocks `node_helper` and `mqtt`), run with `npm test`.

## node_helper.js architecture

- One shared helper for all module instances: state lives in `this.sessions[identifier]` (one session per printer). Every socket notification carries `identifier`.
- `openSession` (on `BAMBULINK_CONFIG`) closes any previous session for the same identifier and starts fresh, including an empty `printCache`.
- `pushall` requests: at connection and every `pushallInterval` (default 5 min, minimum 1 min, `0` disables). Paused on `BAMBULINK_SUSPEND`, resumed on `BAMBULINK_RESUME`.
- Watchdog: no message for `offlineTimeout` (default 60 s) → state `offline` and reconnection.
- **Incremental reports** (P1 / A1…): each `json.print` is deep-merged into `session.printCache` (`mergeDeep` / `mergeArrayById`), then `extractStatus({ print: printCache })` is called. Arrays whose items all have an `id` (`ams.ams`, `tray`) are merged by id; other arrays replace the old value; a tray reduced to `{id}` means an emptied slot and replaces the cached tray.
- AMS: `extractAmsUnits` handles every AMS (ids 0–3, AMS HT ≥ 128), slot labels A1…D4 / HT1, `tray_now` 254 = external spool, 255 = none.
- Every entry point is wrapped in try/catch: an uncaught exception would crash the whole MagicMirror server.

## Checks before committing

```bash
node --check node_helper.js && node --check MMM-Bambulink.js && npm test
```

No real printer is available in the cloud environment: test with mocks only.
