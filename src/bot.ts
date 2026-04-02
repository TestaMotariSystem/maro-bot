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

function germanNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
}

function todayFileName(): string {
  const d = germanNow();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.json`;
}

function germanTimeString(): string {
  return new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
        time: germanTimeString(),
        message: text,
      };

      const filePath = todayFileName();

      try {
        const existing = await getJsonFromSharePoint<MessageEntry[]>(filePath, []);
        existing.push(entry);
        await uploadJsonToSharePoint(filePath, existing);
      } catch (e: any) {
        console.error("Failed to save message:", e);
      }

      await next();
    });
  }
}
