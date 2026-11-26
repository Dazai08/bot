"use strict";
// Minimal Minecraft "server list ping" (no dependencies).
// Used to find out WHY a join isn't working: server offline, wrong address, wrong version...

const net = require("net");
const dns = require("dns");

function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) return null; // need more data
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("VarInt too big");
  }
  return { value: result, size: pos - offset };
}

// Same rule minecraft-protocol uses: default port + hostname => look up the SRV record
function resolveTarget(host, port) {
  return new Promise((resolve) => {
    if (port === 25565 && net.isIP(host) === 0 && host !== "localhost") {
      dns.resolveSrv("_minecraft._tcp." + host, (err, addrs) => {
        if (!err && addrs && addrs.length > 0) {
          resolve({ host: addrs[0].name, port: addrs[0].port });
        } else {
          resolve({ host, port });
        }
      });
    } else {
      resolve({ host, port });
    }
  });
}

function pingServer(host, port, timeoutMs = 8000) {
  return resolveTarget(host, Number(port) || 25565).then(
    (t) =>
      new Promise((resolve, reject) => {
        let done = false;
        let data = Buffer.alloc(0);
        const socket = net.connect({ host: t.host, port: t.port });
        const finish = (err, res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          socket.destroy();
          if (err) reject(err);
          else resolve(res);
        };
        const timer = setTimeout(
          () => finish(new Error(`no reply within ${timeoutMs / 1000}s`)),
          timeoutMs,
        );

        socket.on("error", (e) => finish(e));
        socket.on("close", () =>
          finish(new Error("connection closed before the server replied")),
        );

        socket.on("connect", () => {
          const hostBuf = Buffer.from(t.host, "utf8");
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(t.port);
          // protocol -1 => ask the server to report its own native version
          const handshake = Buffer.concat([
            writeVarInt(0x00),
            writeVarInt(-1),
            writeVarInt(hostBuf.length),
            hostBuf,
            portBuf,
            writeVarInt(1),
          ]);
          socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]));
          socket.write(Buffer.from([0x01, 0x00])); // status request
        });

        socket.on("data", (chunk) => {
          data = Buffer.concat([data, chunk]);
          if (data.length > 2 * 1024 * 1024) return finish(new Error("reply too large"));
          try {
            const len = readVarInt(data, 0);
            if (!len || data.length < len.size + len.value) return; // wait for more
            const body = data.subarray(len.size, len.size + len.value);
            const id = readVarInt(body, 0);
            if (!id || id.value !== 0x00) {
              return finish(new Error("unexpected reply from server (not a Minecraft server?)"));
            }
            const strLen = readVarInt(body, id.size);
            if (!strLen) return finish(new Error("malformed status reply"));
            const start = id.size + strLen.size;
            finish(null, JSON.parse(body.subarray(start, start + strLen.value).toString("utf8")));
          } catch (e) {
            finish(e);
          }
        });
      }),
  );
}

function stripColors(s) {
  return String(s == null ? "" : s).replace(/§[0-9a-fk-or]/gi, "");
}

function chatToText(c) {
  if (c == null) return "";
  if (typeof c === "string") return stripColors(c);
  if (Array.isArray(c)) return c.map(chatToText).join("");
  let out = typeof c.text === "string" ? c.text : "";
  if (!out && typeof c.translate === "string") out = c.translate;
  if (Array.isArray(c.extra)) out += c.extra.map(chatToText).join("");
  return stripColors(out);
}

const NOT_READY = /offline|starting|loading|preparing|saving|stopping|queue|waiting|restarting/i;

function describeStatus(status) {
  const versionName = stripColors(status && status.version && status.version.name).trim();
  const protocol =
    status && status.version && typeof status.version.protocol === "number"
      ? status.version.protocol
      : null;
  const players = (status && status.players) || {};
  const motd = chatToText(status && status.description).replace(/\s+/g, " ").trim();
  const max = typeof players.max === "number" ? players.max : null;
  // Aternos shows its state ("Offline", "Starting", ...) in the version name
  const notReady =
    NOT_READY.test(versionName) || (max === 0 && NOT_READY.test(motd));
  return {
    versionName: versionName || "unknown",
    protocol,
    online: players.online == null ? "?" : players.online,
    max: max == null ? "?" : max,
    motd,
    notReady,
  };
}

module.exports = { pingServer, describeStatus, chatToText };
