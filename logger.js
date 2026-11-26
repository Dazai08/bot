const logs = [];

// Accepts several arguments (e.g. addLog("[X] Error:", err.message)) and joins them,
// so callers never lose the second half of a message.
function addLog(...parts) {
  const message = parts
    .map((p) => (typeof p === "string" ? p : p instanceof Error ? p.message : String(p)))
    .join(" ");
  const time = new Date().toLocaleTimeString();
  const formatted = `[${time}] ${message}`;

  console.log(formatted); // still goes to hosting logs

  logs.push(formatted);

  if (logs.length > 300) logs.shift();
}

function getLogs() {
  return logs;
}

module.exports = { addLog, getLogs };
