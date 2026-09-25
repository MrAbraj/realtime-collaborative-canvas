import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { pack, unpack } from "msgpackr";

export type GenericElement = OrderedExcalidrawElement & {
  id: string;
  version: number;
};

export type CursorUpdate = {
  user_id: string;
  x: number;
  y: number;
};

export type RoomSnapshot = {
  user_id: string;
  elements: GenericElement[];
};

export type RoomEvent =
  | { UserJoined: ParticipantMetadata }
  | { UserLeft: ParticipantMetadata }
  | { ElementUpdated: { user_id: string; element: GenericElement } };

export type JoinMetadata = {
  user_name: string;
  avatar: string;
  color: string;
};

export type ParticipantMetadata = {
  user_id: string;
  user_name: string;
  avatar?: string;
  color?: string;
  [key: string]: unknown;
};

export type RoomTransport = {
  readonly userId: string;
  sendElement: (element: GenericElement) => Promise<void>;
  sendCursor: (x: number, y: number) => Promise<void>;
  close: () => void;
};

export type TransportMetric =
  | { type: "bytesSent" | "bytesReceived" | "eventStreamBytes" | "datagramBytes"; bytes: number }
  | { type: "eventReceived" | "remoteElementReceived" | "eventHandled" | "invalidMessage" }
  | { type: "dispatch" | "sceneApplied"; durationMs: number };

const MAX_EVENT_SIZE = 16 * 1024 * 1024;
const LOG_PREFIX = "[WebTransport]";

function log(message: string, ...details: unknown[]) {
  console.info(`${LOG_PREFIX} ${message}`, ...details);
}

function warn(message: string, ...details: unknown[]) {
  console.warn(`${LOG_PREFIX} ${message}`, ...details);
}

function errorLog(message: string, ...details: unknown[]) {
  console.error(`${LOG_PREFIX} ${message}`, ...details);
}

function concatBytes(chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readToEnd(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const bytes = concatBytes(chunks);
        log("Stream closed after receiving", bytes.byteLength, "bytes.");
        return bytes;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function isSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<RoomSnapshot>;
  return typeof snapshot.user_id === "string" && Array.isArray(snapshot.elements) && snapshot.elements.every(isElement);
}

function isElement(value: unknown): value is GenericElement {
  if (!value || typeof value !== "object") return false;
  const element = value as Partial<GenericElement>;
  return typeof element.id === "string" && typeof element.version === "number";
}

function describeDecodedValue(value: unknown) {
  if (Array.isArray(value)) return `an array with ${value.length} item(s)`;
  if (value && typeof value === "object") return `an object with keys: ${Object.keys(value).join(", ") || "none"}`;
  return `${typeof value} (${String(value)})`;
}

function normalizeSnapshot(value: unknown): RoomSnapshot | null {
  if (isSnapshot(value)) return value;
  if (Array.isArray(value) && value.every(isElement)) {
    warn("Received legacy Element[] snapshot; server should send { user_id, elements }.");
    return {
      user_id: crypto.randomUUID(),
      elements: value,
    };
  }
  return null;
}

function isRoomEvent(value: unknown): value is RoomEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return "UserJoined" in event || "UserLeft" in event || "ElementUpdated" in event;
}

function isCursor(value: unknown): value is CursorUpdate {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<CursorUpdate>;
  return typeof cursor.user_id === "string" && typeof cursor.x === "number" && typeof cursor.y === "number";
}

async function readLengthPrefixedEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: RoomEvent) => void,
  report: (metric: TransportMetric) => void,
) {
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);
  let eventCount = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.byteLength !== 0) throw new Error("Room event stream ended mid-frame.");
        log("Event stream closed cleanly after", eventCount, "event(s).");
        return;
      }
      report({ type: "bytesReceived", bytes: value.byteLength });
      report({ type: "eventStreamBytes", bytes: value.byteLength });

      const next = new Uint8Array(buffer.byteLength + value.byteLength);
      next.set(buffer);
      next.set(value, buffer.byteLength);
      buffer = next;

      while (buffer.byteLength >= 4) {
        const frameSize = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, false);
        if (frameSize > MAX_EVENT_SIZE) throw new Error("Room event frame is too large.");
        if (buffer.byteLength < frameSize + 4) break;

        let event: unknown;
        try {
          event = unpack(buffer.slice(4, frameSize + 4));
        } catch (error) {
          errorLog("Could not decode event frame.", { frameSize, error });
          throw error;
        }
        buffer = buffer.slice(frameSize + 4);
        if (isRoomEvent(event)) {
          eventCount += 1;
          report({ type: "eventReceived" });
          if ("ElementUpdated" in event) report({ type: "remoteElementReceived" });
          const startedAt = performance.now();
          log("Received room event", eventCount, event);
          onEvent(event);
          report({ type: "eventHandled" });
          report({ type: "dispatch", durationMs: performance.now() - startedAt });
        } else {
          warn("Ignored unknown room event payload.", event);
          report({ type: "invalidMessage" });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readServerStreams(
  transport: WebTransport,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onEvent: (event: RoomEvent) => void,
  report: (metric: TransportMetric) => void,
) {
  const streams = transport.incomingUnidirectionalStreams.getReader();
  try {
    log("Waiting for initial snapshot stream.");
    const snapshotStream = await streams.read();
    if (snapshotStream.done) throw new Error("Room closed before sending a snapshot.");
    log("Initial snapshot stream opened.");
    let snapshot: unknown;
    try {
      const snapshotBytes = await readToEnd(snapshotStream.value);
      report({ type: "bytesReceived", bytes: snapshotBytes.byteLength });
      snapshot = unpack(snapshotBytes);
    } catch (error) {
      throw new Error("Unable to decode the room snapshot as MessagePack.", { cause: error });
    }
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    if (!normalizedSnapshot) {
      throw new Error(`Invalid room snapshot: expected { user_id, elements }, received ${describeDecodedValue(snapshot)}.`);
    }
    log("Decoded room snapshot", {
      userId: normalizedSnapshot.user_id,
      elementCount: normalizedSnapshot.elements.length,
      payload: describeDecodedValue(snapshot),
    });
    onSnapshot(normalizedSnapshot);

    log("Waiting for long-lived event stream.");
    const eventStream = await streams.read();
    if (eventStream.done) throw new Error("Room closed before opening the event stream.");
    log("Long-lived event stream opened.");
    await readLengthPrefixedEvents(eventStream.value, onEvent, report);
  } finally {
    streams.releaseLock();
  }
}

export async function connectToRoom(
  url: string,
  userName: string,
  avatar: string,
  color: string,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onEvent: (event: RoomEvent) => void,
  onCursor: (cursor: CursorUpdate) => void,
  onError: (error: unknown) => void,
  onMetric: (metric: TransportMetric) => void = () => undefined,
): Promise<RoomTransport> {
  log("Connecting", url);
  if (!("WebTransport" in window)) {
    errorLog("WebTransport is not supported by this browser.");
    throw new Error("WebTransport is not supported by this browser.");
  }

  const transport = new WebTransport(url);
  await transport.ready;
  log("Transport is ready.");
  let closed = false;
  let assignedUserId = "";
  let elementSendChain = Promise.resolve();
  let sentCursorCount = 0;
  let receivedCursorCount = 0;
  let warnedBeforeUserId = false;

  const joinStream = await transport.createUnidirectionalStream();
  const joinWriter = joinStream.getWriter();
  const joinPayload = pack({ user_name: userName, avatar, color } satisfies JoinMetadata);
  try {
    log("Sending join metadata", { userName, byteLength: joinPayload.byteLength });
    await joinWriter.write(joinPayload);
    onMetric({ type: "bytesSent", bytes: joinPayload.byteLength });
  } finally {
    await joinWriter.close();
    joinWriter.releaseLock();
  }

  void readServerStreams(transport, (snapshot) => {
    assignedUserId = snapshot.user_id;
    onSnapshot(snapshot);
  }, onEvent, onMetric).catch((error) => {
    if (!closed) {
      errorLog("Server stream processing failed.", error);
      onError(error);
    }
  });

  const datagrams = transport.datagrams.readable.getReader();
  void (async () => {
    try {
      while (!closed) {
        const { value, done } = await datagrams.read();
        if (done) return;
        onMetric({ type: "bytesReceived", bytes: value.byteLength });
        onMetric({ type: "datagramBytes", bytes: value.byteLength });
        let cursor: unknown;
        try {
          cursor = unpack(value);
        } catch (error) {
          errorLog("Could not decode cursor datagram.", { byteLength: value.byteLength, error });
          continue;
        }
        if (isCursor(cursor)) {
          receivedCursorCount += 1;
          if (receivedCursorCount === 1 || receivedCursorCount % 100 === 0) {
            log("Received cursor datagram", receivedCursorCount, cursor);
          }
          onCursor(cursor);
        } else {
          warn("Ignored invalid cursor datagram.", cursor);
          onMetric({ type: "invalidMessage" });
        }
      }
    } catch (error) {
      if (!closed) {
        errorLog("Cursor datagram receiver failed.", error);
        onError(error);
      }
    } finally {
      datagrams.releaseLock();
    }
  })();

  void transport.closed.catch((error) => {
    if (!closed) {
      errorLog("Transport closed unexpectedly.", error);
      onError(error);
    }
  });

  return {
    get userId() {
      return assignedUserId;
    },
    sendElement: async (element) => {
      if (closed) return;
      elementSendChain = elementSendChain.then(async () => {
        if (closed) return;
        const stream = await transport.createUnidirectionalStream();
        const writer = stream.getWriter();
        const bytes = pack(element);
        try {
          log("Sending element", { id: element.id, version: element.version, senderUserId: assignedUserId || "unknown", byteLength: bytes.byteLength });
          await writer.write(bytes);
          onMetric({ type: "bytesSent", bytes: bytes.byteLength });
        } finally {
          await writer.close();
          writer.releaseLock();
        }
        log("Element stream closed", { id: element.id, version: element.version });
      });
      try {
        await elementSendChain;
      } catch (error) {
        errorLog("Element send failed.", { id: element.id, version: element.version, error });
        throw error;
      }
    },
    sendCursor: async (x, y) => {
      if (closed) return;
      if (!assignedUserId) {
        if (!warnedBeforeUserId) {
          warnedBeforeUserId = true;
          warn("Skipped cursor datagram because the server has not assigned a user ID yet.");
        }
        return;
      }
      const writer = transport.datagrams.writable.getWriter();
      try {
        const bytes = pack({ user_id: assignedUserId, x, y } satisfies CursorUpdate);
        await writer.write(bytes);
        onMetric({ type: "bytesSent", bytes: bytes.byteLength });
        sentCursorCount += 1;
        if (sentCursorCount === 1 || sentCursorCount % 100 === 0) {
          log("Sent cursor datagram", sentCursorCount, { x, y, byteLength: bytes.byteLength });
        }
      } catch (error) {
        errorLog("Cursor datagram send failed.", error);
        throw error;
      } finally {
        writer.releaseLock();
      }
    },
    close: () => {
      log("Closing transport.");
      closed = true;
      datagrams.cancel().catch(() => undefined);
      transport.close();
    },
  };
}
