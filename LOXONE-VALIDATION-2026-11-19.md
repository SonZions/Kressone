# Kress-Konfiguration: Umsetzung und Validierung vom 19. November 2026

Die Kress-Seite wurde vollständig neu aufgebaut und in den Miniserver geladen.
Die produktive Bridge bleibt Version 2.1.1 (Anwendungscode `65ba161`).
Das aktive Archiv wurde nach dem letzten Neustart vollständig zurückgelesen.
Die SPS läuft und der MQTT-Empfang über den Pi wurde live bestätigt. Loxone
meldete „Mäher offline“.

## Konfiguration

- 55 Bausteine auf der bestehenden Kress-Seite, fünf MQTT-Abonnements und sieben Publisher.
- Start, Stopp, Heimfahrt, Party an/aus, Status aktualisieren und Messerwechsel bestätigen.
- Status, Verbindung, Partymodus, Akku, Temperatur, Wochenplan, Befehlsrückmeldung,
  Meldung und Messerlaufzeit. Unbekannte/veraltete Werte werden nicht als aktuelle Werte angezeigt.
- 45-Sekunden-Heartbeatüberwachung, Bridge-LWT und Bediensperre bei fehlender Verbindung.
- Stopp und Heimfahrt bleiben bei einem noch ausstehenden Befehl verfügbar, solange
  die Verbindung aktuell ist. Die Bridge prüft Befehle zusätzlich selbst.
- MQTT-Ausgänge senden `1` beim Tastenimpuls und `0` danach, ohne Retain oder Remanenz.
  Die Bridge ignoriert `0`; dadurch sind auch wiederholte Tastenimpulse eindeutig.
- Alte HTTP-Befehle, alte Ablaufsteuerung und automatisches Party-Ende aus der
  Kress-Seite entfernt. Vorhandenes Benachrichtigungsziel beibehalten.
- Bestehender MQTT-Zugang über den Pi (`192.168.178.39`) und dessen Weiterleitung zum
  VPS-Broker. Der zunächst verwendete direkte VPS-Zugang baute keine Verbindung auf.

## Vollständigkeit und Rechte

Das Paket enthält passende `sps.Loxone`, `sps0.LoxCC`, `LoxAPP3.json` und
`permissions.bin`. Alle 424 Berechtigungsgruppen sind enthalten. Bestehende
Benutzer-/Gruppenzuweisungen sind unverändert. Neue App-Steuerelemente verwenden
native Vorlagen und ihre tatsächlichen Objekt-/Zustandskennungen.

Eine vollständige Neugenerierung mit `loxone-config` 0.21.0 reproduzierte nur
412 von 418 ursprünglichen Gruppen des Hauptprogramms. Deshalb werden unbekannte
und unbetroffene Originalgruppen bytegenau erhalten; betroffene Originalgruppen
müssen vor einer Ergänzung exakt reproduzierbar sein. Der Helper verweigert
Änderungen außerhalb der Objektliste und an bestehenden Rechtezuweisungen.

Das unbetroffene Nebenprogramm einschließlich App-, Rechte- und Notfalldateien
sowie `Music.json` bleiben bytegleich. Die Haupt-Notfalldatei enthielt bereits
fünf verwaiste Kress-Ausgangsreferenzen ohne die entsprechenden Geräte. Diese
wurden gezielt entfernt; Cloud-Steuerung war auch im nativen Original-Notprogramm
nicht enthalten. Alle anderen Notfallobjekte bleiben unverändert.

Ungültig kodierte Originalbytes außerhalb der Änderungen wurden unverändert
bewahrt. Eine Ersatzdekodierung dient ausschließlich der Analyse und wird nie
als Programm zurückgeschrieben. LoxCC-Länge, CRC32, unabhängige LZ4-Rückprüfung,
ZIP-Inhalte, Referenzen und unveränderte Archivmitglieder wurden geprüft.

## Native und automatisierte Prüfungen

- Temporäre Windows-Server-2025-VM, offizielle Loxone Config 17.3.11.10, MCP 0.1.20.
- Installer-Prüfsumme und gültige Authenticode-Signatur geprüft.
- Original: 49 Seiten, 1.783 Funktionsbausteine. Neuer Hauptentwurf: 49 Seiten,
  1.813 Funktionsbausteine, keine Kress-Validierungsbefunde.
- Die zwei bereits vorhandenen Fehler `PRESENCE_DEVICES_USED_AS_INPUTS` außerhalb
  der Kress-Seite bleiben unverändert. Das Gesamtprojekt wird nicht als fehlerfrei bezeichnet.
- Native Rückspeicherung enthält alle 55 neuen bzw. umgebauten Seitenbausteine.
- Nativ simuliert: sicherer Startzustand, JSON-Auswertung, aktuelle Status- und
  Party-Anzeige, Akku/Temperatur/Laufzeit, Texte und Befehlsimpuls.
- Bei laufenden Simulationszyklen: nach rund 48,5 Sekunden ohne neuen Heartbeat
  Störungsanzeige, Bediensperre und Ausgang `0`; ein gesperrter Start erzeugt kein
  `1`. Frische Daten geben die Bedienung wieder frei und ein weiterer Impuls erzeugt `1`.
- Der abschließende Brokerwechsel zurück zum vorhandenen Pi-Relay und die zwei
  Stopp-/Heimfahrt-Verbindungen wurden danach als drei exakte Ersetzungen geprüft.
  Dabei ändern sich nur Projekt-XML und das entsprechende Laufzeit-XML;
  App-, Rechte- und übrige Dateien bleiben bytegleich. Dieser letzte kleine Patch
  wurde nicht erneut in einer VM geöffnet.
- 14 gezielte Tests der neuen Offline-Hilfswerkzeuge bestanden.
- Keine physischen Start-, Stopp-, Heimfahrt- oder Party-Befehle zum Mäher gesendet.

## Sicherung und Aktivierung

Vor dem Schreiben wurden Programm und sämtliche vier App-Fragmente jeweils
zweimal stabil gelesen. Ein während der früheren Arbeiten geändertes App-Fragment
wurde in seinem aktuellen Stand gesichert, nicht durch die ältere Sicherung ersetzt.
Uploads erfolgen einmalig, werden vollständig zurückgelesen und erst nach
Bytegleichheit durch einen Neustart aktiviert. Fehlende App-Fragmente werden
bytegenau wiederhergestellt und anschließend ohne erneuten Programmupload neu geladen.

Das aktive Archiv ist `sps_0281_20261119115707.zip`. Nach der letzten
Aktivierung fehlten drei App-Fragmente. Sie wurden aus der aktuellen Sicherung
wiederhergestellt. Ein inzwischen geändertes und ein neu erzeugtes Fragment
blieben in ihrem aktuellen Stand erhalten. Nach dem Neustart wurden alle fünf
Dateien zweimal anhand ihrer SHA-256-Werte bestätigt.

Endgültiger Kandidat SHA-256:
`0a43adb85e849a19c2ff7149970f2bf3c343a0a4dd3b466804b9274a7680a3b9`.

Private Projekte, Sicherungen, Patchdateien und vollständige Prüfausgaben bleiben
außerhalb des Git-Repositories in zugriffsbeschränkten Arbeitsverzeichnissen.

## Prüf-VM entfernt

Die erneute Prüf-VM samt Betriebssystemdatenträger, öffentlicher IP, Netzwerkkarte,
Netzwerksicherheitsgruppe und RDP-Container wurde vollständig entfernt. Der
abschließende Azure-Abgleich enthält ausschließlich das zuvor vorhandene VNet.
