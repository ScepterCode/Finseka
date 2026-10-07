import { whatsappLink } from "@/lib/whatsapp";

// FinSeka customer care: a WhatsApp number. Every "talk to us" point opens a chat with it.
export const SUPPORT_WHATSAPP = "08167602397";
export const SUPPORT_WHATSAPP_DISPLAY = "0816 760 2397";

/** A wa.me link to FinSeka customer care, with a first message ready to send. */
export function supportLink(message = "Hello FinSeka, I have a question.") {
  return whatsappLink(SUPPORT_WHATSAPP, message);
}
