// Starts the Node server and the Vite dev server together, with labeled output.
// If either one stops, the other is stopped too, so you never end up with half the app running.
import { spawn } from "node:child_process";

const procs = [
  { name: "server", color: 36, cmd: "node", args: ["--watch", "server.js"], cwd: "." },
  { name: "client", color: 35, cmd: "npm", args: ["run", "dev"], cwd: "client" },
];

const children = procs.map(p => {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, env: process.env, shell: process.platform === "win32" });
  const tag = `\x1b[${p.color}m[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", d => {
      buf += d;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", code => {
    console.log(`${tag}stopped (exit code ${code}). Stopping everything.`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
