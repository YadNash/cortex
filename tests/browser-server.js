import { createApp } from "../server/index.js";
process.env.NODE_ENV = "production";
process.env.LLM_PROVIDER = "demo";
const { app, db } = createApp({
  dbPath: ":memory:",
  secret: "isolated-browser-test-only",
  seed: true,
});
const server = app.listen(4174, "127.0.0.1");
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
