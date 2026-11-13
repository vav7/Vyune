/* App.tsx — the route table. Every page is lazy, behind its own skeleton. */

import { Route, Router } from '@solidjs/router';
import { pages } from '@/pageRegistry';
import { Layout } from '@/shell/Layout';

export default function App() {
  return (
    <Router root={Layout}>
      {pages.map((page) => (
        <Route path={page.path} component={page.component} />
      ))}
      <Route path="*" component={pages[0]!.component} />
    </Router>
  );
}
