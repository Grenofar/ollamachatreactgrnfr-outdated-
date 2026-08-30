export default function SendButton({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  /** true while the AI is actively generating: shows the stop square and stays clickable regardless of `disabled`. */
  busy: boolean;
  disabled?: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      className={`send-btn ${busy ? "send-btn-busy" : ""}`}
      onClick={busy ? onStop : onSend}
      disabled={!busy && disabled}
      aria-label={busy ? "Arrêter la génération" : "Envoyer"}
      title={busy ? "Arrêter la génération" : "Envoyer"}
    >
      <span className="send-btn-icon send-btn-icon-arrow">↑</span>
      <span className="send-btn-icon send-btn-icon-stop" />
    </button>
  );
}
