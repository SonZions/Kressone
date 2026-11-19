# Native Config-Prüfung vom 19. November 2026

Die produktive Kress-Bridge läuft als Version 2.1.1 (Anwendungscode `65ba161`).
Der Umbau und das Einspielen der Loxone-Konfiguration sind **noch nicht abgeschlossen**.
Es wurde keine neue Miniserver-Konfiguration hochgeladen und kein Miniserver-Neustart ausgelöst.

## Tatsächlich geprüft

- Temporäre Windows-Server-2025-VM mit Loxone Config **17.3.11.10**, passend zur vorhandenen Firmware.
- Offizieller Installer: gültige Authenticode-Signatur; ZIP-SHA256
  `1ef133987f6d4d17bd5e289aa88c061adaa6d6eb6c7775bec5728b0f7d4fb87c`.
- Offizielles MCP-Add-on **0.1.20**, von Config selbst installiert und gestartet.
  EXE-SHA256 `7d9f3b8257cf23878d069f484cd242f1c02e3255211fb019560c672f3e6dca2f`.
- Gesicherte Originalkonfiguration nativ geöffnet: 49 Seiten, 1.783 Funktionsbausteine.
- Native Projektvalidierung ausgeführt. Bereits im Original bestehen zwei Fehler
  `PRESENCE_DEVICES_USED_AS_INPUTS` außerhalb der Kress-Seite, außerdem Warnungen.
  Das Gesamtprojekt wurde deshalb nicht als fehlerfrei bewertet.
- Ein nativer Offline-Simulationszyklus erfolgreich ausgeführt; Simulation danach beendet.
  Das ist kein Funktionstest der neuen Kress-Logik und kein Nachweis physischer Mähersteuerung.
- Unveränderten nativen Vergleichsstand privat gespeichert. Bestehende MQTT-Objektkennungen
  blieben beim nativen Speichern erhalten. Eine temporäre leere Testseite wurde wieder entfernt.

## Offene technische Grenzen

Die bestehende MQTT-Integration verweist noch auf den bisherigen Broker. Sie besitzt
nur drei Abonnements und einen noch nicht angeschlossenen Ausgang. Alte HTTP-Befehle
und Ablaufsteuerungen sind weiterhin Teil der unveränderten Produktivkonfiguration.

Die native SDK-Geräteliste bietet keine MQTT-Ein-/Ausgänge zum Einfügen an. In dieser
Installation erscheint das vorhandene MQTT-Gerät als `Plugin (In Development)`;
seine Einstellungswerte sind lesbar, die generischen Beschriftungen fehlen. Die
Ursache wurde nicht abschließend geklärt. Diese Beobachtung ist keine Aussage,
dass die produktive MQTT-Integration grundsätzlich defekt wäre.

Lokales natives Speichern und Simulation erzeugten kein vollständiges Uploadarchiv
mit neu erzeugten App-, Berechtigungs- und Teilprogrammdateien. Die geprüfte
SDK-Aktionsliste bietet keinen solchen Offline-Export; der SD-Dialog zeigt die
Wiederherstellung vorhandener Sicherungen. Ein vollständig geprüfter Erzeugungsweg
steht daher weiterhin aus. Ein XML-Patch mit unveränderten App-Dateien wurde nicht
als Ersatz eingespielt.

Für die Fortsetzung: zuerst MQTT-Definitionen und den vollständigen nativen
Erzeugungsweg klären, dann den geplanten Umbau durchführen, gegen den Originalstand
prüfen und simulieren, neue Server-Sicherung abgleichen, einspielen und rücklesen.
Die Nutzerfreigabe für diesen Umbau und das Einspielen liegt bereits vor.

Private Projektdaten, Zugangsdaten, Sicherungen und vollständige Prüfausgaben
liegen ausschließlich in den geschützten Arbeitsverzeichnissen, nicht im Repository.

## Abbau nachgewiesen

Die temporäre VM, ihr Betriebssystemdatenträger, ihre öffentliche IP, Netzwerkkarte,
Netzwerksicherheitsgruppe und der Abschaltplan wurden entfernt. Die abschließende
Azure-Ressourcenliste entspricht wieder exakt dem vorher gesicherten Stand: nur
das bereits vorhandene VNet ist erhalten. Der temporäre RDP-Container wurde entfernt.

## Abschließender Produktionsabgleich

Das Programmarchiv ist unverändert, die SPS läuft (Zustand 5). Die Bridge meldet
`healthy`, Image `kressone:2.1.1-65ba161`, Neustartzähler 0.
Eines der vier vorhandenen App-Fragmente unter `/sys/custom` hat sich während des
Arbeitszeitraums geändert; Ursache nicht bestimmt. Der neue Stand wurde zweimal
stabil gelesen und separat gesichert. Es wurde nichts zurückgeschrieben oder
überschrieben. Vor einem späteren Einspielen muss dieser neue Ist-Stand zugrunde
gelegt werden.
