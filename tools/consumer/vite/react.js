import { checkReact } from './check.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { OvRadar } from 'overscan/react';

createRoot(document.getElementById('root')).render(createElement(OvRadar, {}));
checkReact(import.meta.env.DEV ? 'react dev' : 'react build');
