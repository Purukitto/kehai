# Remote panel

[Documentation](README.md) › Remote panel

The display does not have to hang off the machine being watched. Turn on
**Settings → Remote** and Kehai serves the panel to a browser on another device on the
same network: a tablet, a phone, an old laptop, a Raspberry Pi driving the 10-inch
screen.

- [Pairing](#pairing)
- [What a remote panel can do](#what-a-remote-panel-can-do)
- [When the computer goes away](#when-the-computer-goes-away)
- [Finding the computer again](#finding-the-computer-again)
- [Scripts and the API](#scripts-and-the-api)
- [Security](#security)

## Pairing

1. On the computer running Kehai, open **Settings → Remote** and turn on
   **Serve a remote panel**. Windows may ask whether to let Kehai through its firewall
   the first time; allow it on private networks.
2. Under **Pair a tablet or phone**, press **Show code**.
3. Scan the code with the other device's camera, or press **Copy link** and open the
   link there.

Either pairs by itself: the link carries a key, which the remote panel keeps and takes
out of the address bar. A device where opening a link is awkward can paste the link or
the key into the prompt the panel shows instead.

The code holds the key too, and a desk panel sits in plain view, so the code stays
covered until you ask for it and covers itself again after two minutes, on **Hide**,
or when Settings closes.

Settings lists this computer's network adapters with real ones first. A virtual one,
such as WSL's or a virtual machine's, is marked **VIRTUAL**, since nothing else on the
network can reach it. Pick another address and the code and link follow.

**New key** cuts off every remote panel at once. Each then needs the new code or link.

## What a remote panel can do

A remote panel has its own layout and theme, kept in its own browser, and picks the
landscape, bar or portrait arrangement for its own screen.

It only reads unless **Allow control** is on, and even then it can only press the
buttons the panel has: play, skip and seek, the volume, dismissing a notification, and
starting or pausing the focus timer. It can never change a setting, name a file or
start an update. The header says `REMOTE`, `REMOTE · VIEW ONLY`, or why it is not
connected.

## When the computer goes away

When the computer stops answering — asleep, off, or off the network — every tile dims,
the header says `REMOTE · OFFLINE SINCE` and the time, and a card says when the panel
last heard from it and when it tries again. An old reading never passes for a live
one.

The panel notices within a minute even when the computer goes to sleep without saying
goodbye, and comes back by itself when the computer answers again. It retries quickly
at first, then every 30 seconds.

## Finding the computer again

While it serves, Kehai announces itself on the local network over mDNS, the way
printers and speakers are found: this computer's name and the port, never the key. A
paired device that knows the name can find the computer again after the router hands
it a new address. The link and the code carry the same name. Turn the remote panel off
and the announcement stops.

## Scripts and the API

The same port answers to scripts, with the key as a bearer token:

```bash
curl -H "Authorization: Bearer $KEY" http://192.168.1.20:5280/api/topics
```

| Route | Does |
| --- | --- |
| `GET /api/topics` | Every topic's last envelope, by topic |
| `GET /api/topics/<topic>` | One topic's last envelope, e.g. `/api/topics/telemetry:cpu` |
| `POST /api/command/<topic>` | A command a remote panel could send, as JSON — `{"action":"start"}` to `flow:command` — when control is on |
| `ws://…/bus` | The live bus. Send `{"type":"hello","key":"…"}` first |

Every envelope has the same shape; see [Architecture](architecture.md#the-bus).

## Security

It is plain HTTP, so the key and everything the panel shows, notifications included,
cross your network unencrypted. Use it on a network you trust. HTTPS is on the list of
things [not built yet](../README.md#not-built-yet).

What the server will and will not do is set out in [SECURITY.md](../SECURITY.md).
