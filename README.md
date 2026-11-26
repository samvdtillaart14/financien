# Huishoudfinanciën (offline app)

Persoonlijk financieel dashboard dat volledig in je eigen browser draait. Deze repository bevat **alleen de app-code, geen financiële gegevens**. Je gegevens staan in de opslag van je toestel en, als je sync aanzet, versleuteld (AES-256) in een geheime Gist op je eigen GitHub-account.

## Online zetten (eenmalig)
1. Maak op GitHub een nieuwe repository, bijvoorbeeld `financien` (Public).
2. Upload de inhoud van deze map (niet het back-upbestand!): *Add file → Upload files*, sleep alle bestanden en mappen erin, *Commit changes*.
3. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, Branch **main**, map **/(root)**, *Save*.
4. Na ± 1 minuut staat de app op `https://<jouw-gebruikersnaam>.github.io/financien/`.

## Installeren
- **iPhone (Safari):** open de link → Deel-knop → *Zet op beginscherm*.
- **PC (Chrome of Edge):** open de link → installatie-icoon in de adresbalk (of ⋮ → *App installeren*).

## Eerste keer (op je pc)
1. Open de app → onderaan *App-instellingen* → **Back-up inlezen** → kies `financien-backup-2026-11-26.json`.
2. Vul je **Alpha Vantage-sleutel** in voor live koersen.
3. Voor sync: maak een GitHub-token (zie hieronder) en kies een **sync-wachtwoord** van minstens 10 tekens → *Opslaan op dit toestel*.
4. Verwijder daarna het back-upbestand van je pc of bewaar het op een veilige plek: het is níet versleuteld.

Op je iPhone vul je alleen het token en hetzelfde sync-wachtwoord in; je gegevens komen dan vanzelf binnen.

## GitHub-token voor sync
GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:
- Naam: `financien-sync`, verloopdatum: max. 1 jaar
- *Repository access*: **Public repositories (read-only)**
- *Account permissions* → **Gists: Read and write** (verder niets)

## Hoe sync werkt
- Bij openen, bij terugkeren naar de app, elke 5 minuten en ± 2,5 s na elke wijziging.
- Per onderdeel (maand, stand, instellingen, notitie) wint de nieuwste wijziging.
- Verkeerd wachtwoord? Dan wordt er niets overschreven.

## Pincode
*Menu → Pincode instellen* (4 tot 8 cijfers, per toestel). De app vraagt de pincode bij openen en na wegschakelen (instelbaar: meteen, 1, 5 of 15 minuten). Na 5 foute pogingen moet je wachten, steeds langer. De pincode zelf wordt niet opgeslagen, alleen een hash, en gaat niet mee met de sync.

Pincode vergeten? Dan kun je alleen alle gegevens op dat toestel wissen en ze terugzetten via sync (GitHub-token + sync-wachtwoord) of een back-up.

## Bijwerken
Nieuwe versie van de bestanden uploaden naar dezelfde repository. Je gegevens blijven staan; de app laadt de nieuwe versie bij de volgende keer openen.
