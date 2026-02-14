import { TelegramClient } from "gramjs";
import { StringSession } from "gramjs/sessions/index.js";
import input from "input";

const apiId = Number.parseInt(await input.text("TG_API_ID: "), 10);
const apiHash = await input.text("TG_API_HASH: ");

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5
});

console.log("Починаємо авторизацію Telegram...");

await client.start({
  phoneNumber: async () => input.text("Номер телефону (+380...): "),
  password: async () => input.text("2FA пароль (якщо є): "),
  phoneCode: async () => input.text("Код з Telegram: "),
  onError: (err) => console.error("Auth error:", err)
});

console.log("\nTG_SESSION=");
console.log(client.session.save());

await client.disconnect();
