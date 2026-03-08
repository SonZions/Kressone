# Kress ↔ Loxone MQTT Bridge

Verbindet einen Kress Mähroboter (z.B. KR121E) über die Kress Cloud mit einem lokalen
Mosquitto MQTT-Broker, den Loxone direkt ansprechen kann.

Basiert auf dem originalen [mqtt-landroid-bridge](https://github.com/nefiertsrebliS/mqtt-landroid-bridge)
(MIT-Lizenz), neu geschrieben für Loxone und Docker.

---

## Architektur

```
Kress KR121E
     │  (WLAN → Kress Cloud)
     ▼
Kress Cloud MQTT (AWS)
     │
 [kress-bridge Container]
     │  (lokales Netzwerk)
     ▼
Mosquitto Container  ←──────── Loxone Miniserver
  Port 1883                    (MQTT Client)
```

---

## Voraussetzungen

- Raspberry Pi mit Docker & Docker Compose
- Kress App-Zugangsdaten (E-Mail + Passwort)
- Seriennummer des KR121E (steht auf dem Gerät oder im Debug-Log)
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
nano config/config.json
```

Folgende Werte eintragen:

| Feld | Beschreibung |
|------|-------------|
| `cloud.email` | E-Mail der Kress App |
| `cloud.pwd` | Passwort der Kress App |
| `mower[0].sn` | Seriennummer des Mähers |
| `mower[0].topic` | MQTT-Topic-Prefix (Standard: `kress`) |

Die Seriennummer beim ersten Start mit `"logLevel": "debug"` herausfinden – sie erscheint im Log.

### 3. Starten

```bash
docker compose up -d
```

### 4. Logs prüfen

```bash
docker compose logs -f kress-bridge
```

---

## MQTT Topics

### Status (Loxone liest → retained)

| Topic | Typ | Beschreibung |
|-------|-----|-------------|
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
| `kress/status/online` | 0/1 | Bridge verbunden |
| `kress/status/total_time` | int | Gesamte Mähzeit (min) |
| `kress/status/total_distance` | int | Gesamtstrecke (m) |

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
4. Broker-Adresse: IP des Raspberry Pi, Port 1883

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
| 7 | Mäht |
| 8 | Angehoben |
| 30 | Fährt zur Basis |
| 5 | Regenverzögerung |

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
