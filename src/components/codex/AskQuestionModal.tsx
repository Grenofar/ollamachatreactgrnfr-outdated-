import { useState } from "react";
import type { QuestionRequest } from "../../hooks/useAgentLoop";

export default function AskQuestionModal({
  request,
  onAnswer,
}: {
  request: QuestionRequest;
  onAnswer: (answer: string) => void;
}) {
  const [freeText, setFreeText] = useState("");

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Question de l'agent</h2>
        <p className="modal-hint">{request.question}</p>

        {request.options && request.options.length > 0 && (
          <div className="question-options">
            {request.options.map((opt) => (
              <button key={opt} className="question-option" onClick={() => onAnswer(opt)}>
                {opt}
              </button>
            ))}
          </div>
        )}

        <label>Ou réponds librement</label>
        <textarea rows={3} value={freeText} onChange={(e) => setFreeText(e.target.value)} />

        <div className="modal-actions">
          <button className="primary-btn" onClick={() => onAnswer(freeText.trim())} disabled={!freeText.trim()}>
            Répondre
          </button>
        </div>
      </div>
    </div>
  );
}
