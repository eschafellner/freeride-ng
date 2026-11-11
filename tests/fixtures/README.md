# Test-Fixtures

`st-lines.synthetic.txt` enthält **erfundene** ST-Zeilen im erwarteten Format
anderer Kettler-Modelle. Sie sind ein Platzhalter, bis das USB-Kabel da ist.

Nach Phase 0 (Bauplan): echte Zeilen vom E5 in `st-lines.e5.txt` ablegen,
eine Zeile pro Antwort, Tabulatoren unverändert lassen. Die Debug-Seite hat
dafür einen Button "Mitschnitt speichern". Die Tests in
`tests/kettlerProtocol.test.ts` lesen die Datei automatisch mit, sobald sie existiert.
