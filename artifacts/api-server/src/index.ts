import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "node:http";
import { installRealtime } from "./lib/ludo-realtime";
import { startTurnTimer } from "./lib/ludo-turns";
import { startAiEngine } from "./lib/ludo-ai";
import { startWithdrawalReconciliation } from "./lib/ludo-withdrawals";
import { startFootballEngine } from "./lib/football-manager";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
installRealtime(server);
startTurnTimer();
const stopLudoAi = startAiEngine();
server.on("close", stopLudoAi);
startWithdrawalReconciliation();
const stopFootball = startFootballEngine();
server.on("close", stopFootball);
server.on("error", err => { logger.error({ err }, "Server failed"); process.exit(1); });
server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});
