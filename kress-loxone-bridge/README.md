# Kress → MQTT → Loxone

A single Node.js 24 container connects a Kress Mission mower to an existing MQTT
broker. No database, Home Assistant, Node-RED, additional broker or HTTP server.

## Supported and verified

- Kress Mission cloud, device protocol `0` (wire mower); exactly one mower, or
  explicit `KRESS_SERIAL_NUMBER` selection. Other protocols fail closed.
- OAuth password grant and refresh tokens; current Kress client ID, JSON requests.
- REST `https://api.kress-robotik.com/api/v2/product-items?status=1`.
- Cloud MQTT 3.1.1 over TLS WebSockets on port 443, `/mqtt`, AWS custom authorizer.
  Endpoint and topics come exclusively from device discovery. Subscription QoS 1,
  keepalive 30 seconds, clean sessions. No guessed Worx fallback.
- The API is **unofficial and subject to change**. Kress Fleet is not supported.
- Protocol references: [ioBroker.worx](https://github.com/iobroker-community-adapters/ioBroker.worx)
  and [pyworxcloud](https://github.com/MTrab/pyworxcloud). This implementation uses
  the public protocol observations; no GPL implementation has been copied.

## Deployment

Create a private directory outside the checkout, copy `.env.example` to
`/etc/kress/secrets/runtime.env`, fill in the credentials and set mode 600. Create
`/opt/kress/state` with owner UID/GID 1000 and mode 700. Tokens are stored there
atomically with mode 600 so restarts reuse them. Do not run two processes against
one token-state directory: refresh tokens can rotate.

```sh
cd kress-loxone-bridge
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 kress-bridge
```

The Compose project contains only `kress-bridge`. It is non-root, has a read-only
root filesystem, no added capabilities, a 160 MB memory limit, 0.5 CPU limit,
80-process limit, and bounded Docker logs. `restart: unless-stopped` provides
automatic startup after a host restart. The state directory is the only persistent
application data. No ports are published or listened on by the application.

The verified VPS has a default Docker bridge but its independent nftables forward
policy blocks container-to-container traffic. Therefore this deployment uses
`network_mode: host` and `mqtt://192.168.178.204:1883`, the existing VPN-bound broker.
No firewall, broker, WireGuard or existing network changes are required. On another
host with a shared user-defined network, use that network and the actual broker DNS
name instead. Do not assume `mosquitto` resolves on Docker's default bridge.

The existing broker permits anonymous access; leave MQTT_USERNAME and MQTT_PASSWORD
empty in this deployment. If the broker requires authentication, set both variables.
The VPS network restrictions still apply. The bridge never reads its password file.

## Configuration

See `.env.example`. `config.json` is no longer used or tracked. Runtime credentials
must never be committed, included in an image, pasted into logs or configured as
GitHub build arguments. Do not run `docker compose config` in shared logs because
it expands environment secrets.

`ENABLE_COMMANDS=false` allows only status refresh and is the safe initial default. Set it to `true` to subscribe
to Loxone commands after deployment verification. The application never initiates
start/stop/home itself. Device selection is mandatory when more than one mower is
registered. `MOWER_ONLINE_TTL_SECONDS` defaults to 900.

## Status interface

Prefix defaults to `kress`. Existing status topics are preserved where their data
is actually present. Missing fields are omitted rather than replaced with zero.

| Suffix after `kress/status/` | Value / source |
|---|---|
| battery | percentage, `dat.bt.p` |
| battery_charging | 0/1, `dat.bt.c` |
| battery_voltage, battery_temp | V / °C, `dat.bt.v`, `dat.bt.t` |
| status, status_code | mapped text and original integer, `dat.ls` |
| mowing, at_home | 0/1 derived from status code |
| error, error_code | mapped text and original integer, `dat.le` |
| total_time | minutes, `dat.st.wt` |
| total_distance | metres, `dat.st.d` |
| blade_time | cumulative blade minutes, `dat.st.b` |
| total_blades | legacy alias for cumulative blade minutes |
| wifi_rssi | dBm, `dat.rsi` |
| last_update | actual observation timestamp in UTC |
| source | `cloud_mqtt` or `cloud_api_cache` |
| bridge_online | retained 0/1; MQTT last will is 0 |
| cloud_connected | non-retained 0/1; heartbeat every 10 seconds |
| mower_online | non-retained 0/1; requires cloud and fresh valid status |
| online | legacy non-retained alias for mower_online |
| availability | retained JSON `{bridge,cloud,mower,at}` heartbeat |

Measurement topics are retained snapshots, not proof of current availability.
**Loxone must gate them with bridge_online AND freshness of last_update**, and use
cloud_connected/mower_online with a heartbeat timeout (e.g. 45 seconds). The JSON
availability heartbeat also expires after 45 seconds; always gate it with the
bridge last will. This prevents old retained measurements from appearing live after
an abrupt process or network failure. Old retained cloud/mower flags are cleared on
startup. API snapshots retain their original timestamp; retained cloud packets do
not refresh mower availability. The mower can be offline while the container is
healthy. Unknown status/error codes are published as `unknown_<number>`.

`blade_time` fixes the old incorrect "remaining blade life" interpretation. It is
cumulative usage, not a remaining-life estimate. Missing values are not fabricated.

## Commands

| Topic | Payload | Action |
|---|---|---|
| kress/cmd/start | `1`, `true` or `ON` | start, code 1 |
| kress/cmd/stop | same | pause, code 2 |
| kress/cmd/home | same | return home, code 3 |
| kress/cmd/refresh | same | status request only, code 0 |

Retained, MQTT DUP, unknown, oversized, false/zero and offline commands are rejected.
There is a 1.5-second global limit, 10-second per-motion-command deduplication and
60-second minimum between manual refreshes. Commands use QoS 0 and no offline
queue: losing a command is preferable to replaying mower movement after reconnect.
There is no automatic command retry and no guarantee of physical execution just
because publishing succeeded. Motion commands are covered by mocks, not live tests.

## Diagnostics and tests

```sh
npm ci
npm run lint
npm test
docker build --target test -t kressone:test .
# Stop the bridge before using its token state in a diagnostic process.
docker compose stop kress-bridge
docker compose run --rm --no-deps kress-bridge node diagnose.js
docker compose up -d
```

Diagnostics print PASS/FAIL/SKIPPED for DNS, TLS, token acquisition/reuse, discovery,
cloud connection/subscription, fresh MQTT payload, local broker, publish and echo.
They use a unique non-retained diagnostics topic and a single cloud `cmd:0` request.
No physical mower command is issued. API cached status and fresh MQTT status are
reported separately. Tests are bounded; missing data does not count as success.
Never run the diagnostic with shared state while the production instance is active.

## Failure handling and maintenance

Tokens renew 120 seconds before actual expiry, with a single in-flight refresh.
A revoked refresh token permits one password fallback. Permanent 4xx authentication
errors are latched in `/state/auth-blocked.json`; the container stays alive but
unhealthy, without restart/login loops. After correcting credentials, the latch
is ignored if their fingerprint changed. To retry with unchanged credentials after
a confirmed server-side resolution, stop the bridge and remove that latch manually.
Transient outages use exponential backoff with jitter, capped at 15 minutes.

Healthcheck: local MQTT and cloud MQTT connected, no permanent auth failure, recent
maintenance heartbeat. Health is independent of the mower being awake. `SIGHUP`
reconnects this bridge's two connections without sending physical commands:

```sh
docker kill --signal HUP kress-bridge
```

SIGTERM/SIGINT publish offline availability, close connections and stop timers.
Unexpected termination uses the local broker's last will.

## Update and rollback

Use a reviewed commit on `fix/kress-cloud-bridge` (or main after merging). Before an
update, record the running image ID and tag it `kressone:previous`, stop only the
bridge, and privately back up the environment and state. Build and test the new
image; start only this Compose service. GitHub Actions lint, test, audit, scan the
checkout for secrets and build AMD64/ARM64 images; they never deploy automatically.
No new remote deployment credentials or public SSH access are introduced.

```sh
docker tag "$(docker inspect --format '{{.Image}}' kress-bridge)" kressone:previous
docker compose stop kress-bridge
# Securely back up /etc/kress/secrets/runtime.env and /opt/kress/state here.
docker compose up -d --build --no-deps kress-bridge
# Roll back code if needed; retain the newest tokens because refresh tokens rotate.
KRESS_IMAGE=kressone:previous docker compose up -d --no-build --no-deps kress-bridge
```

For the first installation there is no previous functioning bridge. Rollback is
`docker compose stop kress-bridge`; keep configuration and state for investigation.
No other container is stopped or removed. A host reboot was not performed because
other productive services run on the VPS; container restart is tested separately.

## License

MIT, consistent with the original repository. Protocol references remain subject
to their respective licenses. No Home Assistant or ioBroker runtime is required.

## Version 2.1: party mode, schedules, feedback and maintenance

Protocol 0 party mode uses a minimal `sc` write: on `{m:2,distm:0}`, off
`{m:1,distm:0}`. This protocol is also used by
[ioBroker.worx](https://github.com/iobroker-community-adapters/ioBroker.worx/blob/master/main.js)
(`sendPartyModus`). No cached day/slot data is sent back to the mower. Enabling
party mode pauses the automatic schedule; it is not a stop or home command.
Disabling it resumes normal scheduling, which can cause scheduled mowing.
No automatic midnight reset is implemented by this bridge.

All command topics below accept a **non-retained pulse** `1`, `true` or `ON`.
A `0` payload is ignored, not interpreted as party-off. They require
`ENABLE_COMMANDS=true`, connected Cloud MQTT and fresh mower telemetry. Party
writes additionally require fresh protocol-0 `m`/`distm` fields. Unsupported or
stale data never results in a guessed write. `refresh` remains usable when
telemetry is stale. The existing command rate limits apply to aliases together.

| Topic | Action |
|---|---|
| `kress/cmd/party_on` | Pause automatic mowing indefinitely |
| `kress/cmd/party_off` | Resume the existing schedule |
| `kress/cmd/schedule_pause` | Alias of party_on |
| `kress/cmd/schedule_resume` | Alias of party_off |
| `kress/cmd/blade_reset` | Record current total blade minutes as the local replacement baseline |

`blade_reset` changes only `/state/maintenance.json`, atomically and mode 600.
It does not reset manufacturer statistics, move the mower or change its schedule.
The baseline is bound to the selected mower. No replacement date is guessed on
first installation: `blade_counter_initialized=0` and elapsed fields are empty
until an explicit reset. A device counter lower than the baseline invalidates the
elapsed value and requires a new baseline. There is no invented manufacturer
replacement interval. Back up maintenance.json together with state; do not reset
it during upgrades.

All new status topics use `kress/status/`:

| Suffix | Meaning |
|---|---|
| `party_mode`, `schedule_paused` | Reported pause/party state, 0/1; includes timed pauses |
| `schedule_mode`, `party_remaining_minutes` | Raw protocol-0 m and distm |
| `schedule_enabled` | Reported scheduling enabled, 0/1 |
| `party_supported` | Whether compatible m/distm fields have been observed; freshness is separate |
| `features_updated_at`, `features_fresh` | Timestamp and freshness of mode/timer fields |
| `schedule`, `schedule_text` | JSON and text weekly schedule, Sunday first, both daily slots preserved |
| `schedule_updated_at`, `schedule_fresh` | Separate freshness for weekly slot data |
| `blade_counter_initialized` | 1 only for a valid replacement baseline and counter |
| `blade_since_change_minutes`, `blade_since_change_hours`, `blade_changed_at` | Local maintenance values |
| `command_result` | Last command outcome JSON with name, ID where applicable, state and timestamp |
| `command_pending`, `command_failed` | Pending confirmation / last dispatched cloud command failed |
| `data_stale`, `telemetry_age_seconds` | Missing or expired mower telemetry / seconds since last data (-1 unknown) |
| `alert_active`, `alert_code`, `alert_text`, `alert_changed_at` | Current alert for Loxone notification logic |
| `summary_code` | Numeric combined state for a Loxone status monitor |

Configuration-only replies never refresh mower telemetry. Missing optional fields
are not converted to zero. Retained values can remain historical: gate all values
with `bridge_online`, heartbeat age (<45 seconds), `mower_online`, and the relevant
feature/schedule freshness. Freshness/pending/failure/alert flags are non-retained
10-second heartbeats. Loxone must also detect a missing heartbeat and the retained
bridge LWT: the bridge cannot send an alert after losing power or the broker.

`command_result.state`: `sent` means published, `acknowledged` means a matching
request ID was received, and `confirmed` requires correlated receipt plus the
requested reported state within 60 seconds. This is software readback, not a
mechanical observation. Other outcomes are `rejected` (reason included), `failed`,
`timeout`, `unknown` (bridge restarted), and `local_completed` (maintenance reset).
Results are also emitted non-retained on `kress/event/command`. One cloud command
may await confirmation at a time; explicit stop/home can supersede it. No timeout
or reconnect retries a command. A mower which does not echo IDs may execute a
request but still produce a confirmation timeout; no false success is invented.

Alerts prioritize authentication failure, Cloud MQTT disconnected for 60 seconds,
stale telemetry, command failure and current mower errors. Historical errors do
not become current alarms. `kress/event/alert` emits non-retained transitions
(including recovery and initial state); notifications to people must be wired in
Loxone and are not sent automatically by this container. `command_failed` clears
when a new cloud command is dispatched. Invalid/retained/duplicate/oversized
messages are ignored; valid pulses rejected as offline, stale or busy get a result.

`summary_code` mapping: 1 idle, 2 docked, 3 starting/leaving, 4 mowing, 5 returning,
6 navigating, 7 edge cutting, 8 lifted, 9 blocked, 10 diagnostic/remote control;
90 stale/no data, 91 Cloud MQTT disconnected, 92 current mower error,
93 command unconfirmed/failed, 94 authentication blocked, 99 unknown mower status.
This is **not** the manufacturer's `status_code`. In particular idle is **1** here.

Weekly schedule editing is deliberately not exposed: the requested display and
pause/resume preserve all existing slots. Actual mower writes and maintenance
reset were tested with mocks; no physical live command was sent during the
November upgrade because the mower had no fresh telemetry.


### Native Loxone MQTT subscription budget and heartbeat

`kress/status/loxone_snapshot` is a non-retained numeric JSON snapshot emitted on
every 10-second heartbeat. Its `heartbeat` is Unix seconds and changes even when
all mower values are unchanged. Feed that changing value to the Loxone watchdog;
repeated identical `1` values are not a reliable change-triggered watchdog input.
Fields: heartbeat, bridge, cloud, mower, summary, battery, temperature, party,
features_fresh, schedule_fresh, blade_hours, blade_initialized, pending, failed,
alert. Unknown or stale measurement values are -1. A fresh `bridge_online` LWT 0
must still override the last snapshot immediately.

Use one snapshot subscription with native command recognition for numeric fields,
plus individual subscriptions for bridge_online, schedule_text, command_text and
alert_text. This uses five subscriptions and fits the native MQTT plugin's
[16-subscription limit](https://www.loxone.com/enen/kb/mqtt/). `command_text` is a
human-readable German summary; the existing command_result JSON remains available
for detailed diagnostics. No home configuration or credentials are in this repo.
