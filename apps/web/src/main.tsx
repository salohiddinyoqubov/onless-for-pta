import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ShowcaseApp } from './showcase/app';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('Showcase root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <ShowcaseApp />
  </StrictMode>,
);
