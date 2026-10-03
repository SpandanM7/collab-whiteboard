import { useRoute } from './lib/route.ts';
import { BoardPage } from './pages/BoardPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';

function App() {
  const route = useRoute();
  // Keyed so moving between boards starts a fresh connection and fresh state.
  return route.name === 'board' ? (
    <BoardPage key={route.boardId} boardId={route.boardId} />
  ) : (
    <LandingPage invalidBoard={route.invalidBoard} />
  );
}

export default App;
