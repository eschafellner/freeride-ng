# Bauplan: Kettler E5 "Zwift light" Web-App

Nov 11, 2026 · @Edgar

## Ziel & Umfang

Gebaut wird ein Open-World-Radspiel im Browser. Man erkundet mit dem Kettler E5 eine 3D-Welt, und die Steigung im Gelände wird über Zielwatt am Ergometer spürbar. Training ist ein Modus des Spiels, nicht sein Kern. Das MVP umfasst die Phasen 1 bis 4: Gerät, Physik, 3D-Welt und Erkunden.

**MVP (zuerst):**

- Verbindung über Web Serial, dazu ein Simulator: per Tastatur gesteuerte Watt und Kadenz, damit man ohne Rad entwickeln kann
- Low-Poly-3D-Welt (Three.js) mit Gelände, Wegenetz und Kreuzungen
- Fahren: Geschwindigkeit aus der Leistung, Richtung an Kreuzungen per Tastatur oder Gamepad wählen
- Steigung aus dem Gelände wird über Zielwatt spürbar
- Erkunden: Karte mit Nebel, der sich beim Fahren lichtet, dazu Sammelobjekte und Aussichtspunkte
- HUD mit Watt, Kadenz, Puls und Tempo, Spielstand wird lokal gespeichert

**Später:**

- Fortschritt: Erfahrungspunkte für Kilometer und Höhenmeter, Level, freischaltbare Räder und Outfits, Achievements
- Herausforderungen: Sprintzonen, Bergwertungen, Zeitfahren, Ghost-Fahrer gegen die eigene Bestzeit
- Größere Welt: Biome, nachgeladene Gebietskacheln, Tag-Nacht-Wechsel, Wetter, Sound
- Trainingsmodus: Workouts im ERG-Modus, Fahrten-Historie, Export für Strava und Garmin
- Optional: echte Gegenden aus OpenStreetMap- und Höhendaten, eine Raspberry-Pi-Bridge für Zwift

## Architektur & Tech-Stack

Die App läuft komplett im Browser, ohne Backend. Nur der Gerätetreiber kennt das Kettler-Protokoll. Alles darüber spricht mit einem neutralen `TrainerDevice`-Interface, deshalb funktioniert später auch ein anderes Gerät oder der Simulator.

&#91;embedded content: Architektur · Gerät, Engine, Spielwelt\]

Die Ride-Engine ist das Herz: Sie bekommt Messwerte vom Gerät und die Steigung aus der Spielwelt und schickt Zielwatt zurück.

- **Sprache und Build:** TypeScript, Vite, Vitest für Tests
- **3D:** Three.js, Low-Poly-Stil, Modelle als glTF
- **Gerät:** Web Serial API (Chrome oder Edge am Desktop)
- **Eingabe:** Tastatur und Gamepad API
- **Speicher:** IndexedDB, z.B. über die kleine Bibliothek `idb`

## Phase 0: Hardwaretest

Bevor Code entsteht, klärt ein kurzer Test, ob der E5 das bekannte Kettler-Textprotokoll spricht. Die Befehle unten stammen von anderen Kettler-Modellen und sind für den E5 noch unbestätigt.

- [ ] E5 per USB an einen Linux-Rechner oder Laptop hängen, `dmesg` prüfen: erscheint `/dev/ttyUSB0` (CP210x oder PL2303)? Unter Windows: neuer COM-Port im Geräte-Manager?
- [ ] Terminal öffnen, z.B. `screen /dev/ttyUSB0 9600` oder `minicom`, Zeilenende CR+LF
- [ ] `ID` und `VE` senden: Gerätekennung und Version notieren
- [ ] `CM` senden (PC-Modus), dann `ST`: komplette Antwortzeile beim Treten abspeichern, mehrere Beispiele
- [ ] `PW 100`, dann `PW 150` senden: wird der Widerstand spürbar höher?
- [ ] Notieren: kleinster und größter akzeptierter Wattwert, Schrittweite (oft 5 W), Verhalten bei `RS`
- [ ] Prüfen, was passiert, wenn die Verbindung abreißt: bleibt der letzte Widerstand aktiv?

Die gespeicherten `ST`-Zeilen sind das wichtigste Ergebnis. Sie werden zu Testdaten für den Parser in Phase 1.

**Erwartetes `ST`-Format (zu bestätigen):** acht Werte, durch Tabulator getrennt, etwa Puls, Trittfrequenz, Geschwindigkeit, Distanz, Soll-Watt, Energie, Zeit (mm:ss), Ist-Watt.

## Phasen 1–7

Jede Phase endet mit etwas Spielbarem oder Testbarem und passt in eine bis zwei Claude-Code-Sessions. Die Phasen 1 bis 4 sind das MVP. Den Startprompt kopierst du jeweils in eine neue Session.

### Phase 1: Projekt-Setup und Gerätetreiber

**Ergebnis:** Eine Debug-Seite zeigt Live-Werte vom E5 oder vom Simulator. Ein Button setzt Zielwatt.

- Vite + TypeScript, Ordnerstruktur, Vitest, ESLint, `CLAUDE.md`
- Interface `TrainerDevice` mit `connect()`, `disconnect()`, `setTargetPower(w)` und einem Event-Strom für Messwerte
- `KettlerSerialDevice`: Web Serial, Befehlswarteschlange (immer nur ein Befehl offen), `ST` jede Sekunde, Parser, Reconnect
- `MockDevice`: Watt und Kadenz per Tastatur, realistisches Rauschen
- Parser-Tests mit den echten `ST`-Zeilen aus Phase 0

```text
Lies CLAUDE.md und Bauplan Phase 1. Richte ein Vite+TypeScript-Projekt mit Vitest ein. Implementiere das TrainerDevice-Interface, einen KettlerSerialDevice-Treiber über Web Serial (9600 Baud, CR/LF, Befehle CM/ST/PW) und ein MockDevice. Schreib Parser-Tests mit den ST-Beispielzeilen in tests/fixtures/. Baue eine schlichte Debug-Seite mit Verbinden-Button, Live-Werten und einem Zielwatt-Regler.
```

### Phase 2: Physik und Fahrerzustand

**Ergebnis:** Eine getestete Ride-Engine ohne Grafik, die aus Watt und Steigung Tempo, Distanz und Zielwatt berechnet.

- Physikmodell (siehe Abschnitt Steigung und Steuerung): Watt zu Geschwindigkeit, Fahrer- und Radgewicht einstellbar
- Spielschleife mit fester Taktung (z.B. 20 Hz Physik, 1 Hz Gerät)
- Zielwatt-Berechnung mit Glättung, Schrittbegrenzung und Watt-Grenzen
- Unit-Tests: Ebene, 5 % und 10 % Steigung, Abfahrt

```text
Lies CLAUDE.md und Bauplan Phase 2. Implementiere eine Ride-Engine als reines TypeScript-Modul ohne UI: Eingang Messwerte und aktuelle Steigung, Ausgang Geschwindigkeit, Distanz und Zielwatt. Nutze das Physikmodell aus dem Bauplan, glätte die Zielwatt und begrenze sie. Schreib Unit-Tests für typische Steigungen.
```

### Phase 3: 3D-Grundgerüst

**Ergebnis:** Man fährt mit dem E5 eine Strecke durch eine kleine 3D-Landschaft, die Kamera folgt dem Rad.

- Three.js-Szene, Low-Poly-Stil, Licht und Himmel
- Gelände aus einer Höhenkarte (Noise oder eine gemalte Heightmap)
- Wegenetz als Graph: Knoten sind Kreuzungen, Kanten sind Wege mit Kurve und Höhenverlauf
- Rad folgt dem Weg, die Steigung kommt aus dem Gelände und geht in die Ride-Engine
- HUD als HTML-Overlay

```text
Lies CLAUDE.md und Bauplan Phase 3. Baue eine Three.js-Szene im Low-Poly-Stil mit Gelände aus einer Höhenkarte und einem Wegenetz als Graph. Ein Fahrer folgt einem Weg mit der Geschwindigkeit aus der Ride-Engine, die Steigung wird aus dem Gelände gelesen. Kamera hinter dem Fahrer, HUD als HTML-Overlay.
```

### Phase 4: Open World erkunden

**Ergebnis:** Eine kleine, frei erkundbare Insel mit Kreuzungen, Karte, Sammelobjekten und Speicherstand.

- Richtungswahl an Kreuzungen per Pfeiltaste oder Gamepad, sonst geht es geradeaus weiter
- Minimap und Großkarte mit Nebel, der sich beim Fahren lichtet
- Sammelobjekte, Aussichtspunkte, Schilder mit Ortsnamen
- Spielstand (Position, Entdecktes, Gesammeltes) in IndexedDB

```text
Lies CLAUDE.md und Bauplan Phase 4. Erweitere die Welt zu einer kleinen Insel mit mehreren Kreuzungen. Richtungswahl per Pfeiltasten und Gamepad API, Minimap mit Fog of War, Sammelobjekte und Aussichtspunkte. Speichere den Spielstand in IndexedDB.
```

### Phase 5: Fortschritt und Herausforderungen

**Ergebnis:** Es gibt einen Grund, morgen wieder aufs Rad zu steigen.

- Erfahrungspunkte für Kilometer, Höhenmeter und Entdecktes, Level, Achievements
- Freischaltbare Räder, Outfits, neue Gebiete
- Segmente: Sprintzonen, Bergwertungen, Zeitfahren mit Bestzeiten
- Ghost-Fahrer: die eigene Bestfahrt als Schatten

### Phase 6: Welt ausbauen

**Ergebnis:** Eine größere, lebendige Welt, die auch auf schwächerer Hardware flüssig läuft.

- Biome (Wald, Berge, See, Dorf), Kacheln werden beim Fahren nachgeladen
- Tag-Nacht-Wechsel, Wetter, Sound und Musik
- Performance: Instancing für Bäume, Level of Detail, Ziel 60 fps

### Phase 7: Training und Extras

**Ergebnis:** Das Spiel taugt auch als Trainingswerkzeug.

- Workouts im ERG-Modus, optional Import von `.zwo`-Dateien
- Fahrten-Historie, Export als TCX oder FIT
- Optional: Welt aus OpenStreetMap- und Höhendaten, Raspberry-Pi-Bridge

## Steigung und Steuerung in der Welt

Der E5 kennt nur einen Stellwert, die Zielleistung `PW`. Ein Berg wird deshalb spürbar, indem die App aus virtueller Geschwindigkeit und Geländesteigung die nötigen Watt berechnet und ans Gerät schickt.

**Physikmodell** (Leistungsbedarf bei Geschwindigkeit v und Steigungswinkel θ):

```latex
P = v \cdot \left( m g \left( C_{rr} \cos\theta + \sin\theta \right) + \tfrac{1}{2} \rho \, C_dA \, v^2 \right)
```

Startwerte: m = 85 kg (Fahrer plus Rad, einstellbar), g = 9,81 m/s², C\_rr = 0,005, C\_dA = 0,32 m², ρ = 1,2 kg/m³. Umgekehrt löst die Engine die Gleichung numerisch nach v auf, um aus gemessenen Watt das Tempo zu bekommen.

**Simulationsmodus mit virtuellen Gängen (empfohlen):**

1. Aus Trittfrequenz und gewähltem virtuellen Gang ergibt sich ein Wunschtempo: v = Kadenz / 60 × Übersetzung × 2,1 m Radumfang.
2. Die Engine berechnet mit dem Modell die Watt für dieses Tempo bei der aktuellen Steigung.
3. Dieser Wert geht, geglättet und begrenzt, als `PW` ans Gerät. Bergauf wird es schwer, wer schaltet, tritt leichter.
4. Bergab fällt `PW` auf das Minimum. Das Tempo kommt dann aus der Physik, man rollt.

Gänge schaltet man per Taste oder Gamepad. Ein Regler für den Schwierigkeitsgrad (z.B. 50 % bis 100 % der echten Steigung) macht steile Rampen fahrbar.

**Einfacher Modus als Fallback:** `PW` = Grundleistung × (1 + k × Steigung). Das ist schnell gebaut und reicht für erste Tests in Phase 3.

**Steuern ohne Lenker:** Das Rad folgt automatisch dem Weg. Nur an Kreuzungen wählt man die Richtung, sonst geht es geradeaus. Eingabe per Tastatur, oder per Bluetooth-Gamepad über die Gamepad API. Ein kleiner Controller am Lenker ist dabei der bequemste Weg. Später ist auch das Handy als Fernbedienung denkbar.

**Taktung:** `ST` einmal pro Sekunde, neues `PW` nur bei einer Änderung von mindestens 5 W und höchstens alle 2 Sekunden. Schrittweite und Reaktionszeit des E5 werden in Phase 0 gemessen.

## Sicherheit & Grenzen

Die App darf das Gerät nie überraschend schwer machen. Diese Regeln gehören in den Treiber, nicht nur ins UI, damit kein Spielfehler sie umgehen kann.

- Harte Watt-Grenzen im Treiber: Minimum und Maximum aus Phase 0, dazu ein persönliches Maximum in den Einstellungen
- Begrenzte Änderungsrate: Zielwatt steigen höchstens um etwa 20 W pro Sekunde
- Pause, Tab-Wechsel, Spielende oder Absturz: `PW` auf das Minimum setzen, bevor die Verbindung schließt
- Gut sichtbarer Notstopp-Button und eine Taste dafür
- Optionale Pulsgrenze mit Warnung und automatischer Entlastung
- Web Serial läuft nur in Chrome oder Edge auf dem Desktop, und nur über `localhost` oder HTTPS

## Arbeitsweise mit Claude Code

Pro Session eine Phase, und vor jeder Session ein grüner Stand in Git. So bleibt jede Änderung klein, testbar und leicht zurückzunehmen.

1. Neues Git-Repository anlegen und diesen Bauplan als `docs/bauplan.md` ablegen.
2. Als erste Datei eine `CLAUDE.md` mit Projektziel, Tech-Stack, Ordnerstruktur, Sicherheitsregeln und den Befehlen `npm run dev` und `npm test`.
3. Die echten `ST`-Zeilen aus Phase 0 unter `tests/fixtures/` ablegen.
4. Eine Session pro Phase mit dem Startprompt. Zuerst einen Plan anfordern, dann umsetzen lassen.
5. Entwickelt wird mit dem `MockDevice`. Das echte Rad kommt erst zum Abschluss jeder Phase dazu.
6. Am Ende jeder Phase: Tests laufen lassen, kurz selbst spielen, committen, offene Punkte in `docs/bauplan.md` nachtragen.

Tests braucht es vor allem für den Parser, die Physik und die Zielwatt-Begrenzung. Grafik und Spielgefühl prüfst du selbst beim Fahren.

## Offene Entscheidungen

Diese Punkte klären wir vor Phase 1 oder spätestens vor der jeweiligen Phase. Die Vorschläge sind ein Startpunkt.

→ Wie vorgeschlagen

| Entscheidung | Optionen | Vorschlag |
| --- | --- | --- |
| Grafikstil | Low-Poly 3D, realistisches 3D, 2D | Low-Poly 3D: sieht gut aus, läuft flüssig, Assets sind einfach |
| 3D-Engine | Three.js, Babylon.js | Three.js: größte Community, viele Beispiele |
| UI-Framework für Menüs und HUD | Vanilla TS, React, Svelte | Svelte oder Vanilla TS: wenig Ballast neben der 3D-Szene |
| Welt | handgebaute Insel, prozedural, echte Gegend aus OSM | handgebaute Insel fürs MVP, prozedural ab Phase 6 |
| Richtungswahl | Tastatur, Gamepad, Handy | Tastatur und Gamepad, Handy später |
| Speicherung | lokal (IndexedDB), eigener Server | lokal; ein Server erst für Multiplayer oder Bestenlisten |
| Betrieb | `npm run dev` lokal, Docker auf eigenem Server mit HTTPS | lokal für den Anfang |
| Name des Spiels | offen | Freeride NG |

## Stand & offene Punkte

**11.11.2026, Phase 1 (ohne Hardware) umgesetzt:** Projekt-Setup, `TrainerDevice`, `KettlerSerialDevice`, `MockDevice`, `PowerLimiter`, Debug-Seite mit Rohdaten-Konsole. 39 Tests grün.

**11.11.2026, Phase 2 umgesetzt:** Ride-Engine (`src/engine/`) mit Physikmodell, virtuellen Gängen (13 Gänge), Modi `sim`/`simple`/`erg`, Glättung und Begrenzung der Zielwatt, feste Taktung (20 Hz Physik, 1 Hz Gerät) über `RideSession`. Die Debug-Seite hat einen Steigungsregler zum Testen des Fahrgefühls. Weltentwurf in `docs/welt.md`. 84 Tests grün.

**11.11.2026, Phase 3 umgesetzt:** Three.js-Szene im Low-Poly-Stil. Das Gelände wird per Noise erzeugt (fester Seed), das Wegenetz ist von Hand gelegt (`src/world/roadLayout.ts`, 20 Knoten, 29 Wege, 19,5 km, max. 10 %). Die Wege werden ins Gelände eingeschnitten, der Fahrer folgt ihnen automatisch und fährt an Kreuzungen geradeaus. Dazu Verfolgerkamera, HUD, Pause, Notstopp und Häuser, Bäume und Schranken an gesperrten Wegenden. Das Spiel liegt unter `/`, die Debug-Seite unter `/debug.html`. Mit `?demo` startet direkt der Simulator. 104 Tests grün.

**11.11.2026, Fahrgefühl angepasst** (vor den ersten Hardwaretests): gleichmäßige Gangabstufung ohne Kettenblattsprung, leichterer Startgang (≈ 20 km/h bei 85 U/min, ≈ 55 W in der Ebene), Schwierigkeit 50 %, weicher Knick über 150 W (nur die Hälfte des Mehrbedarfs zählt), Anstieg der Zielwatt in der Engine max. 10 W/s.

**11.11.2026, Phase 4 umgesetzt (MVP komplett):** Richtungswahl an Kreuzungen mit ←/→ oder Gamepad (Anzeige ab 160 m vor der Kreuzung, Ziele zeigen auf den nächsten benannten Ort), ↓ für eine Kehrtwende. Minimap und große Karte (`M`) mit Erkundungsnebel, 15 Kristalle, 4 Aussichtspunkte und Ortsschilder. Der Spielstand liegt in IndexedDB (Autosave alle 10 s, bei Pause und Ereignissen) und kann im Menü mit „Neu beginnen“ gelöscht werden. Im Modus `?demo` wird nichts geladen oder gespeichert. 133 Tests grün.

Offen aus Phase 4:

- [ ] Speichern und Laden im echten Browser prüfen. Im Headless-Test hängt IndexedDB, dafür gibt es jetzt ein Zeitlimit von 2 s beim Laden
- [ ] Gamepad-Belegung mit dem echten Controller am Lenker testen
- [ ] Detail-Durchgang: Weinreben, Laubbäume, Zäune, Fahrbahnmarkierung, Hafen mit Booten, Kapelle als Wahrzeichen, mehrere Hausformen

Offen aus Phase 3 (Nachbessern):

- [ ] Rebstraße: 34 m hoher Damm, Kapellen- und Waldweg mit bis zu 20 m tiefen Einschnitten. Wege umlegen oder das Gelände dort anpassen
- [ ] Viele Wege erreichen stellenweise das 10-%-Limit. Prüfen, ob sich das beim Fahren gut anfühlt
- [ ] Performance auf schwächerer Hardware messen (Gelände rund 180.000 Dreiecke, Schatten)

Offen aus Phase 2:

- [ ] Fahrgefühl am echten Rad prüfen: Glättung (2 s), Schwierigkeit (Standard 75 %), Gangabstufung
- [ ] Reaktionszeit des E5 auf `PW` messen und Taktung ggf. anpassen

Offen, sobald das USB-Kabel da ist:

- [ ] Phase 0 durchführen. Die Debug-Seite (Modus "Kettler E5 (USB)") ersetzt dabei `screen`/`minicom`: Befehle `ID`, `VE`, `ST`, `RS` senden, `PW` über den Regler, "Mitschnitt speichern"
- [ ] Echte ST-Zeilen als `tests/fixtures/st-lines.e5.txt` ablegen (wird von den Tests automatisch mitgeprüft)
- [ ] Einheiten bestätigen: Tempo ×10? Distanz in 100 m? Energie in kJ?
- [ ] Antwort auf `CM` und `PW` prüfen (ACK/RUN/Statuszeile?). Der Treiber nimmt aktuell an, dass jeder Befehl genau eine Antwortzeile liefert
- [ ] Watt-Grenzen und Schrittweite in `DEFAULT_POWER_LIMITS` anpassen
- [ ] Verhalten bei Verbindungsabbruch testen (Kabel ziehen beim Treten)
