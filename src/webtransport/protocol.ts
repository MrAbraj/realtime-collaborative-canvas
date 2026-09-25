import { pack, unpack } from "msgpackr";
import type {
  CursorUpdate,
  GenericElement,
  ParticipantMetadata,
  RoomEvent,
  RoomSnapshot,
  TransportMetric,
} from "./types";

const MAX_EVENT_SIZE = 16 * 1024 * 1024; // 16 MB

export const encode = (value: unknown) => {
  return pack(value);
};

export const decode = <T>(bytes: Uint8Array): T => {
  return unpack(bytes) as T;
};

export const isSnapshot = (value: unknown): value is RoomSnapshot => {
  if (!value || typeof value !== "object") return false;

  const snapshot = value as Partial<RoomSnapshot>;

  return (
    typeof snapshot.user_id === "string" &&
    Array.isArray(snapshot.elements) &&
    snapshot.elements.every(isElement)
  );
};

export const isRoomEvent = (value: unknown): value is RoomEvent => {
  if (!value || typeof value !== "object") return false;

  const event = value as Record<string, unknown>;

  if ("UserJoined" in event) {
    return isParticipant(event.UserJoined);
  }

  if ("UserLeft" in event) {
    return isParticipant(event.UserLeft);
  }

  if ("ElementUpdated" in event) {
    const update = event.ElementUpdated;

    if (!update || typeof update !== "object") return false;

    const { user_id, element } = update as Record<string, unknown>;

    return typeof user_id === "string" && isElement(element);
  }

  return false;
};

export const isCursor = (value: unknown): value is CursorUpdate => {
  if (!value || typeof value !== "object") return false;

  const cursor = value as Partial<CursorUpdate>;

  return (
    typeof cursor.user_id === "string" &&
    typeof cursor.x === "number" &&
    typeof cursor.y === "number"
  );
};

export const readSnapshot = async (
  stream: ReadableStream<Uint8Array>,
  report: (metric: TransportMetric) => void,
): Promise<RoomSnapshot> => {
  const bytes = await readStream(stream);

  report({ type: "bytesReceived", bytes: bytes.byteLength });

  let value: unknown;

  try {
    value = decode(bytes);
  } catch (error) {
    throw new Error("Unable to decode the room snapshot.", {
      cause: error,
    });
  }

  if (!isSnapshot(value)) {
    throw new Error("Invalid room snapshot.");
  }

  return value;
};

export const readEvents = async (
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: RoomEvent) => void,
  report: (metric: TransportMetric) => void,
) => {
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        if (buffer.byteLength) {
          throw new Error("Room event stream ended mid-frame.");
        }

        return;
      }

      report({ type: "bytesReceived", bytes: value.byteLength });
      report({ type: "eventStreamBytes", bytes: value.byteLength });

      buffer = append(buffer, value);

      while (buffer.byteLength >= 4) {
        const frameSize = new DataView(
          buffer.buffer,
          buffer.byteOffset,
          4,
        ).getUint32(0, false);

        if (frameSize > MAX_EVENT_SIZE) {
          throw new Error("Room event frame is too large.");
        }

        if (buffer.byteLength < frameSize + 4) break;

        const frame = buffer.slice(4, frameSize + 4);
        buffer = buffer.slice(frameSize + 4);

        const event = decodeEvent(frame, report);

        if (!event) {
          report({ type: "invalidMessage" });
          continue;
        }

        report({ type: "eventReceived" });

        if ("ElementUpdated" in event) {
          report({ type: "remoteElementReceived" });
        }

        const startedAt = performance.now();

        onEvent(event);

        report({ type: "eventHandled" });
        report({
          type: "dispatch",
          durationMs: performance.now() - startedAt,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export const readServerStreams = async (
  transport: WebTransport,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onEvent: (event: RoomEvent) => void,
  report: (metric: TransportMetric) => void,
) => {
  const reader = transport.incomingUnidirectionalStreams.getReader();

  try {
    const snapshotStream = await readStreamFrom(reader);

    const snapshot = await readSnapshot(snapshotStream, report);

    onSnapshot(snapshot);

    const eventStream = await readStreamFrom(reader);

    await readEvents(eventStream, onEvent, report);
  } finally {
    reader.releaseLock();
  }
};

export const readCursorStream = async (
  transport: WebTransport,
  onCursor: (cursor: CursorUpdate) => void,
  report: (metric: TransportMetric) => void,
  isClosed: () => boolean,
  onError: (error: unknown) => void,
) => {
  const reader = transport.datagrams.readable.getReader();

  try {
    while (!isClosed()) {
      const { value, done } = await reader.read();

      if (done) return;

      report({ type: "bytesReceived", bytes: value.byteLength });
      report({ type: "datagramBytes", bytes: value.byteLength });

      const cursor = decodeCursor(value);

      if (!cursor) {
        report({ type: "invalidMessage" });
        continue;
      }

      onCursor(cursor);
    }
  } catch (error) {
    if (!isClosed()) onError(error);
  } finally {
    reader.releaseLock();
  }
};

const decodeEvent = (
  bytes: Uint8Array,
  report: (metric: TransportMetric) => void,
): RoomEvent | null => {
  try {
    const value = decode(bytes);
    if (isRoomEvent(value)) {
      return value;
    } else {
      report({ type: "invalidMessage" });
      return null;
    }
  } catch {
    return null;
  }
};

const decodeCursor = (bytes: Uint8Array): CursorUpdate | null => {
  try {
    const value = decode(bytes);
    return isCursor(value) ? value : null;
  } catch {
    return null;
  }
};

const isElement = (value: unknown): value is GenericElement => {
  if (!value || typeof value !== "object") return false;

  const element = value as Partial<GenericElement>;

  return typeof element.id === "string" && typeof element.version === "number";
};

const isParticipant = (value: unknown): value is ParticipantMetadata => {
  if (!value || typeof value !== "object") return false;

  const participant = value as Partial<ParticipantMetadata>;

  return (
    typeof participant.user_id === "string" &&
    typeof participant.user_name === "string"
  );
};

const readStream = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) return concat(chunks);

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
};

const readStreamFrom = async (
  reader: ReadableStreamDefaultReader<ReadableStream<Uint8Array>>,
) => {
  const { value, done } = await reader.read();

  if (done) {
    throw new Error("Room closed before sending the required stream.");
  }

  return value;
};

const append = (a: Uint8Array, b: Uint8Array) => {
  const result = new Uint8Array(a.byteLength + b.byteLength);

  result.set(a);
  result.set(b, a.byteLength);

  return result;
};

const concat = (chunks: Uint8Array[]) => {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);

  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
};
