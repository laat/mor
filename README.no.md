# mor

> [!WARNING]
> Dette er et personlig prosjekt. Jeg vedlikeholder det for eget bruk og deler det fordi andre kan ha nytte av det. Feature-PR-er blir sannsynligvis ikke merget — har du en idé, [start en diskusjon](https://github.com/laat/mor/discussions) først. Fork gjerne — det er MIT-lisensiert.

_Read this in [English](README.md)._

AI-tilgjengelig kunnskap du faktisk eier. **Rene markdown-filer på din egen disk**, søkbare for AI via MCP.

Notatene dine ligger på disken som ren markdown med YAML-frontmatter — lesbare uten mor, portable til ethvert verktøy, og kan synkroniseres med git på tvers av maskiner. MCP-serveren gir AI-assistenter (Claude Code, Claude Desktop, Cursor, osv.) varig minne som overlever kontekstvinduer. Du får også en CLI og et HTTP-API.

## Installasjon

```sh
npm install -g mor
```

Krever Node.js 20+.

## Kom i gang

```sh
# Legg til notater
echo "Bruk alltid snake_case for Python-variabler" | mor add -t "Python-navngiving"
mor add notes.md -t "Møtenotater" --tags "møte,prosjekt-x"
mor add https://raw.githubusercontent.com/owner/repo/main/config.ts

# Søk (FTS5 — tokenisert, stemmet)
mor find python navngiving

# Grep (bokstavelig delstreng eller regex)
mor grep snake_case
mor grep -i todo
mor grep -E "async\s+function"
mor grep -w Beer -n -C 2

# Les, rediger, kopier, fjern
mor cat python navngiving
mor edit python navngiving
mor cp -o ./out.md python navngiving
mor rm python navngiving

# List opp
mor ls
mor ls -l
```

## Kommandoer

| Kommando         | Beskrivelse                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `find <query>`   | Fulltekstsøk (`--limit`, `-s` terskel, `--json`)                                                               |
| `grep <pattern>` | Delstreng- eller regex-søk (`-i`, `-E` regex, `-w` ord, `-n` linjenumre, `-l` bare filer, `-A/-B/-C` kontekst) |
| `add [fil\|url]` | Legg til fra fil, URL, stdin eller `$EDITOR` (`-t` tittel, `-d` beskrivelse, `--tags`, `--type`)               |
| `cat <query>`    | Skriv ut innhold (`--raw` for frontmatter, `--links` for kryssreferanser)                                      |
| `cp <query...>`  | Kopier innhold til fil (`-o <mål>`)                                                                            |
| `edit <query>`   | Åpne i `$EDITOR` (`--raw` for å redigere frontmatter)                                                          |
| `update <query>` | Oppdater metadata eller innhold (`-t` tittel, `-d` beskrivelse, `--tags`, `--type`, `--content-from`)          |
| `patch <query>`  | Bruk en `str_replace`-patch på innholdet i et notat (`--old`, `--new`)                                         |
| `rm <query>`     | Fjern et notat                                                                                                 |
| `links [query]`  | Vis kryssreferanser for et notat (`--broken` for å finne døde lenker)                                          |
| `ls`             | List opp alle (`--limit`, `-l` lang, `--tags`, `--types`)                                                      |
| `sync`           | Pull, commit og push notatmappen via git                                                                       |
| `reindex`        | Bygg søkeindeksen på nytt                                                                                      |
| `import <dir>`   | Importer `.md`-filer fra en mappe                                                                              |
| `mcp`            | Start MCP-server (stdio)                                                                                       |
| `serve`          | Start HTTP-server (`-p` port, `-H` vert, `--token`, `--mcp`)                                                   |
| `login`          | Autentiser mot en ekstern server via OAuth (`-s` server-URL)                                                   |

Spørringer løses i rekkefølge: full UUID, UUID-prefiks (8+ tegn), filnavn, FTS-søk. Spørringer med flere ord trenger ikke anførselstegn — flagg plasseres før spørringen: `mor find --limit 5 python navngiving`.

`find`, `grep` og `ls` støtter felles filtre: `--type`, `--tag`, `--repo`, `--ext` (alle støtter glob-mønstre).

## MCP-server

Legg til i konfigurasjonen for Claude Code eller Claude Desktop:

```json
{
  "mcpServers": {
    "mor": {
      "command": "mor",
      "args": ["mcp"]
    }
  }
}
```

Verktøy: `notes_search`, `notes_read`, `notes_create`, `notes_update`, `notes_patch`, `notes_remove`, `notes_list`, `notes_grep`.

For å sikre at Claude Code sjekker mor først når du ber den huske noe, legg dette i `~/.claude/CLAUDE.md`:

```markdown
## Notes

When the user asks to recall, find, check, or reuse something they previously saved
or remembered — use the `mor` MCP server tools (`notes_search`, `notes_read`,
`notes_list`). This is the user's primary note store containing code snippets,
files, and reference notes. Always check mor before saying something wasn't found.
```

## Ekstern tilgang

Kjør serveren på én maskin, få tilgang fra hvor som helst:

```sh
# Server
mor serve --port 7677 --token mittpassord --mcp
```

### MCP-klienter (Claude Code, Claude Desktop, osv.)

Pek MCP-klienten din mot server-URL-en — ingen hemmelighet i konfigurasjonen:

```json
{
  "mcpServers": {
    "mor": {
      "type": "url",
      "url": "http://mybox.tail1234.ts.net:7677/mcp"
    }
  }
}
```

Klienten oppdager autentisering via `WWW-Authenticate` → OAuth-metadata → passordflyt i nettleseren, helt automatisk.

### CLI-klient

```sh
# OAuth-innlogging — lagrer server-URL i config og legitimasjon i credentials.json
mor login -s http://mybox.tail1234.ts.net:7677

# Alle kommandoer går nå via den eksterne serveren
mor find "python navngiving"
```

Eller konfigurer et direkte token i stedet:

```jsonc
// ~/.config/mor/config.json
{
  "server": {
    "url": "http://mybox.tail1234.ts.net:7677",
    "token": "mittpassord",
  },
}
```

OAuth-tokens fornyes automatisk når de utløper.

### Autentisering

Når `--token` er satt, krever alle ruter autentisering. To metoder fungerer overalt:

- **Bearer-token**: `Authorization: Bearer <passord>` eller `?token=<passord>`
- **OAuth-tilgangstoken**: hentes via OAuth-flyten (`mor login` eller automatisk oppdagelse i MCP-klienten)

Uautentiserte forespørsler får `401` med en `WWW-Authenticate`-header som peker til OAuth-oppdagelsesendepunktet.

### HTTP-API

| Metode   | Sti                                                       | Beskrivelse                                                           |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/health`                                                 | Helsesjekk                                                            |
| `GET`    | `/notes?limit=N&offset=N`                                 | List opp alle                                                         |
| `GET`    | `/notes/search?q=...&limit=N&offset=N`                    | FTS-søk                                                               |
| `GET`    | `/notes/grep?q=...&limit=N&offset=N&ignoreCase=1&regex=1` | Delstreng- eller regex-søk                                            |
| `GET`    | `/notes/:query`                                           | Les ett notat                                                         |
| `GET`    | `/notes/:query/links`                                     | Hent lenker frem og tilbake                                           |
| `POST`   | `/notes`                                                  | Opprett (`{title, content, description?, tags?, type?, repository?}`) |
| `PUT`    | `/notes/:query`                                           | Oppdater (`{title?, description?, content?, tags?, type?}`)           |
| `POST`   | `/notes/:query/patch`                                     | Patch innhold (`{old_str, new_str}`)                                  |
| `DELETE` | `/notes/:query`                                           | Fjern                                                                 |
| `POST`   | `/reindex`                                                | Bygg søkeindeksen på nytt                                             |
| `POST`   | `/sync`                                                   | Git pull, commit, push                                                |
| `POST`   | `/mcp`                                                    | MCP-protokoll (streamable HTTP)                                       |

## Embeddings

Utvid FTS-søket med vektorlikhet (valgfritt). Konfigureres i `config.json`:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Leverandører: `openai` (eller kompatibelt API via `baseUrl`), `azure-openai`, `ollama`. Kjør `mor reindex` etter konfigurering.

Azure OpenAI bruker `AZURE_OPENAI_API_KEY` (eller `apiKey` i config) og krever et `deployment`-navn (standard er modellnavnet).

## Lagring

Notater er markdown-filer med YAML-frontmatter, fordelt på [XDG-kataloger](https://specifications.freedesktop.org/basedir-spec/latest/). Sett `MOR_HOME` for én enkelt flat katalog.

```
~/.config/mor/                # konfigurasjon
  config.json
~/.local/share/mor/           # data
  notes/
    python-naming-a1b2.md
    meeting-notes-c3d4.md
~/.local/state/mor/           # tilstand
  index.db                    # søkeindeks
  credentials.json            # OAuth-tokens (mor login)
  oauth.db                    # OAuth-servertokens
```

Filene er lesbare for mennesker og git-vennlige. Bruk `mor sync` for å pulle, committe og pushe hvis notatmappen er et git-repo. Slå på `autosync` for å synkronisere automatisk etter hver add, update eller remove:

```json
{
  "autosync": true
}
```

## Lisens

MIT
