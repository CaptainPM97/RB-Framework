# ResourceBay Framework

White-Label-Verwaltungstool für StateV-Firmen — läuft wahlweise als **lokale Desktop-App** (macOS/Windows, kein Server nötig) oder als **Team-Server** (eine Adresse, mehrere Nutzer mit Login/Rechtesystem). Keine PHP-Installation nötig, keine mitgelieferten Zugangsdaten — jede Installation startet leer und wird komplett selbst konfiguriert.

## Download

Alle fertigen Installationsdateien liegen unter:

**👉 [github.com/CaptainPM97/RB-Framework/releases/latest](https://github.com/CaptainPM97/RB-Framework/releases/latest)**

Dort im Abschnitt „Assets" die passende Datei herunterladen:

| Datei | Für |
|---|---|
| `ResourceBay-Framework-macOS.dmg` | Desktop-App auf dem Mac |
| `ResourceBay-Framework-Windows-Setup.exe` | Desktop-App auf Windows (mit Installations-Assistent) |
| `ResourceBay-Framework-Windows-portable.exe` | Desktop-App auf Windows (keine Installation, einfach ausführen) |
| `resourcebay-server-linux-amd64` | Team-Server auf den meisten VPS/Cloud-Servern |
| `resourcebay-server-linux-arm64` | Team-Server auf ARM-Servern (z.B. Raspberry Pi, AWS Graviton) |
| `resourcebay-server-windows-amd64.exe` | Team-Server auf einem Windows-Server |
| `resourcebay-server-macos` | Team-Server auf einem Mac |

---

## Installation: Desktop-App (macOS)

1. `ResourceBay-Framework-macOS.dmg` herunterladen und öffnen (Doppelklick).
2. Im sich öffnenden Fenster die App auf den „Programme"-Ordner ziehen.
3. App öffnen (aus dem Programme-Ordner oder Launchpad).
4. **Gatekeeper-Warnung beim ersten Start**: Da die App nicht mit einem kostenpflichtigen Apple-Entwicklerzertifikat signiert ist, zeigt macOS beim ersten Öffnen eine Warnung „nicht verifizierter Entwickler". Das umgeht man einmalig per **Rechtsklick auf die App → „Öffnen"** (statt Doppelklick) und dann im Dialog nochmal „Öffnen" bestätigen. Danach startet sie beim nächsten Mal ganz normal.
5. Beim allerersten Start öffnet sich direkt der Einstellungen-Bereich (kein Login nötig, das ist deine persönliche lokale Kopie) — dort mindestens den **StateV-vAPI-Key** eintragen, optional App-Name/Farben/Logo-Kürzel anpassen.
6. Fertig — die App arbeitet ab jetzt mit deinen eigenen lokalen Daten.

## Installation: Desktop-App (Windows)

**Mit Installations-Assistent (empfohlen):**
1. `ResourceBay-Framework-Windows-Setup.exe` herunterladen und ausführen.
2. Falls Windows SmartScreen warnt („Windows hat den Computer geschützt"): auf „Weitere Informationen" → „Trotzdem ausführen" klicken (gleicher Grund wie bei macOS — kein kommerzielles Code-Signing-Zertifikat).
3. Dem Assistenten folgen (Installationsort, Startmenü-Verknüpfung).
4. App über Startmenü/Desktop-Verknüpfung starten.

**Ohne Installation (portable):**
1. `ResourceBay-Framework-Windows-portable.exe` herunterladen, an einen beliebigen Ort legen (z.B. Desktop).
2. Doppelklick zum Starten — keine Installation, keine Admin-Rechte nötig.

In beiden Fällen: beim ersten Start öffnet sich der Einstellungen-Bereich (StateV-vAPI-Key eintragen, optional Branding/Farben anpassen).

## Installation: Team-Server (für mehrere Nutzer)

Voraussetzung: ein **eigener Server mit SSH-Zugriff** (VPS/Root-Server) — reines Shared-PHP-Webspace reicht nicht, da der Server als eigener Dauerprozess läuft (siehe unten „Warum kein Shared Hosting").

1. Passende Server-Datei herunterladen, z.B. für die meisten VPS-Anbieter:
   ```bash
   wget https://github.com/CaptainPM97/RB-Framework/releases/latest/download/resourcebay-server-linux-amd64
   ```
2. Ausführbar machen und Datenordner anlegen:
   ```bash
   chmod +x resourcebay-server-linux-amd64
   mkdir -p data
   ```
3. Starten:
   ```bash
   ./resourcebay-server-linux-amd64 -data-dir ./data -listen :8080
   ```
   Für dauerhaften Betrieb (läuft weiter, auch nach Verbindungsabbruch) z.B. mit `screen`/`tmux`, oder als `systemd`-Service einrichten.
4. Im Browser `http://<server-ip>:8080` aufrufen — beim allerersten Aufruf erscheint automatisch die Ersteinrichtung: eigenen Admin-Account anlegen (Benutzername + Passwort).
5. Nach dem Login als Admin: unter „Einstellungen" (nur für Admins sichtbar) den StateV-vAPI-Key eintragen und optional Branding/Farben/Logo setzen — das gilt dann automatisch für **alle** Team-Mitglieder einheitlich (keine Pro-Nutzer-Einstellung).
6. Weitere Team-Mitglieder unter „Benutzer verwalten" (ebenfalls Admin-only) mit eigenem Zugang und passenden Rechten anlegen.
7. Firewall/Port beachten: Port `8080` (oder ein anderer über `-listen`) muss von außen erreichbar sein. Für eine echte Domain + HTTPS empfiehlt sich ein Reverse-Proxy davor (z.B. nginx/Caddy).

### Warum kein Shared Hosting?

Klassisches Shared-PHP-Webspace (wie die ursprüngliche PHP-Version genutzt hat) führt PHP nur kurzzeitig pro Seitenaufruf aus — dafür ist kein eigener Prozess/Port nötig. Der neue Server ist dagegen eine einzelne Programmdatei, die **dauerhaft läuft und selbst einen Port belegt**; das braucht SSH-/Root-Zugriff. Ohne VPS bleibt entweder die alte PHP-Version auf dem bestehenden Webspace weiter im Einsatz, oder man nutzt einen günstigen VPS (oft schon ab 3-5 €/Monat, der Server selbst braucht kaum Ressourcen).

### Alternative: Aus der Desktop-App heraus exportieren

Wer bereits die Desktop-App nutzt, kann unter Einstellungen → „Als Team-Server exportieren" dieselben Server-Dateien direkt herunterladen, inklusive der Möglichkeit, die eigenen lokalen Daten (Benutzer/Produktion/Verträge, einzeln auswählbar) als ZIP mitzunehmen — landet dann einfach im `data`-Ordner neben der Server-Datei, bevor man sie startet.

## Updates

Ab und zu erscheint eine neue Version unter [Releases](https://github.com/CaptainPM97/RB-Framework/releases). Update = alte Datei durch die neue ersetzen und neu starten — alle Daten liegen in einem separaten Ordner außerhalb der App/Server-Datei und bleiben beim Ersetzen automatisch erhalten.

## Feedback

Bugs oder Verbesserungsvorschläge lassen sich direkt aus der App heraus melden: Hauptmenü → „💬 Feedback geben" öffnet ein vorausgefülltes GitHub-Issue im Browser.
