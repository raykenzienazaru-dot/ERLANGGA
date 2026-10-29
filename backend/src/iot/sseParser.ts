export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export type SseEventCallback = (event: SseEvent) => void;

/**
 * Robust, standards-compliant Server-Sent Events (SSE) stream parser.
 * Handles:
 * - Incremental UTF-8 multibyte boundary decoding
 * - LF (\n), CRLF (\r\n), and standalone CR (\r) line delimiters
 * - CRLF sequences split across arbitrary chunk boundaries
 * - Multiple data: lines concatenated with newlines
 * - Comment/heartbeat lines (starting with ':')
 * - Bounded buffer protection (resets if unparsed buffer exceeds maxBufferBytes)
 */
export class SseStreamParser {
  private decoder = new TextDecoder('utf-8');
  private buffer = '';
  private currentEvent = 'message';
  private currentDataLines: string[] = [];
  private currentId?: string;
  private onEvent: SseEventCallback;
  private maxBufferBytes: number;

  constructor(onEvent: SseEventCallback, maxBufferBytes = 65536) {
    this.onEvent = onEvent;
    this.maxBufferBytes = maxBufferBytes;
  }

  /**
   * Feeds a binary or string network chunk into the parser state machine.
   */
  public feed(chunk: Uint8Array | ArrayBuffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buffer += text;

    if (this.buffer.length > this.maxBufferBytes) {
      // Buffer exceeded safety limit without event termination; reset to prevent OOM
      this.reset();
      return;
    }

    this.processBuffer(false);
  }

  /**
   * Flushes any remaining bytes in the decoder at stream end and resolves trailing CR.
   */
  public flush(): void {
    const remaining = this.decoder.decode();
    if (remaining.length > 0) {
      this.buffer += remaining;
    }
    this.processBuffer(true);
    // Process final trailing event if buffer has data
    if (this.currentDataLines.length > 0) {
      this.dispatchCurrentEvent();
    }
  }

  private reset(): void {
    this.buffer = '';
    this.currentEvent = 'message';
    this.currentDataLines = [];
    this.currentId = undefined;
  }

  private processBuffer(isFlush = false): void {
    let index = 0;
    while (index < this.buffer.length) {
      // Look for next line break: \r\n, \n, or \r
      const nlIdx = this.buffer.indexOf('\n', index);
      const crIdx = this.buffer.indexOf('\r', index);

      let lineEnd = -1;
      let delimiterLength = 1;

      if (nlIdx !== -1 && (crIdx === -1 || nlIdx < crIdx)) {
        // Line terminates with \n
        lineEnd = nlIdx;
        delimiterLength = 1;
      } else if (crIdx !== -1 && (nlIdx === -1 || crIdx < nlIdx)) {
        // Line starts with \r: check if followed by \n
        if (crIdx + 1 === this.buffer.length) {
          if (!isFlush) {
            // \r is at the very end of chunk! Wait for next chunk to determine if it's \r\n or standalone \r
            break;
          }
          // If flushing at EOF, treat trailing \r as standalone \r delimiter
          lineEnd = crIdx;
          delimiterLength = 1;
        } else {
          lineEnd = crIdx;
          if (this.buffer[crIdx + 1] === '\n') {
            delimiterLength = 2; // \r\n
          } else {
            delimiterLength = 1; // standalone \r
          }
        }
      } else {
        // No line break in remaining buffer
        break;
      }

      const line = this.buffer.slice(index, lineEnd);
      index = lineEnd + delimiterLength;

      this.processLine(line);
    }

    // Retain unparsed portion of buffer
    this.buffer = this.buffer.slice(index);
  }

  private processLine(line: string): void {
    if (line === '') {
      // Blank line: event delimiter
      if (this.currentDataLines.length > 0) {
        this.dispatchCurrentEvent();
      }
      this.currentEvent = 'message';
      this.currentId = undefined;
      return;
    }

    if (line.startsWith(':')) {
      // Comment / ping heartbeat line: ignore
      return;
    }

    const colonIdx = line.indexOf(':');
    let field = line;
    let value = '';

    if (colonIdx !== -1) {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      // If value starts with a space, strip the leading space per SSE spec
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
    }

    if (field === 'event') {
      this.currentEvent = value;
    } else if (field === 'data') {
      this.currentDataLines.push(value);
    } else if (field === 'id') {
      this.currentId = value;
    }
  }

  private dispatchCurrentEvent(): void {
    const eventPayload: SseEvent = {
      event: this.currentEvent,
      data: this.currentDataLines.join('\n'),
    };
    if (this.currentId !== undefined) {
      eventPayload.id = this.currentId;
    }
    this.currentDataLines = [];
    this.onEvent(eventPayload);
  }
}
