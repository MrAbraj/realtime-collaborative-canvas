import { useState, type FormEvent } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import ConnectionStats from "./components/ConnectionStats";
import JoinRoomDialog from "./components/JoinRoomDialog";
import ParticipantList from "./components/ParticipantList";
import RemoteCursors from "./components/RemoteCursors";
import { useCollaboration } from "./features/collaboration/useCollaboration";

const serverUrl = import.meta.env.VITE_WEBTRANSPORT_SERVER_URL ?? "https://localhost:4433";
const defaultRoomName = import.meta.env.VITE_ROOM_ID ?? "test";

function App() {
  const [roomForm, setRoomForm] = useState({ roomName: defaultRoomName, userName: "Anonymous" });
  const [connection, setConnection] = useState<{ roomName: string; userName: string } | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const collaboration = useCollaboration(serverUrl, connection);

  const submitRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomName = roomForm.roomName.trim();
    const userName = roomForm.userName.trim();
    if (roomName && userName) setConnection({ roomName, userName });
  };

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%" }}>
      <RemoteCursors cursors={collaboration.remoteCursors} participants={collaboration.participants} api={collaboration.canvasApi} />
      {connection && Object.keys(collaboration.participants).length > 0 && <ParticipantList participants={collaboration.participants} open={participantsOpen} onToggle={() => setParticipantsOpen((open) => !open)} />}
      {collaboration.connectionError && <div style={{ position: "fixed", zIndex: 35, top: 12, left: 12, padding: "8px 12px", background: "#fff3cd" }}>{collaboration.connectionError}</div>}
      <Excalidraw isCollaborating onChange={collaboration.onChange} onPointerUpdate={collaboration.onPointerUpdate} excalidrawAPI={collaboration.setCanvasApi} />
      {connection && <ConnectionStats metrics={collaboration.metrics} />}
      {!connection && <JoinRoomDialog roomName={roomForm.roomName} userName={roomForm.userName} onRoomNameChange={(roomName) => setRoomForm((current) => ({ ...current, roomName }))} onUserNameChange={(userName) => setRoomForm((current) => ({ ...current, userName }))} onSubmit={submitRoom} />}
    </div>
  );
}

export default App;
