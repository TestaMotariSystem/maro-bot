// src/bot.ts — saves every incoming message to SharePoint
import { ActivityHandler, TurnContext } from "botbuilder";
import { getJsonFromSharePoint, uploadJsonToSharePoint } from "./graph";

const MESSAGES_PATH = "01_PROJECT_STATE/Messages.json";

interface SavedMessage {
  id: string;
  conversationId: string;
  from: string;
  aadObjectId?: string;
  text: string;
  timestamp: string;
}

function stripMentions(text: string) {
  return (text || "").replace(/<at>.*?<\/at>/g, "").trim();
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

      const entry: SavedMessage = {
        id: context.activity.id ?? crypto.randomUUID(),
        conversationId: context.activity.conversation?.id ?? "unknown",
        from: context.activity.from?.name ?? "Unknown",
        aadObjectId: (context.activity.from as any)?.aadObjectId,
        text,
        timestamp: new Date().toISOString(),
      };

      try {
        const existing = await getJsonFromSharePoint<SavedMessage[]>(MESSAGES_PATH, []);
        existing.push(entry);
        await uploadJsonToSharePoint(MESSAGES_PATH, existing);
        await context.sendActivity(`Message saved.`);
      } catch (e: any) {
        console.error("Failed to save message:", e);
        await context.sendActivity("Failed to save message to SharePoint.");
      }

      await next();
    });
  }
}
