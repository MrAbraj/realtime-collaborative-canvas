export type CursorMarker = {
  user_id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  lastSeen: number;
};

export type Participant = {
  userId: string;
  name: string;
  avatar: string;
  color: string;
};

export type ConnectionDetails = {
  roomName: string;
  userName: string;
};

export type ConnectionMetrics = {
  state: "idle" | "connecting" | "connected" | "error" | "closed";
  startedAt: number | null;
  bytesSent: number;
  bytesReceived: number;
  eventStreamBytesReceived: number;
  datagramBytesReceived: number;
  eventsReceived: number;
  invalidMessages: number;
  sceneUpdatesApplied: number;
  lastSceneApplyMs: number | null;
  maxSceneApplyMs: number;
};
