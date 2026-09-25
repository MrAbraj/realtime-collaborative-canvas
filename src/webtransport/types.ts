import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type GenericElement = OrderedExcalidrawElement & {
  id: string;
  version: number;
};

export type CursorUpdate = {
  user_id: string;
  name: string;
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
  | {
      type:
        | "bytesSent"
        | "bytesReceived"
        | "eventStreamBytes"
        | "datagramBytes";
      bytes: number;
    }
  | {
      type:
        | "eventReceived"
        | "invalidMessage"
        | "remoteElementReceived"
        | "eventHandled"
        | "invalidMessage";
    }
  | {
      type: "dispatch" | "sceneApplied";
      durationMs: number;
    };
