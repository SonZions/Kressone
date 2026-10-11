# Kressone – Reparatur und Live-Nachweise

Stand: 11. Oktober 2026, Europe/Berlin. Modell live über Produktkatalog erkannt:
**Kress Mission KR121E**, Geräteprotokoll 0, Firmware 3.36.0+1.
Keine Seriennummer, Benutzerkennung, MQTT-Gerätetopics oder Zugangsdaten im Bericht.

## Bestätigte Fehlerursachen

1. Der bisherige Code nutzte `api.kress.com/api/v1` statt der nachweislich
   funktionierenden API `api.kress-robotik.com/api/v2`.
2. OAuth-Client-ID und mitgesendetes Client-Secret entsprachen nicht dem Verfahren
   der etablierten Integrationen. JSON Password Grant mit aktueller Kress-Client-ID
   sowie Refresh Grant funktionieren live. Ein Client-Secret ist dafür nicht nötig.
3. Cloud MQTT verwendete Port 8883 und den Access-Token als Benutzername/Passwort.
   Nachweislich funktioniert WebSocket-TLS auf 443 mit AWS Custom Authorizer,
   `KR/USER/.../kressone/...` und den tatsächlich gelieferten Gerätetopics.
4. Erneuerung alle elf Stunden war falsch: live ausgegebene Tokens gelten 3600 Sekunden.
5. Fehlende Daten wurden teilweise zu 0 umgedeutet; Messerlaufzeit wurde falsch
   interpretiert; retained Befehle und Verbindungszustände waren nicht ausreichend
   abgesichert.
6. Separater Diagnosefehler: Python urllib wurde mit Cloudflare 1010 wegen seiner
   Client-Signatur blockiert. Python requests erreicht den OAuth-Dienst mit denselben
   Zugangsdaten. Das war kein Nachweis falscher Zugangsdaten.
7. Die VPS-Firewall verwirft neue Verbindungen zwischen Containern auf docker0.
   Auch der Weg vom Container zur VPN-Bind-Adresse funktionierte nicht. Im Host-Netz
   erreicht die Bridge den bestehenden Broker; keine Firewalländerung durchgeführt.

Nicht bestätigt: generelle Kress-Kontosperre, Abschaffung der API oder Fleet-Migration.

## Live-Diagnose des Containers

| Prüfung | Ergebnis |
|---|---|
| DNS und TLS | PASS |
| OAuth-Anmeldung mit vorhandenen Zugangsdaten | PASS |
| Refresh-Token-Erneuerung | PASS, auch im fertigen Node-Container |
| Gerät erkannt | PASS, genau ein KR121E |
| Cloud MQTT und bestätigtes Abonnement | PASS |
| Neue Statusmeldung nach Statusabfrage `cmd:0` | PASS |
| Bestehender MQTT-Broker erreichbar | PASS |
| Broker-Authentifizierung | SKIPPED: Broker erlaubt anonymen Zugriff |
| Diagnose-Publish und Subscriber-Empfang | PASS |
| Produktive Status-Publikation und unabhängiger Subscriber | PASS |
| Docker-Build mit Tests | PASS |
| Healthcheck | PASS, healthy |
| Verbindung nach SIGHUP neu aufgebaut | PASS, ohne Prozessneustart |
| Container gestoppt und mit erneuertem Token gestartet | PASS, frischer MQTT-Datenfluss erneut bestätigt |

Tatsächlich neu über Cloud MQTT empfangen und vom produktiven lokalen Subscriber
bestätigt am 11.10.2026 um 23:29:00 MESZ:

- Akku: 100 %
- Batteriespannung: 18,98 V
- Status: home / Basisstation
- Fehlercode: 0
- Quelle: cloud_mqtt

Das sind echte Mäherdaten, keine Fixtures. Die Diagnose hat gespeicherte REST-Daten
und neue MQTT-Meldungen getrennt ausgewiesen. Es wurden keine Start-, Stopp- oder
Heimfahrbefehle ausgeführt.

## Tests und Qualität

15 automatisierte Tests decken Konfigurationsprüfung, Login und Fehlerfälle,
Tokenablauf/Refresh, parallele Tokenanforderungen, Geräteauswahl, MQTT/SUBACK,
Reconnect, Statusfelder, unbekannte Codes, retained/DUP/ungültige Befehle,
Status-only-Modus, Authentifizierungssperre und Shutdown ab.
ESLint besteht. Produktionsabhängigkeiten: keine bekannten Audit-Funde zum Testzeitpunkt.
Gitleaks hat im vorgesehenen Checkout keine Secrets gefunden.

GitHub Actions prüfen Installation, ESLint, Unit-Tests, npm audit, Secrets und
AMD64/ARM64-Builds. Kein automatisches Deployment. Die VPS-Installation wurde
auf AMD64 getestet; ARM64-Laufzeitbetrieb wurde nicht auf Hardware getestet.

## Betrieb

| Eigenschaft | Wert |
|---|---|
| Container | kress-bridge |
| Broker | bestehender mosquitto-vps, VPN-Adresse Port 1883 |
| Netzwerkmodus | host, keine eigenen Listener/Ports |
| Code auf VPS | /opt/kress/app |
| Ursprüngliche Credentials | /etc/kress/secrets/kress.env, Mode 600 |
| Laufzeitkonfiguration | /etc/kress/secrets/runtime.env, Mode 600 |
| Tokenzustand | /opt/kress/state, UID 1000, Mode 700; Token Mode 600 |
| Konfigurationsbackup | /etc/kress/backups |
| Benutzer | node, UID 1000 |
| Grenzen | 160 MB RAM, 0,5 CPU, 80 Prozesse |
| Neustartregel | unless-stopped |
| Logs | Docker json-file, 3 × 5 MB; docker logs kress-bridge |
| Healthcheck | node healthcheck.js, alle 30 Sekunden |
| Start | cd /opt/kress/app && docker compose up -d --build |

Image-/Commit-Zuordnung wird in `/opt/kress/deployment.json` festgehalten.
Update und Rollback sind in `kress-loxone-bridge/README.md` dokumentiert.
Bei dieser Erstinstallation gibt es keine vorherige funktionierende Kress-Bridge.
Rollback: ausschließlich `docker compose stop kress-bridge`; andere Dienste bleiben
unverändert. Aktuelle Refresh-Tokens nicht auf alte Backups zurücksetzen.

## Grenzen

Die Hersteller-API ist inoffiziell. Unterstützt und live geprüft ist der KR121E mit
Protokoll 0, nicht Fleet oder andere Gerätemodelle. Physische Steuerbefehle wurden
nur mit Mocks geprüft. Ein Host-Neustart wurde wegen der anderen produktiven Dienste
nicht durchgeführt. Loxone muss retained Messwerte mit bridge_online und
last_update/Heartbeat-Gültigkeit auswerten; eine Loxone-Konfiguration war nicht
Bestandteil der bereitgestellten Dateien.

Die unmittelbare Statusabfrage nach SIGHUP fiel noch in das 60-Sekunden-Limit und
wurde unterdrückt. Der Verbindungsneuaufbau war erfolgreich; der spätere separate
Neustart-/Refresh-Test lieferte wieder eine neue MQTT-Meldung (23:31:26 MESZ, 18,97 V).

Produktive Bewegungsbefehle bleiben zunächst deaktiviert; Status und cmd/refresh
sind produktiv. Ihre dauerhafte Aktivierung benötigt die gesondert angefragte
Freigabe. Einstufung bis dahin: PARTIALLY WORKING (Statusdatenfluss produktiv).
