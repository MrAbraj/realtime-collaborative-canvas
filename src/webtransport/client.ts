import { encode } from "msgpackr";
import { readCursorStream, readServerStreams } from "./protocol";
import type {
  CursorUpdate,
  GenericElement,
  JoinMetadata,
  RoomEvent,
  RoomSnapshot,
  RoomTransport,
  TransportMetric,
} from "./types";

interface ConnectOptions {
  url: string;
  userName: string;
  avatar: string;
  color: string;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onEvent: (event: RoomEvent) => void;
  onCursor: (cursor: CursorUpdate) => void;
  onError: (error: unknown) => void;
  onMetric?: (metric: TransportMetric) => void;
}

export const connectToRoom = async (
  options: ConnectOptions,
): Promise<RoomTransport> => {
  const {
    url,
    userName,
    avatar,
    color,
    onSnapshot,
    onEvent,
    onCursor,
    onError,
    onMetric = () => undefined,
  } = options;

  if (!("WebTransport" in window)) {
    throw new Error("WebTransport is not supported by this browser.");
  }

  const transport = new WebTransport(url);
  await transport.ready;

  let closed = false;
  let userId = "";
  let sendQueue = Promise.resolve();

  await sendJoin(transport, userName, avatar, color, onMetric);

  void readServerStreams(
    transport,
    (snapshot) => {
      userId = snapshot.user_id;
      onSnapshot(snapshot);
    },
    onEvent,
    onMetric,
  ).catch((error) => {
    if (!closed) onError(error);
  });

  void readCursorStream(transport, onCursor, onMetric, () => closed, onError);

  transport.closed.catch((error) => {
    if (!closed) onError(error);
  });

  return {
    get userId() {
      return userId;
    },

    sendElement(element) {
      sendQueue = sendQueue.then(() =>
        sendElement(transport, element, onMetric, () => closed),
      );

      return sendQueue;
    },

    sendCursor(x, y) {
      return sendCursor(
        transport,
        userId,
        userName,
        x,
        y,
        onMetric,
        () => closed,
      );
    },

    close() {
      closed = true;
      transport.close();
    },
  };
};

const sendJoin = async (
  transport: WebTransport,
  userName: string,
  avatar: string,
  color: string,
  report: (metric: TransportMetric) => void,
) => {
  const stream = await transport.createUnidirectionalStream();
  const writer = stream.getWriter();

  const data = encode({
    user_name: userName,
    avatar,
    color,
  } satisfies JoinMetadata);

  try {
    await writer.write(data);
    report({ type: "bytesSent", bytes: data.byteLength });
  } finally {
    await writer.close();
    writer.releaseLock();
  }
};

const sendElement = async (
  transport: WebTransport,
  element: GenericElement,
  report: (metric: TransportMetric) => void,
  isClosed: () => boolean,
) => {
  if (isClosed()) return;

  const stream = await transport.createUnidirectionalStream();
  const writer = stream.getWriter();
  const data = encode(element);

  try {
    await writer.write(data);
    report({ type: "bytesSent", bytes: data.byteLength });
  } finally {
    await writer.close();
    writer.releaseLock();
  }
};

const sendCursor = async (
  transport: WebTransport,
  userId: string,
  name: string,
  x: number,
  y: number,
  report: (metric: TransportMetric) => void,
  isClosed: () => boolean,
) => {
  if (isClosed() || !userId) return;

  const writer = transport.datagrams.writable.getWriter();

  try {
    const data = encode({
      user_id: userId,
      name: name,
      x,
      y,
    } satisfies CursorUpdate);

    await writer.write(data);

    report({ type: "bytesSent", bytes: data.byteLength });
  } finally {
    writer.releaseLock();
  }
};
