// src/bot.ts — saves every incoming message to a daily file in SharePoint
import { ActivityHandler, TurnContext } from "botbuilder";
import { getJsonFromSharePoint, uploadJsonToSharePoint } from "./graph";

interface MessageEntry {
  user: string;
  time: string;
  message: string;
}

function stripMentions(text: string) {
  return (text || "").replace(/<at>.*?<\/at>/g, "").trim();
}

function todayFileName(): string {
  const date = new Date().toISOString().slice(0, 10); // 2026-04-01
  return `${date}.json`;
}

export class MessageLogBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context: TurnContext, next) => {
      const text = stripMentions(context.activity.text ?? "");
      if (!text) {
        await next();
        return;
      }

      const entry: MessageEntry = {
        user: context.activity.from?.name ?? "Unknown",
        time: new Date().toISOString(),
        message: text,
      };

      const filePath = todayFileName();

      try {
        const existing = await getJsonFromSharePoint<MessageEntry[]>(filePath, []);
        existing.push(entry);
        await uploadJsonToSharePoint(filePath, existing);
        await context.sendActivity("Message saved.");
      } catch (e: any) {
        console.error("Failed to save message:", e);
        await context.sendActivity("Failed to save message to SharePoint.");
      }

      await next();
    });
  }
}
