# Demand-Test: FixFlix auf fixflix.space

Die Website misst, wie viele Menschen FixFlix wollen, ohne dass ein eigener Server laufen muss:
**GitHub Pages** liefert die Seite aus, **Supabase** (Postgres, Rechenzentrum Frankfurt) speichert
Wartelisten-Einträge und anonyme Besuchs-Zähler. Laufende Kosten: 0 € (plus Domain).

Die Website wird als **eigenes, öffentliches Repo** veröffentlicht. Backend und App bleiben im
privaten Hauptprojekt; `scripts/export-site.sh` kopiert nur die Website heraus.

## 1. Pflichtangaben (vor dem ersten Link nach außen)

1. [`src/config/site.ts`](../src/config/site.ts): Name, Anschrift, E-Mail eintragen.
   Der gelbe Hinweis auf Impressum/Datenschutz verschwindet, sobald kein `TODO` mehr drinsteht.
2. Datenschutz-Text (`src/i18n/de.json` → `legal.privacy`) einmal rechtlich prüfen lassen.
   Er beschreibt GitHub Pages, Supabase, die Zähler und den Missbrauchsschutz so, wie sie tatsächlich arbeiten.
3. Auftragsverarbeitungsvertrag (DPA) mit Supabase: Er ist Bestandteil der Supabase-Nutzungsbedingungen
   und gilt für jede Organisation automatisch, unterschreiben musst du nichts. Für deine Unterlagen
   DPA und TIA unter „Legal Documents" in den Organisations-Einstellungen herunterladen und ablegen.

## 2. Supabase einrichten (10 Minuten)

1. [supabase.com](https://supabase.com) → anmelden (am einfachsten mit „Continue with GitHub") →
   beim ersten Mal eine Organisation anlegen (Typ *Personal*, Plan *Free*).
2. **New project**: Name `fixflix`, Datenbank-Passwort erzeugen lassen und im Passwort-Manager
   speichern, Region **Central EU (Frankfurt)**. Falls das Formular Data-API-Optionen zeigt: Data API
   **an**, Schema `public`. „Automatically expose new tables" darf aus bleiben — das Skript gibt
   Besuchern ausdrücklich nur die drei Funktionen frei. Warten, bis das Projekt bereit ist (1–2 Minuten).
3. **SQL Editor** → neue Abfrage → kompletten Inhalt von [`supabase/schema.sql`](../supabase/schema.sql)
   einfügen → **Run**. Warnt Supabase vor „destructive operations", bestätigen: Das Skript entzieht
   Besuchern nur Rechte und löscht keine Daten. Ein zweiter Lauf schadet nicht.
4. Oben **Connect** (oder **Project Settings → API Keys**): *Project URL* und den *publishable* Key
   (`sb_publishable_…`, alt: *anon public* `eyJ…`) kopieren. Beides ist öffentlich gedacht. Den
   *secret*-Key (`sb_secret_…`/`service_role`) niemals in die Website eintragen.
5. Im Dashboard **keine** zusätzlichen Policies oder Rechte für Tabellen anlegen — der Schutz
   besteht genau darin, dass Besucher keine Tabelle direkt erreichen (siehe Abschnitt 7).

## 3. Website-Repo erzeugen und auf GitHub bringen

**a) Website exportieren** (im Hauptprojekt, Terminal):

```bash
scripts/export-site.sh ~/Desktop/fixflix-web
```

**b) Repo auf GitHub anlegen:** Name `fixflix-web`, **Public**, *ohne* README, .gitignore und Lizenz
(sonst lässt sich der erste Push nicht ohne Weiteres hochladen).

**c) Absender-Adresse festlegen:** Jeder Commit in einem öffentlichen Repo zeigt Name und E-Mail.
Unter GitHub → Settings → Emails „Keep my email addresses private" aktivieren und die dort angezeigte
`…@users.noreply.github.com`-Adresse für dieses Repo verwenden (Befehle unten).

**d) Hochladen** (im Export-Ordner):

```bash
cd ~/Desktop/fixflix-web
git init -b main
git config user.name "Laurenz Hofer"
git config user.email "<deine-noreply-adresse>@users.noreply.github.com"
git add -A && git commit -m "FixFlix website"
git remote add origin https://github.com/laurenzhofer55555-droid/fixflix-web.git
git push -u origin main
```

**e) Pages einschalten:** Repo → **Settings → Pages → Source: GitHub Actions**. Dann
**Settings → Secrets and variables → Actions → Variables** (nicht „Secrets") anlegen:
`VITE_SUPABASE_URL` (z. B. `https://abcdefghijklmnopqrst.supabase.co`) und `VITE_SUPABASE_ANON_KEY`
(beginnt mit `sb_publishable_` oder `eyJ`) — die echten Werte, ohne spitze Klammern. Danach
**Actions → Deploy site to GitHub Pages → Run workflow**. Vor dem Veröffentlichen fragt der Workflow
einmal bei Supabase an; stimmen URL, Schlüssel oder das Schema-Skript nicht, bricht er mit einer
Meldung ab, die sagt, was fehlt, statt eine Seite zu veröffentlichen, die keine Anmeldungen speichern kann.

**Spätere Änderungen:** im Hauptprojekt ändern, `scripts/export-site.sh ~/Desktop/fixflix-web`
erneut ausführen, im Export-Ordner committen und pushen. Ein bestehender Export wird aktualisiert,
sein `.git` bleibt erhalten.

## 4. Eigene Domain fixflix.space (INWX)

**DNS bei INWX** (Nameservereinträge für `fixflix.space`):

| Aktion | Name | Typ | Wert |
|---|---|---|---|
| löschen | `*` | A | 185.181.104.242 (INWX-Parkseite) |
| löschen | *(leer)* | A | 185.181.104.242 |
| löschen | `www` | A | 185.181.104.242 |
| anlegen | *(leer)* | A | 185.199.108.153 |
| anlegen | *(leer)* | A | 185.199.109.153 |
| anlegen | *(leer)* | A | 185.199.110.153 |
| anlegen | *(leer)* | A | 185.199.111.153 |
| anlegen | `www` | CNAME | `laurenzhofer55555-droid.github.io` |

NS- und SOA-Einträge bleiben unverändert. Den Platzhalter `*` zu entfernen ist wichtig: Wildcard-Einträge
auf eine GitHub-Pages-Seite erlauben im schlimmsten Fall, dass Fremde Subdomains übernehmen.

**Bei GitHub:**

1. Profil → **Settings → Pages → Add a domain** → `fixflix.space` → den angezeigten TXT-Eintrag bei INWX
   anlegen → **Verify**. Damit kann niemand sonst die Domain für eine eigene Pages-Seite nutzen.
2. Repo `fixflix-web` → **Settings → Pages → Custom domain**: `fixflix.space` → Save. Sobald der
   DNS-Check grün ist (Minuten bis wenige Stunden), **Enforce HTTPS** anhaken.

Die Seite liegt dann unter `https://fixflix.space/`, `www.fixflix.space` leitet dorthin um.
Der Build erkennt die Domain automatisch, es ist nichts im Code anzupassen.

## 5. Die Zahlen lesen

Supabase → **SQL Editor**:

```sql
select * from demand_overview;      -- Anmeldungen gesamt, Kunden/Helfer, "würde App nutzen" in %
select * from demand_conversion;    -- Besuche → Funnel-Start → Anmeldung, Abschlussquoten
select * from demand_by_source;     -- welcher Kanal bringt Anmeldungen (utm_source)
select * from demand_by_category;   -- welche Tätigkeiten gefragt/angeboten werden
select * from demand_by_region;     -- PLZ-Regionen (erste 2 Ziffern)
select * from demand_by_hour;       -- Anmeldungen pro Stunde, letzte 48 h (Spam fällt als Spitze auf)
```

Einzelne Einträge: **Table Editor → leads**, CSV-Export dort per Knopfdruck. Freitexte, die mit
`=`, `+`, `-` oder `@` beginnen, bekommen ein vorangestelltes `'`, damit Excel sie nicht als Formel ausführt.

## 6. Traffic messen

Links mit Quelle teilen, dann taucht der Kanal in `demand_by_source` auf:

```
https://fixflix.space/?utm_source=instagram
https://fixflix.space/?utm_source=nachbarschaft-flyer
```

Ohne Parameter wird der Referrer-Host erfasst (z. B. `l.instagram.com`) oder `direct`.

## 7. Schutz vor Spam, Manipulation und Überlastung

Der öffentliche Schlüssel steckt zwangsläufig im Website-Code. Jede Prüfung, die nur auf der Website
stattfände, ließe sich also umgehen. Deshalb sitzen alle verbindlichen Regeln **in der Datenbank**:

| Angriff | Schutz |
|---|---|
| Daten mit dem öffentlichen Schlüssel lesen, ändern, löschen | Besucher haben keinerlei Rechte auf Tabellen und Auswertungen. Erreichbar sind nur drei Funktionen: Puzzle holen, Anmeldung abgeben, Besuch zählen. |
| Massenhaft Anmeldungen per Skript | Höchstens 5 pro Internetanschluss und Stunde, 300 pro Stunde und 2.000 pro Tag insgesamt. Jede Anmeldung braucht ein frisch gelöstes Puzzle, das nur einmal und nur 15 Minuten gilt. |
| Formular-Bots | „Ich bin kein Roboter"-Haken (Rechenaufgabe im Browser, ohne Drittanbieter, ohne Cookies), unsichtbares Fangfeld, Mindestzeit auf dem letzten Schritt. |
| Kaputte oder bösartige Eingaben (SQL, HTML/Script, Excel-Formeln, Riesen-Texte, falsche Typen) | Jedes Feld wird in der Datenbank geprüft: E-Mail-Format, Postleitzahl, nur die 7 erlaubten Tätigkeiten, Texte bereinigt und auf 500 Zeichen begrenzt, Quelle auf Buchstaben/Ziffern reduziert. |
| Wegwerf-Adressen | Sperrliste in `private.blocked_domains`, erweiterbar. |
| Gefälschte Besuchszahlen, Datenbank volllaufen lassen | Nur bekannte Ereignisse und Seiten werden gezählt, höchstens 40 pro Anschluss und Minute und 20.000 pro Tag; Ereignisse älter als 180 Tage werden gelöscht. |
| Projekt schläft ein | Supabase pausiert Gratis-Projekte nach einer Woche ohne Zugriff; der Workflow „Keep Supabase awake" ruft alle drei Tage einmal an. |

Getestet mit `supabase/tests/run.sh` (braucht Docker): 73 Angriffe direkt in SQL und 28 über die
echte API-Schicht, die Supabase verwendet. Nach jeder Änderung an `schema.sql` erneut laufen lassen.

**Was der Schutz nicht leistet:**

- Das Puzzle kostet einen Browser einen Augenblick und ein Skript nur Millisekunden. Es hält einfache
  Bots ab; gegen gezielte Angriffe wirken die Obergrenzen.
- Wer viele verschiedene Internetanschlüsse kontrolliert, kann bis zur Obergrenze (300 pro Stunde)
  Einträge erzeugen und echte Anmeldungen in dieser Stunde mit „gerade ist viel los" abweisen lassen.
  Für eine Test-Seite ist das unwahrscheinlich. Die wirksame nächste Stufe ist eine Bestätigungs-Mail
  (Double-Opt-In): Dann zählen nur Adressen, deren Besitzer geklickt haben. Mit der eigenen Domain ist
  das jetzt umsetzbar.
- Überlastungsangriffe auf die Server selbst fangen GitHub und Supabase auf Plattformebene ab, nicht dieses Projekt.

**Limits anpassen und Auffälligkeiten prüfen** (SQL Editor):

```sql
update private.config set value = 10 where key = 'lead_per_ip_hour';   -- z. B. bei Messe-WLAN
insert into private.blocked_domains values ('spamdomain.example');
select bucket, window_start, n from private.counters where n > 20 order by n desc limit 20;
delete from public.leads where email like '%@spamdomain.example';     -- Müll nachträglich entfernen
```

Die Zähler enthalten nur einen täglich wechselnden Hash der IP-Adresse und werden nach 48 Stunden gelöscht.

## 8. Wie belastbar sind die Zahlen?

- Ein Eintrag = gültige E-Mail + ausdrückliche Einwilligung + Antwort „würde ich nutzen". Das ist ein
  *Interessens*-Signal, noch keine Zahlungsbereitschaft.
- Doppelte E-Mails zählen einmal je Rolle. Verlässlich sind die Anmeldungen (`demand_overview`);
  die Besuchs-Zähler (`demand_conversion`) sind Richtwerte.
- Echte Validierung entsteht beim nächsten Schritt: Wartelisten-Mail schreiben und schauen, wer antwortet
  oder einen Termin bucht.
- Faustregel (keine Garantie): Bei kalter, bezahlter Reichweite sind einige Prozent Anmelderate ein
  brauchbares Signal; aus dem eigenen Umfeld sind die Quoten deutlich höher und sagen wenig.

## Lokal ausprobieren

Im Website-Ordner:

```bash
cp .env.example .env.local     # VITE_SUPABASE_URL / _ANON_KEY eintragen
npm run dev                    # http://localhost:5173
```

Ohne diese Werte posten die Funnels an die lokale ASP.NET-API (`/api/leads`) und der Roboter-Haken
entfällt. Im Dev-Server werden keine Besuchs-Events gezählt, damit die echten Zahlen sauber bleiben.
