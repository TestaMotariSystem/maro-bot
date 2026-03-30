import "dotenv/config";
import express from "express";
import {
  CloudAdapter,
  TurnContext,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";
import { MessageLogBot } from "./src/bot";

const app = express();
app.use(express.json());

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(process.env);
const adapter = new CloudAdapter(botFrameworkAuthentication);

adapter.onTurnError = async (context: TurnContext, error: any) => {
  console.error("BOT ERROR:", error);
  await context.sendActivity("The bot hit an error.");
};

const bot = new MessageLogBot();

app.get("/", (_req, res) => {
  res.send("Bot is running");
});

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

app.post("/api/messages", (req, res) => {
  adapter.process(req, res, async (context) => {
    await bot.run(context);
  });
});

const port = Number(process.env.PORT || 3978);
app.listen(port, () => console.log(`Bot listening on port ${port}`));
