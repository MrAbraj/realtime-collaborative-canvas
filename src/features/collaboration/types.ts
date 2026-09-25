import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ConnectionMetrics } from "../../components/ConnectionStats";

export type CanvasApi = {
  updateScene: (scene: { elements: readonly OrderedExcalidrawElement[]; captureUpdate?: unknown }) => void;
  getSceneElementsIncludingDeleted: () => readonly OrderedExcalidrawElement[];
  getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number } };
};

export type CursorMarker = {
  user_id: string;
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

export type CollaborationMetrics = ConnectionMetrics;
