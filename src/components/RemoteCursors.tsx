import type { CanvasApi, CursorMarker, Participant } from "../features/collaboration/types";

type Props = {
  cursors: Record<string, CursorMarker>;
  participants: Record<string, Participant>;
  api: CanvasApi | null;
};

export default function RemoteCursors({ cursors, participants, api }: Props) {
  if (!api) return null;
  const appState = api.getAppState();
  const zoom = appState.zoom.value;

  return <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none", overflow: "hidden" }}>
    {Object.values(cursors).map((cursor) => {
      const participant = participants[cursor.user_id] ?? { userId: cursor.user_id, name: "Anonymous", avatar: "A", color: cursor.color };
      const left = (cursor.x + appState.scrollX) * zoom;
      const top = (cursor.y + appState.scrollY) * zoom;
      return <div key={cursor.user_id} style={{ position: "absolute", left, top, pointerEvents: "none", transform: "translate(-2px, -2px)" }}>
        <div style={{ width: 0, height: 0, borderTop: `14px solid ${participant.color}`, borderRight: "7px solid transparent", transform: "rotate(-24deg)" }} />
        <div style={{ marginLeft: 8, marginTop: -2, padding: "2px 6px", borderRadius: 4, background: participant.color, color: "#fff", fontSize: 11, lineHeight: "16px", whiteSpace: "nowrap" }}>{participant.name}</div>
      </div>;
    })}
  </div>;
}
