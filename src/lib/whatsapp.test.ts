import { describe, expect, it } from "vitest";

import { reminderMessage, whatsappLink, whatsappNumber } from "./whatsapp";

describe("whatsappNumber", () => {
  it("converts local Nigerian numbers", () => {
    expect(whatsappNumber("0803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("0706-123-4567")).toBe("2347061234567");
    expect(whatsappNumber("8031234567")).toBe("2348031234567");
  });

  it("keeps international forms", () => {
    expect(whatsappNumber("+234 803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("002348031234567")).toBe("2348031234567");
  });

  it("rejects things that are not Nigerian mobile numbers", () => {
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber("+44 7700 900123")).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("opens a chat with the message ready", () => {
    expect(whatsappLink("0803 123 4567", "Hi & bye")).toBe(
      "https://wa.me/2348031234567?text=Hi%20%26%20bye",
    );
  });

  it("lets WhatsApp ask who to send to when there is no number", () => {
    expect(whatsappLink(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("reminderMessage", () => {
  it("is short, polite and uses the first name", () => {
    expect(
      reminderMessage({
        memberName: "Chinedu Okeke",
        orgName: "Umuahia Town Union",
        what: "Monthly dues (Sep 2026)",
        amount: 1000,
      }),
    ).toBe(
      "Hello Chinedu, this is a friendly reminder from Umuahia Town Union: ₦1,000 is still outstanding for Monthly dues (Sep 2026). Please pay when you can. Thank you!",
    );
  });
});
