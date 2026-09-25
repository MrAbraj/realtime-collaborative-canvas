import type { FormEvent, InputHTMLAttributes } from "react";
import styles from "./JoinRoomDialog.module.css";

interface JoinRoomDialogProps {
  roomName: string;
  userName: string;
  onRoomNameChange: (value: string) => void;
  onUserNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const InputField = (props: InputFieldProps) => {
  const { label, value, onChange, ...rest } = props;
  return (
    <label className={styles.field}>
      {label}
      <input
        className={styles.input}
        value={value}
        onChange={onChange}
        {...rest}
      />
    </label>
  );
};

export const JoinRoomDialog = (props: JoinRoomDialogProps) => {
  const { roomName, userName, onRoomNameChange, onUserNameChange, onSubmit } =
    props;

  return (
    <div className={styles.overlay}>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>Collaborative canvas</div>
          <h1 className={styles.title}>Join a room</h1>
          <p className={styles.description}>
            Create a new room or join an existing one to start collaborating
            with others in real-time.
          </p>
        </div>
        <InputField
          label="Room name"
          value={roomName}
          onChange={(event) => onRoomNameChange(event.target.value)}
          autoFocus
        />
        <InputField
          label="Your name"
          value={userName}
          onChange={(event) => onUserNameChange(event.target.value)}
        />
        <button className={styles.button} type="submit">
          Join
        </button>
      </form>
    </div>
  );
};
