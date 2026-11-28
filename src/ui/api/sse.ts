/** Server-Sent Events: koding på serveren og trinnvis tolkning i nettleseren (uten EventSource, som bare kan GET). */

/** Én hendelse som tekst. JSON.stringify gir aldri linjeskift, så én data-linje holder. */
export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Kommentarlinje (hjerteslag) som klienten ignorerer. */
export const SSE_HEARTBEAT = ": hjerteslag\n\n";

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Trinnvis tolker: push() tar biter av strømmen slik de kommer (en hendelse kan være delt over
 * flere biter), og kaller onMessage for hver hele hendelse. Følger WHATWG-formatet for event/data.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) onMessage({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (raw: string) => {
    if (raw === "") return dispatch();
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon < 0 ? raw : raw.slice(0, colon);
    let value = colon < 0 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      // Linjer kan slutte med \n, \r\n eller \r. En \r til slutt kan være første halvdel av \r\n.
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = lines.pop() ?? "";
      for (const l of lines) line(l);
    },
    /** Strømmen er slutt: en ufullstendig hendelse uten blank linje til slutt forkastes, som i nettleserne. */
    end() {
      buffer = "";
      event = "";
      data = [];
    },
  };
}
