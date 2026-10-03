import { nanoid } from 'nanoid';
import { boardPath, navigate } from '../lib/route.ts';

export function LandingPage() {
  return (
    <main className="landing">
      <h1>Whiteboard</h1>
      <p>Draw together in real time. Create a board and share the link. No account needed.</p>
      <button type="button" className="primary" onClick={() => navigate(boardPath(nanoid(10)))}>
        New board
      </button>
    </main>
  );
}
