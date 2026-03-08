# Kress ↔ Loxone MQTT Bridge

Verbindet einen Kress Mähroboter (z.B. KR121E) über die Kress Cloud mit einem lokalen
MQTT-Broker, den Loxone direkt ansprechen kann.

Basiert auf dem originalen [mqtt-landroid-bridge](https://github.com/nefiertsrebliS/mqtt-landroid-bridge)
(MIT-Lizenz), neu geschrieben für Loxone.

---

## Architektur

```
Kress KR121E
     │  (WLAN → Kress Cloud)
     ▼
Kress Cloud MQTT (AWS)
     │
 [kress-bridge]
     │  (lokales Netzwerk)
     ▼
Mosquitto auf dem Pi  ←──────── Loxone Miniserver
  Port 1883                     (MQTT Client)
```

Die Bridge läuft direkt auf deinem Raspberry Pi – entweder nativ oder als Docker-Container.
Der Mosquitto-Broker läuft **separat** auf dem Pi (nicht als Teil dieses Projekts).

---

## Voraussetzungen

- Raspberry Pi mit laufendem Mosquitto MQTT-Broker (Port 1883)
- Kress App-Zugangsdaten (E-Mail + Passwort)
- Loxone Miniserver mit aktiviertem MQTT-Client

---

## Setup

### 1. Repository klonen

```bash
git clone https://github.com/DEIN-USER/kress-loxone-bridge.git
cd kress-loxone-bridge
```

### 2. config.json anpassen

```bash
nano config.json
```

Folgende Werte eintragen:

| Feld | Beschreibung |
|------|-------------|
| `cloud.email` | E-Mail der Kress App |
| `cloud.pwd` | Passwort der Kress App |
| `mqtt.url` | URL deines lokalen MQTT-Brokers (siehe unten) |
| `mower[0].topic` | MQTT-Topic-Prefix (Standard: `kress`) |
| `logLevel` | `debug` zum Einrichten, danach `info` |

### Wie lautet die mqtt.url?

Das hängt davon ab, wie du die Bridge startest:

**Option A – Docker mit `network_mode: host` (Standard in docker-compose.yml)**

```json
"url": "mqtt://localhost:1883"
```

Mit `network_mode: host` sieht der Container das Netzwerk des Pi direkt.
`localhost` zeigt also auf den Pi selbst – und damit auf deinen Mosquitto.

**Option B – Nativ auf dem Pi (ohne Docker)**

```json
"url": "mqtt://localhost:1883"
```

Gleiche Adresse, da die Bridge direkt auf dem Pi läuft.

**Option C – Docker ohne `network_mode: host`**

```json
"url": "mqtt://192.168.1.42:1883"
```

Hier musst du die feste IP des Pi eintragen. IP herausfinden:

```bash
hostname -I
# Ausgabe z.B.: 192.168.1.42
```

> **Tipp:** Die Seriennummer deines Mähers brauchst du **nicht** einzutragen –
> sie wird automatisch über die Cloud-API ermittelt. Das Feld `mower[0].sn` ist
> nur zur Dokumentation. Beim ersten Start mit `"logLevel": "debug"` siehst du
> alle erkannten Geräte im Log.

---

### 3. Starten (Docker)

```bash
docker compose up -d
```

### 4. Starten (nativ, ohne Docker)

```bash
npm install
node bridge.js
```

### 5. Logs prüfen

```bash
# Docker
docker compose logs -f kress-bridge

# Nativ
# Läuft direkt im Terminal
```

---

## MQTT Topics

Der Topic-Prefix `kress` ist in `config.json` unter `mower[0].topic` konfigurierbar.

### Status (Loxone liest → retained)

| Topic | Typ | Beschreibung |
|-------|-----|-------------|
| `kress/status/online` | 0/1 | Bridge verbunden (wird bei Absturz automatisch auf 0 gesetzt) |
| `kress/status/battery` | 0–100 | Akkustand in % |
| `kress/status/battery_charging` | 0/1 | Lädt gerade |
| `kress/status/battery_voltage` | float | Spannung in V |
| `kress/status/battery_temp` | float | Akkutemperatur in °C |
| `kress/status/status` | string | Statustext (z.B. `mowing`, `home`) |
| `kress/status/status_code` | int | Numerischer Statuscode |
| `kress/status/mowing` | 0/1 | Mäht gerade |
| `kress/status/at_home` | 0/1 | Ist in der Basisstation |
| `kress/status/error` | string | Fehlertext (z.B. `none`, `lifted`) |
| `kress/status/error_code` | int | Numerischer Fehlercode |
| `kress/status/wifi_rssi` | int | WLAN-Signalstärke (dBm) |
| `kress/status/total_time` | int | Gesamte Mähzeit (min) |
| `kress/status/total_distance` | int | Gesamtstrecke (m) |
| `kress/status/total_blades` | int | Messernutzung gesamt |
| `kress/status/blade_time` | int | Verbleibende Messerzeit |

### Befehle (Loxone sendet)

| Topic | Payload | Aktion |
|-------|---------|--------|
| `kress/cmd/start` | beliebig | Mähen starten |
| `kress/cmd/stop` | beliebig | Mähen pausieren |
| `kress/cmd/home` | beliebig | Zur Basis fahren |

---

## Loxone Config einrichten

### MQTT-Client im Miniserver aktivieren

1. Loxone Config öffnen
2. Miniserver → Eigenschaften → Netzwerk
3. **MQTT-Client** aktivieren
4. Broker-Adresse: IP des Raspberry Pi, Port `1883`

> Die IP des Pi findest du mit `hostname -I` auf dem Pi.

### Virtuelle Eingänge (Status lesen)

Für jeden Statuswert einen **Virtuellen Eingang** anlegen:

- Typ: MQTT
- Topic: z.B. `kress/status/battery`
- Datentyp: Zahl (bzw. Text bei `status`, `error`)

### Virtuelle Ausgänge (Befehle senden)

Einen **Virtuellen Ausgang** pro Befehl:

- Typ: MQTT
- Topic: z.B. `kress/cmd/start`
- Payload: `1` (Inhalt egal, Hauptsache etwas wird gesendet)

---

## Statuscode-Referenz

| Code | Bedeutung |
|------|-----------|
| 0 | Idle |
| 1 | In Basisstation |
| 2 | Startsequenz |
| 3 | Verlässt Basis |
| 5 | Sucht Draht |
| 7 | Mäht |
| 8 | Angehoben |
| 9 | Blockiert |
| 10 | Messer blockiert |
| 30 | Fährt zur Basis |
| 32 | Kantenschnitt |
| 34 | Sucht Zone |

---

## Wartung

### Update

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

### Stoppen

```bash
docker compose down
```

### Logs

```bash
docker compose logs -f
```

---

## Lizenz

MIT – basierend auf [mqtt-landroid-bridge](https://github.com/nefiertsrebliS/mqtt-landroid-bridge) von nefiertsrebliS.
