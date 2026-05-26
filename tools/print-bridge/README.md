# Celsius local print bridge

Small HTTP listener that forwards ESC/POS print jobs from the
browser-side POS / customer-display / pickup KDS to physical
thermal printers on the LAN.

```
┌───────────────────────────────┐         ┌──────────────────┐
│ pos.celsiuscoffee.com         │   HTTP  │ This bridge      │   TCP/9100
│ order.celsiuscoffee.com/staff │ ──────▶ │ localhost:8080   │ ──────────▶ Bar printer
│ (Capacitor WebView / browser) │  /print │ ESC/POS encoder  │             Counter printer
└───────────────────────────────┘         └──────────────────┘             Kitchen printer
```

**Why this exists.** Browsers can't talk to network thermal printers
directly. The POS sends each kitchen docket to `localhost:8080/print`
with the target printer's IP + station baked in (from the
`pos_printer_config` table). This bridge runs on the same device,
opens a raw TCP socket to the printer, and pipes ESC/POS bytes.

**Zero dependencies.** Only Node built-ins (`http`, `net`, `fs`).
Works on Linux/macOS/Windows/Android (Termux). About 200 LOC total.

## Run

```bash
cd tools/print-bridge
node server.js
```

You should see:
```
[bridge] Loaded 0 printer(s) from printers.json
[bridge] Listening on http://127.0.0.1:8080
```

Health check:
```bash
curl http://localhost:8080/health
# → {"ok":true,"printers":[],"version":"1.0.0"}
```

Test print (will fail with 404 unless either `printers.json` is set
up for the `bar` station OR the request includes an `ip`):
```bash
curl -X POST http://localhost:8080/print \
  -H 'Content-Type: application/json' \
  -d '{"printer":"bar","ip":"192.168.1.100","port":9100,"data":"** TEST **\nHello\n** END **"}'
```

## Config

Two ways to resolve a printer:

1. **Database-driven (preferred)**: rows in `pos_printer_config` set in
   the BO at `backoffice.celsiuscoffee.com/pos/printers`. The POS
   reads those configs and includes `ip`+`port` in every request to
   the bridge. The bridge just forwards.

2. **Local fallback**: copy `printers.example.json` → `printers.json`
   and fill in the LAN IPs. Used when a request omits `ip` — dev
   testing, or before a printer is added in the BO. The file is
   watched and reloaded every 5s, so edits don't require a restart.

`printers.json` keys are lower-cased station names (`bar`, `counter`,
`kitchen`). Add or rename freely — the POS sends `printer:` lower-
cased too.

## Deployment per outlet

### Option A: SUNMI D3 (Android) via Termux

The SUNMI runs Android. Termux gives us a real Node runtime without
root.

```bash
# 1. Install Termux from F-Droid (Play Store version is outdated)
# 2. In Termux:
pkg update && pkg upgrade
pkg install nodejs git termux-services

# 3. Pull the bridge
git clone https://github.com/celsiuscoffee/celsius-inventory.git ~/celsius
cd ~/celsius/tools/print-bridge
cp printers.example.json printers.json  # then edit with real IPs

# 4. Boot it once to test
node server.js
# In another Termux session: curl localhost:8080/health

# 5. Autostart on boot (Termux:Boot app required)
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/print-bridge.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd /data/data/com.termux/files/home/celsius/tools/print-bridge
exec node server.js > $HOME/print-bridge.log 2>&1
EOF
chmod +x ~/.termux/boot/print-bridge.sh
```

Reboot the SUNMI to verify the bridge comes up on its own. Check
`~/print-bridge.log` for output.

### Option B: Mac/Linux/Windows dev machine

```bash
cd tools/print-bridge
cp printers.example.json printers.json   # edit IPs
node server.js
```

For long-running on a server, wrap with `pm2`, `systemd`, or a
launchctl plist.

### Option C: pkg-built single binary

For a no-Node-required deployment (handy on locked-down POS hosts):

```bash
npx pkg server.js --output celsius-print-bridge
# → ~50MB self-contained executable
```

Drop the binary on the POS, copy `printers.json` next to it, run it.

## Wire-level details

- **Listen**: `127.0.0.1:8080` (loopback only — not LAN-reachable so
  random devices on the WiFi can't fire jobs at every printer).
- **Routes**:
  - `POST /print` → forward + return `{ok:true, sent_to:"ip:port"}`
  - `GET /health` → liveness + loaded printer list
- **Timeout**: 4 seconds per TCP send. A downed printer surfaces as a
  500 to the caller within that window; the POS treats it as a soft
  failure and falls back to the SUNMI built-in printer.
- **ESC/POS prologue**: `ESC @` (init) + `ESC a 0` (left align). The
  POS already pre-formats the docket as 32-col plain text, so we
  don't apply fancy fonts here. Epilogue: 3-line feed + full cut.
- **Charset**: UTF-8. Most thermal printers default to CP437/Korean
  if you don't set a code page — if you see garbage on accented
  characters, add `ESC R 0 ESC t 0` to `INIT` in `server.js` to
  force ASCII.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| POS shows "no printer" toast | Bridge isn't running, or the station name in the DB doesn't match `printers.json` keys / `pos_printer_config.station` |
| `health` returns OK, prints don't land | Printer IP wrong, printer offline, or firewall blocking outbound TCP/9100 from POS device |
| Page cuts mid-print | `setTimeout(150)` in `sendToPrinter` may be too short for an older printer — bump to 300ms |
| Garbled characters | Code page mismatch — see Charset note above |
| Bridge dies on Android sleep | Did you run `termux-wake-lock` in the autostart script? |

## Security note

The bridge listens on loopback only and trusts whatever JSON the
caller sends. That's safe on a single-tenant kiosk where the only
process making requests is the POS WebView. If the kiosk runs
untrusted browser tabs, lock down access with a shared token (add a
`PRINT_BRIDGE_TOKEN` env var and check `Authorization` headers).
