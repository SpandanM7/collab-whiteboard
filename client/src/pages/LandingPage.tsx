import { nanoid } from 'nanoid';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { boardPath, navigate, parseJoinCode } from '../lib/route.ts';

export function LandingPage({ invalidBoard = false }: { invalidBoard?: boolean }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const boardId = parseJoinCode(code);
    if (boardId) navigate(boardPath(boardId));
    else setError('That is not a valid board code. Use at least 8 letters, numbers, - or _.');
  };

  return (
    <main className="landing">
      <h1>Whiteboard</h1>
      <p>Draw together in real time. Create a board and share the link. No account needed.</p>
      {invalidBoard && (
        <p className="form-error" role="alert">
          That board link is not valid. Start a new board or check the code.
        </p>
      )}
      <button type="button" className="primary" onClick={() => navigate(boardPath(nanoid(10)))}>
        New board
      </button>
      <form className="join" onSubmit={join} noValidate>
        <label className="visually-hidden" htmlFor="join-code">
          Board code or link
        </label>
        <input
          id="join-code"
          value={code}
          placeholder="Join with code"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? 'join-error' : undefined}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
        />
        <button type="submit">Join</button>
      </form>
      {error && (
        <p id="join-error" className="form-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
